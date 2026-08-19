import {
  deleteBirthdayCardBackground,
  getBirthdayCardBackground,
  upsertBirthdayCardBackground,
} from '@herta/db';
import {
  BIRTHDAY_CARD_BACKGROUND_MAX_BYTES,
  inspectBirthdayCardBackgroundImage,
} from '@herta/shared';
import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { readRequestBodyBytes, RequestBodyTooLargeError } from '@/lib/bounded-request-body';
import { prisma } from '@/lib/db';
import { isSameOriginMutationRequest } from '@/lib/request-origin';
import { authorizeStudioPermission } from '@/lib/studio-access';
import { studioBirthdayResource } from '@/lib/studio-policy-resources';

export const dynamic = 'force-dynamic';

const MAX_MULTIPART_OVERHEAD_BYTES = 256 * 1024;
const UPLOAD_RATE_LIMIT = 10;
const UPLOAD_RATE_WINDOW_MS = 10 * 60 * 1000;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await params;
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const access = await authorizeStudioPermission(
    guildId,
    session.user.id,
    'studio.settings.read',
    studioBirthdayResource(guildId, 'card-background'),
  );
  if (!access.ok) return access.response;

  const background = await getBirthdayCardBackground(prisma, guildId);
  if (!background) return NextResponse.json({ error: 'カスタム背景がありません' }, { status: 404 });

  const etag = `"${background.sha256}"`;
  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: responseHeaders(background.contentType, etag) });
  }

  return new Response(new Uint8Array(background.content), {
    status: 200,
    headers: {
      ...responseHeaders(background.contentType, etag),
      'Content-Length': String(background.sizeBytes),
      'Content-Disposition': `inline; filename="${asciiFileName(background.fileName)}"`,
    },
  });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await params;
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  if (!isSameOriginMutationRequest(request)) {
    return NextResponse.json({ error: '不正なリクエスト元です' }, { status: 403 });
  }
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data')) {
    return NextResponse.json({ error: 'multipart/form-dataが必要です' }, { status: 415 });
  }

  const access = await authorizeStudioPermission(
    guildId,
    session.user.id,
    'studio.settings.write',
    studioBirthdayResource(guildId, 'card-background'),
  );
  if (!access.ok) return access.response;

  const since = new Date(Date.now() - UPLOAD_RATE_WINDOW_MS);
  const recentUploads = await prisma.auditLog.count({
    where: {
      guildId,
      actorId: session.user.id,
      event: 'birthday_card.background.updated',
      createdAt: { gte: since },
    },
  });
  if (recentUploads >= UPLOAD_RATE_LIMIT) {
    return NextResponse.json(
      { error: '背景画像の更新回数が上限に達しました。しばらく待って再実行してください' },
      { status: 429, headers: { 'Retry-After': String(UPLOAD_RATE_WINDOW_MS / 1000) } },
    );
  }

  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = await readRequestBodyBytes(
      request,
      BIRTHDAY_CARD_BACKGROUND_MAX_BYTES + MAX_MULTIPART_OVERHEAD_BYTES,
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof RequestBodyTooLargeError
            ? '背景画像は5 MiB以下にしてください'
            : 'アップロードを読み取れませんでした',
      },
      { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
    );
  }

  const replay = new Request(request.url, {
    method: 'PUT',
    headers: request.headers,
    body: bytes,
  });
  let form: FormData;
  try {
    form = await replay.formData();
  } catch {
    return NextResponse.json({ error: 'multipart/form-dataが不正です' }, { status: 400 });
  }
  const file = form.get('background');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: '背景画像を選択してください' }, { status: 400 });
  }
  if (file.size === 0 || file.size > BIRTHDAY_CARD_BACKGROUND_MAX_BYTES) {
    return NextResponse.json({ error: '背景画像は5 MiB以下にしてください' }, { status: 413 });
  }

  const content = new Uint8Array(await file.arrayBuffer());
  const image = inspectBirthdayCardBackgroundImage(content);
  if (!image) {
    return NextResponse.json(
      { error: 'PNG / JPEG / WebPの有効な画像を使用してください（最大8192px・1600万画素）' },
      { status: 400 },
    );
  }

  const fileName = safeFileName(file.name, image.contentType);
  const sha256 = createHash('sha256').update(content).digest('hex');
  const metadata = await upsertBirthdayCardBackground(prisma, {
    guildId,
    contentType: image.contentType,
    fileName,
    content: Buffer.from(content),
    sizeBytes: content.byteLength,
    width: image.width,
    height: image.height,
    sha256,
    updatedBy: session.user.id,
  });
  await prisma.auditLog.create({
    data: {
      guildId,
      actorId: session.user.id,
      event: 'birthday_card.background.updated',
      targetType: 'birthday_card_background',
      targetId: guildId,
      metadata: {
        contentType: metadata.contentType,
        sizeBytes: metadata.sizeBytes,
        width: metadata.width,
        height: metadata.height,
        sha256: metadata.sha256,
      },
    },
  });

  return NextResponse.json({ background: serializeMetadata(metadata) });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await params;
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  if (!isSameOriginMutationRequest(request)) {
    return NextResponse.json({ error: '不正なリクエスト元です' }, { status: 403 });
  }

  const access = await authorizeStudioPermission(
    guildId,
    session.user.id,
    'studio.settings.write',
    studioBirthdayResource(guildId, 'card-background'),
  );
  if (!access.ok) return access.response;

  const deleted = await deleteBirthdayCardBackground(prisma, guildId);
  if (deleted) {
    await prisma.auditLog.create({
      data: {
        guildId,
        actorId: session.user.id,
        event: 'birthday_card.background.deleted',
        targetType: 'birthday_card_background',
        targetId: guildId,
      },
    });
  }
  return NextResponse.json({ deleted });
}

function responseHeaders(contentType: string, etag: string): Record<string, string> {
  return {
    'Content-Type': contentType,
    'Cache-Control': 'private, no-cache, must-revalidate',
    'X-Content-Type-Options': 'nosniff',
    ETag: etag,
  };
}

function safeFileName(value: string, contentType: string): string {
  const fallback = contentType === 'image/png' ? 'background.png' : contentType === 'image/webp' ? 'background.webp' : 'background.jpg';
  const normalized = value
    .replaceAll('\\', '/')
    .split('/')
    .at(-1)
    ?.replace(/[\u0000-\u001f\u007f]/gu, '')
    .trim()
    .slice(0, 120);
  return normalized || fallback;
}

function asciiFileName(value: string): string {
  const safe = value.replace(/[^a-zA-Z0-9._-]/gu, '_').slice(0, 100);
  return safe || 'birthday-background';
}

function serializeMetadata(metadata: {
  contentType: string;
  fileName: string;
  sizeBytes: number;
  width: number;
  height: number;
  sha256: string;
  updatedAt: Date;
}) {
  return {
    contentType: metadata.contentType,
    fileName: metadata.fileName,
    sizeBytes: metadata.sizeBytes,
    width: metadata.width,
    height: metadata.height,
    sha256: metadata.sha256,
    updatedAt: metadata.updatedAt.toISOString(),
  };
}
