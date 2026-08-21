import {
  countBirthdayCardAssets,
  createBirthdayCardAsset,
  listBirthdayCardAssetMetadata,
} from '@herta/db';
import {
  BIRTHDAY_CARD_ASSET_MAX_COUNT,
  BIRTHDAY_CARD_BACKGROUND_MAX_BYTES,
  inspectBirthdayCardBackgroundImage,
} from '@herta/shared';
import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { authorizeBirthdayStudioPermission } from '@/lib/birthday-card-access';
import { readRequestBodyBytes, RequestBodyTooLargeError } from '@/lib/bounded-request-body';
import { prisma } from '@/lib/db';
import { isSameOriginMutationRequest } from '@/lib/request-origin';
import { studioBirthdayResource } from '@/lib/studio-policy-resources';

export const dynamic = 'force-dynamic';

const MAX_MULTIPART_OVERHEAD_BYTES = 256 * 1024;
const UPLOAD_RATE_LIMIT = 10;
const UPLOAD_RATE_WINDOW_MS = 10 * 60 * 1000;

export async function GET(_request: Request, { params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const access = await authorizeBirthdayStudioPermission(
    guildId,
    session.user.id,
    'studio.settings.read',
    studioBirthdayResource(guildId, 'card-assets'),
  );
  if (!access.ok) return access.response;

  const assets = await listBirthdayCardAssetMetadata(prisma, guildId);
  return NextResponse.json({ assets: assets.map(serializeAsset) });
}

export async function POST(request: Request, { params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  if (!isSameOriginMutationRequest(request)) {
    return NextResponse.json({ error: '不正なリクエスト元です' }, { status: 403 });
  }
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data')) {
    return NextResponse.json({ error: 'multipart/form-dataが必要です' }, { status: 415 });
  }

  const access = await authorizeBirthdayStudioPermission(
    guildId,
    session.user.id,
    'studio.settings.write',
    studioBirthdayResource(guildId, 'card-assets'),
  );
  if (!access.ok) return access.response;

  const [assetCount, recentUploads] = await Promise.all([
    countBirthdayCardAssets(prisma, guildId),
    prisma.auditLog.count({
      where: {
        guildId,
        actorId: session.user.id,
        event: 'birthday_card.asset.created',
        createdAt: { gte: new Date(Date.now() - UPLOAD_RATE_WINDOW_MS) },
      },
    }),
  ]);
  if (assetCount >= BIRTHDAY_CARD_ASSET_MAX_COUNT) {
    return NextResponse.json(
      { error: `画像ライブラリは最大${BIRTHDAY_CARD_ASSET_MAX_COUNT}件です。不要な画像を削除してください` },
      { status: 409 },
    );
  }
  if (recentUploads >= UPLOAD_RATE_LIMIT) {
    return NextResponse.json(
      { error: '画像の登録回数が上限に達しました。しばらく待って再実行してください' },
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
    method: 'POST',
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

  const name = safeAssetName(file.name, image.contentType);
  const sha256 = createHash('sha256').update(content).digest('hex');
  const asset = await createBirthdayCardAsset(prisma, {
    guildId,
    name,
    contentType: image.contentType,
    content: Buffer.from(content),
    sizeBytes: content.byteLength,
    width: image.width,
    height: image.height,
    sha256,
    createdBy: session.user.id,
  });

  await prisma.auditLog.create({
    data: {
      guildId,
      actorId: session.user.id,
      event: 'birthday_card.asset.created',
      targetType: 'birthday_card_asset',
      targetId: asset.id,
      metadata: {
        name: asset.name,
        contentType: asset.contentType,
        sizeBytes: asset.sizeBytes,
        width: asset.width,
        height: asset.height,
        sha256: asset.sha256,
        isPreset: asset.isPreset,
      },
    },
  });

  return NextResponse.json({ asset: serializeAsset(asset) }, { status: 201 });
}

function safeAssetName(value: string, contentType: string): string {
  const fallback =
    contentType === 'image/png'
      ? 'birthday-background.png'
      : contentType === 'image/webp'
        ? 'birthday-background.webp'
        : 'birthday-background.jpg';
  const normalized = value
    .replaceAll('\\', '/')
    .split('/')
    .at(-1)
    ?.replace(/[\u0000-\u001f\u007f]/gu, '')
    .trim()
    .slice(0, 120);
  return normalized || fallback;
}

function serializeAsset(asset: {
  id: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  width: number;
  height: number;
  sha256: string;
  isPreset: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: asset.id,
    name: asset.name,
    contentType: asset.contentType,
    sizeBytes: asset.sizeBytes,
    width: asset.width,
    height: asset.height,
    sha256: asset.sha256,
    isPreset: asset.isPreset,
    createdAt: asset.createdAt.toISOString(),
    updatedAt: asset.updatedAt.toISOString(),
  };
}
