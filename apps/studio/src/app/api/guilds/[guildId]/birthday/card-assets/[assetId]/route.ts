import { birthdayCardAssetGuildLockKey, getBirthdayCardAssetMetadata } from '@herta/db';
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

type BirthdayCardAssetPatchRecord = {
  id: string;
  guildId: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  width: number;
  height: number;
  sha256: string;
  isPreset: boolean;
  createdAt: Date;
  updatedAt: Date;
};

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

  // Preset management and asset-library metadata intentionally have separate IAM resources.
  // A preset-only mutation can succeed, but metadata is returned only with card-assets read access.
  const assetReadAccess = await authorizeBirthdayStudioPermission(
    guildId,
    session.user.id,
    'studio.settings.read',
    studioBirthdayResource(guildId, 'card-assets'),
  );

  const asset = await prisma.$transaction(async (tx) => {
    // PATCH shares the Guild lock with DELETE and preset changes. Mutations and their audit
    // events commit as one unit so partial or unaudited metadata changes cannot escape.
    const lockKey = birthdayCardAssetGuildLockKey(guildId);
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
    `;

    const before = await tx.birthdayCardAsset.findFirst({
      where: { guildId, id: assetId },
      select: {
        id: true,
        guildId: true,
        name: true,
        contentType: true,
        sizeBytes: true,
        width: true,
        height: true,
        sha256: true,
        isPreset: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!before) return null;

    let current: BirthdayCardAssetPatchRecord = before;
    if (name && name !== current.name) {
      const rows = await tx.$queryRaw<BirthdayCardAssetPatchRecord[]>`
        UPDATE "birthday_card_assets"
        SET
          "name" = ${name},
          "updated_by" = ${session.user.id},
          "updated_at" = CURRENT_TIMESTAMP
        WHERE "guild_id" = ${guildId} AND "id" = ${assetId}
        RETURNING
          "id",
          "guild_id" AS "guildId",
          "name",
          "content_type" AS "contentType",
          "size_bytes" AS "sizeBytes",
          "width",
          "height",
          "sha256",
          "is_preset" AS "isPreset",
          "created_at" AS "createdAt",
          "updated_at" AS "updatedAt"
      `;
      const renamed = rows[0];
      if (!renamed) return null;
      current = renamed;

      await tx.auditLog.create({
        data: {
          guildId,
          actorId: session.user.id,
          event: 'birthday_card.asset.renamed',
          targetType: 'birthday_card_asset',
          targetId: assetId,
          changes: { name: { before: before.name, after: current.name } },
        },
      });
    }

    if (typeof input.isPreset === 'boolean' && input.isPreset !== current.isPreset) {
      const previousPreset = current.isPreset;
      const rows = await tx.$queryRaw<BirthdayCardAssetPatchRecord[]>`
        UPDATE "birthday_card_assets"
        SET
          "is_preset" = ${input.isPreset},
          "updated_by" = ${session.user.id},
          "updated_at" = CURRENT_TIMESTAMP
        WHERE "guild_id" = ${guildId} AND "id" = ${assetId}
        RETURNING
          "id",
          "guild_id" AS "guildId",
          "name",
          "content_type" AS "contentType",
          "size_bytes" AS "sizeBytes",
          "width",
          "height",
          "sha256",
          "is_preset" AS "isPreset",
          "created_at" AS "createdAt",
          "updated_at" AS "updatedAt"
      `;
      const updated = rows[0];
      if (!updated) return null;
      current = updated;

      await tx.auditLog.create({
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

    return current;
  });

  if (!asset) return NextResponse.json({ error: '画像が見つかりません' }, { status: 404 });
  if (!assetReadAccess.ok) return NextResponse.json({ updated: true });
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

  const deletion = await prisma.$transaction(async (tx) => {
    const lockKey = birthdayCardAssetGuildLockKey(guildId);
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
    `;

    const currentAsset = await tx.birthdayCardAsset.findFirst({
      where: { guildId, id: assetId },
      select: {
        id: true,
        name: true,
        contentType: true,
        sizeBytes: true,
        width: true,
        height: true,
        sha256: true,
        isPreset: true,
      },
    });
    if (!currentAsset) return { kind: 'not-found' as const };
    if (currentAsset.isPreset && !asset.isPreset) return { kind: 'preset-changed' as const };

    const plugin = await tx.guildPlugin.findUnique({
      where: { guildId_pluginId: { guildId, pluginId: 'birthday-role' } },
      select: { config: true },
    });
    const config = normalizeBirthdayCardConfig(plugin?.config);
    if (config.birthdayCardBackgroundSource === 'asset' && config.birthdayCardAssetId === assetId) {
      return { kind: 'active' as const };
    }

    const deleted = await tx.birthdayCardAsset.deleteMany({ where: { guildId, id: assetId } });
    if (deleted.count === 0) return { kind: 'not-found' as const };

    await tx.auditLog.create({
      data: {
        guildId,
        actorId: session.user.id,
        event: 'birthday_card.asset.deleted',
        targetType: 'birthday_card_asset',
        targetId: assetId,
        metadata: {
          name: currentAsset.name,
          contentType: currentAsset.contentType,
          sizeBytes: currentAsset.sizeBytes,
          width: currentAsset.width,
          height: currentAsset.height,
          sha256: currentAsset.sha256,
          wasPreset: currentAsset.isPreset,
        },
      },
    });

    return { kind: 'deleted' as const };
  });

  if (deletion.kind === 'not-found') {
    return NextResponse.json({ error: '画像が見つかりません' }, { status: 404 });
  }
  if (deletion.kind === 'preset-changed') {
    return NextResponse.json(
      { error: '画像のPreset状態が変更されました。画面を更新して再実行してください' },
      { status: 409 },
    );
  }
  if (deletion.kind === 'active') {
    return NextResponse.json(
      { error: '現在使用中の画像は削除できません。別の背景へ切り替えて設定を保存してください' },
      { status: 409 },
    );
  }

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
