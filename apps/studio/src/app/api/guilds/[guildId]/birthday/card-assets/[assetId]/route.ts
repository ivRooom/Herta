import {
  deleteBirthdayCardAsset,
  getBirthdayCardAssetMetadata,
  renameBirthdayCardAsset,
  setBirthdayCardAssetPreset,
} from '@herta/db';
import { normalizeBirthdayCardAssetId, normalizeBirthdayCardConfig } from '@herta/shared';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { authorizeBirthdayStudioPermission } from '@/lib/birthday-card-access';
import { readRequestBodyBytes, RequestBodyTooLargeError } from '@/lib/bounded-request-body';
import { prisma } from '@/lib/db';
import { isSameOriginMutationRequest } from '@/lib/request-origin';
import { studioBirthdayResource } from '@/lib/studio-policy-resources';

export const dynamic = 'force-dynamic';

const MAX_PATCH_BODY_BYTES = 8 * 1024;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ guildId: string; assetId: string }> },
) {
  const { guildId, assetId: rawAssetId } = await params;
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  if (!isSameOriginMutationRequest(request)) {
    return NextResponse.json({ error: '不正なリクエスト元です' }, { status: 403 });
  }
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return NextResponse.json({ error: 'application/jsonが必要です' }, { status: 415 });
  }

  const assetId = normalizeBirthdayCardAssetId(rawAssetId);
  if (!assetId) return NextResponse.json({ error: 'Asset IDが不正です' }, { status: 400 });

  const body = await readPatchBody(request);
  if (!body.ok) return body.response;
  const input = body.value;
  const hasName = Object.hasOwn(input, 'name');
  const hasPreset = Object.hasOwn(input, 'isPreset');
  if (!hasName && !hasPreset) {
    return NextResponse.json({ error: '変更する項目がありません' }, { status: 400 });
  }
  if (hasName && typeof input.name !== 'string') {
    return NextResponse.json({ error: 'nameは文字列で指定してください' }, { status: 400 });
  }
  if (hasPreset && typeof input.isPreset !== 'boolean') {
    return NextResponse.json({ error: 'isPresetはbooleanで指定してください' }, { status: 400 });
  }
  const name = typeof input.name === 'string' ? cleanAssetName(input.name) : null;
  if (hasName && !name) {
    return NextResponse.json({ error: '画像名は1〜120文字で指定してください' }, { status: 400 });
  }

  if (hasName) {
    const assetAccess = await authorizeBirthdayStudioPermission(
      guildId,
      session.user.id,
      'studio.settings.write',
      studioBirthdayResource(guildId, 'card-assets'),
    );
    if (!assetAccess.ok) return assetAccess.response;
  }
  if (hasPreset) {
    const presetAccess = await authorizeBirthdayStudioPermission(
      guildId,
      session.user.id,
      'studio.settings.write',
      studioBirthdayResource(guildId, 'card-presets'),
    );
    if (!presetAccess.ok) return presetAccess.response;
  }

  const before = await getBirthdayCardAssetMetadata(prisma, guildId, assetId);
  if (!before) return NextResponse.json({ error: '画像が見つかりません' }, { status: 404 });

  let asset = before;
  if (name && name !== asset.name) {
    const renamed = await renameBirthdayCardAsset(prisma, {
      guildId,
      assetId,
      name,
      updatedBy: session.user.id,
    });
    if (!renamed) return NextResponse.json({ error: '画像が見つかりません' }, { status: 404 });
    asset = renamed;
    await prisma.auditLog.create({
      data: {
        guildId,
        actorId: session.user.id,
        event: 'birthday_card.asset.renamed',
        targetType: 'birthday_card_asset',
        targetId: assetId,
        changes: { name: { before: before.name, after: asset.name } },
      },
    });
  }

  if (typeof input.isPreset === 'boolean' && input.isPreset !== asset.isPreset) {
    const previousPreset = asset.isPreset;
    const updated = await setBirthdayCardAssetPreset(prisma, {
      guildId,
      assetId,
      isPreset: input.isPreset,
      updatedBy: session.user.id,
    });
    if (!updated) return NextResponse.json({ error: '画像が見つかりません' }, { status: 404 });
    asset = updated;
    await prisma.auditLog.create({
      data: {
        guildId,
        actorId: session.user.id,
        event: input.isPreset
          ? 'birthday_card.asset.preset_added'
          : 'birthday_card.asset.preset_removed',
        targetType: 'birthday_card_asset',
        targetId: assetId,
        changes: { isPreset: { before: previousPreset, after: input.isPreset } },
      },
    });
  }

  return NextResponse.json({ asset: serializeAsset(asset) });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ guildId: string; assetId: string }> },
) {
  const { guildId, assetId: rawAssetId } = await params;
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  if (!isSameOriginMutationRequest(request)) {
    return NextResponse.json({ error: '不正なリクエスト元です' }, { status: 403 });
  }

  const assetId = normalizeBirthdayCardAssetId(rawAssetId);
  if (!assetId) return NextResponse.json({ error: 'Asset IDが不正です' }, { status: 400 });

  const access = await authorizeBirthdayStudioPermission(
    guildId,
    session.user.id,
    'studio.settings.write',
    studioBirthdayResource(guildId, 'card-assets'),
  );
  if (!access.ok) return access.response;

  const asset = await getBirthdayCardAssetMetadata(prisma, guildId, assetId);
  if (!asset) return NextResponse.json({ error: '画像が見つかりません' }, { status: 404 });
  if (asset.isPreset) {
    const presetAccess = await authorizeBirthdayStudioPermission(
      guildId,
      session.user.id,
      'studio.settings.write',
      studioBirthdayResource(guildId, 'card-presets'),
    );
    if (!presetAccess.ok) return presetAccess.response;
  }

  const plugin = await prisma.guildPlugin.findUnique({
    where: { guildId_pluginId: { guildId, pluginId: 'birthday-role' } },
    select: { config: true },
  });
  const config = normalizeBirthdayCardConfig(plugin?.config);
  if (config.birthdayCardBackgroundSource === 'asset' && config.birthdayCardAssetId === assetId) {
    return NextResponse.json(
      { error: '現在使用中の画像は削除できません。別の背景へ切り替えて設定を保存してください' },
      { status: 409 },
    );
  }

  const deleted = await deleteBirthdayCardAsset(prisma, guildId, assetId);
  if (!deleted) return NextResponse.json({ error: '画像が見つかりません' }, { status: 404 });

  await prisma.auditLog.create({
    data: {
      guildId,
      actorId: session.user.id,
      event: 'birthday_card.asset.deleted',
      targetType: 'birthday_card_asset',
      targetId: assetId,
      metadata: {
        name: asset.name,
        contentType: asset.contentType,
        sizeBytes: asset.sizeBytes,
        width: asset.width,
        height: asset.height,
        sha256: asset.sha256,
        wasPreset: asset.isPreset,
      },
    },
  });

  return NextResponse.json({ deleted: true });
}

async function readPatchBody(
  request: Request,
): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; response: NextResponse }> {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = await readRequestBodyBytes(request, MAX_PATCH_BODY_BYTES);
  } catch (error) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error:
            error instanceof RequestBodyTooLargeError
              ? 'リクエストが大きすぎます'
              : 'リクエストを読み取れませんでした',
        },
        { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
      ),
    };
  }
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!isRecord(value)) throw new Error('InvalidBody');
    return { ok: true, value };
  } catch {
    return { ok: false, response: NextResponse.json({ error: 'JSONが不正です' }, { status: 400 }) };
  }
}

function cleanAssetName(value: string): string | null {
  const normalized = value
    .replace(/[\u0000-\u001f\u007f]/gu, '')
    .trim()
    .slice(0, 120);
  return normalized || null;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
