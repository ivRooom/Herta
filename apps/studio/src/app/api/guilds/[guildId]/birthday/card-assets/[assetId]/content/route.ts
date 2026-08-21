import { getBirthdayCardAsset } from '@herta/db';
import { normalizeBirthdayCardAssetId } from '@herta/shared';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { authorizeBirthdayStudioPermission } from '@/lib/birthday-card-access';
import { prisma } from '@/lib/db';
import { studioBirthdayResource } from '@/lib/studio-policy-resources';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ guildId: string; assetId: string }> },
) {
  const { guildId, assetId: rawAssetId } = await params;
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const access = await authorizeBirthdayStudioPermission(
    guildId,
    session.user.id,
    'studio.settings.read',
    studioBirthdayResource(guildId, 'card-assets'),
  );
  if (!access.ok) return access.response;

  const assetId = normalizeBirthdayCardAssetId(rawAssetId);
  if (!assetId) return NextResponse.json({ error: 'Asset IDが不正です' }, { status: 400 });

  const asset = await getBirthdayCardAsset(prisma, guildId, assetId);
  if (!asset) return NextResponse.json({ error: '画像が見つかりません' }, { status: 404 });

  const etag = `"${asset.sha256}"`;
  const headers = responseHeaders(asset.contentType, etag);
  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(new Uint8Array(asset.content), {
    status: 200,
    headers: {
      ...headers,
      'Content-Length': String(asset.sizeBytes),
      'Content-Disposition': `inline; filename="${asciiFileName(asset.name)}"`,
    },
  });
}

function responseHeaders(contentType: string, etag: string): Record<string, string> {
  return {
    'Content-Type': contentType,
    'Cache-Control': 'private, no-cache, must-revalidate',
    'X-Content-Type-Options': 'nosniff',
    ETag: etag,
  };
}

function asciiFileName(value: string): string {
  const safe = value.replace(/[^a-zA-Z0-9._-]/gu, '_').slice(0, 100);
  return safe || 'birthday-card-asset';
}
