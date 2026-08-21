from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    if old not in text:
        raise SystemExit(f"expected snippet not found in {path}: {old[:140]!r}")
    file.write_text(text.replace(old, new, 1))


manifest = "packages/plugin-catalog/src/manifests/birthday-role.ts"
replace_once(
    manifest,
    """      birthdayCardAssetId: {
        type: ['string', 'null'],
        title: 'Birthday Card画像ライブラリAsset',
        description: 'Birthday Card Studioで登録したGuild専用画像のAsset IDです。',
        pattern: BIRTHDAY_CARD_ASSET_ID_PATTERN,
        default: null,
      },
""",
    """      birthdayCardAssetId: {
        type: ['string', 'null'],
        title: 'Birthday Card画像ライブラリAsset',
        description: 'Birthday Card Studioで登録したGuild専用画像のAsset IDです。',
        pattern: BIRTHDAY_CARD_ASSET_ID_PATTERN,
      },
""",
)

assets_db = "packages/db/src/birthday-card-assets.ts"
replace_once(
    assets_db,
    """export interface BirthdayCardAssetRecord extends BirthdayCardAssetMetadata {
  content: Buffer;
}

""",
    """export interface BirthdayCardAssetRecord extends BirthdayCardAssetMetadata {
  content: Buffer;
}

export function birthdayCardAssetGuildLockKey(guildId: string): string {
  return `birthday-card-assets:${guildId}`;
}

""",
)
replace_once(
    assets_db,
    """    const lockKey = `birthday-card-assets:${input.guildId}`;
""",
    """    const lockKey = birthdayCardAssetGuildLockKey(input.guildId);
""",
)

guild_plugins = "apps/studio/src/lib/guild-plugins.ts"
replace_once(
    guild_plugins,
    """import type { Prisma } from '@herta/db';
""",
    """import { birthdayCardAssetGuildLockKey, type Prisma } from '@herta/db';
""",
)
replace_once(
    guild_plugins,
    """export type PluginConfig = Record<string, unknown>;

""",
    """export type PluginConfig = Record<string, unknown>;

export class BirthdayCardAssetSelectionUnavailableError extends Error {
  constructor() {
    super('BirthdayCardAssetSelectionUnavailable');
    this.name = 'BirthdayCardAssetSelectionUnavailableError';
  }
}

""",
)
replace_once(
    guild_plugins,
    """  const result = await prisma.$transaction(async (tx) => {
    await tx.plugin.upsert({
""",
    """  const result = await prisma.$transaction(async (tx) => {
    if (pluginId === 'birthday-role') {
      const lockKey = birthdayCardAssetGuildLockKey(guildId);
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
      `;

      if (validation.config['birthdayCardBackgroundSource'] === 'asset') {
        const assetId = validation.config['birthdayCardAssetId'];
        const selectedAsset =
          typeof assetId === 'string'
            ? await tx.birthdayCardAsset.findFirst({
                where: { guildId, id: assetId },
                select: { id: true },
              })
            : null;
        if (!selectedAsset) throw new BirthdayCardAssetSelectionUnavailableError();
      }
    }

    await tx.plugin.upsert({
""",
)

plugin_route = "apps/studio/src/app/api/guilds/[guildId]/plugins/[pluginId]/route.ts"
replace_once(
    plugin_route,
    """  findPluginManifest,
  getGuildPlugin,
  updateGuildPlugin,
  validatePluginConfig,
""",
    """  BirthdayCardAssetSelectionUnavailableError,
  findPluginManifest,
  getGuildPlugin,
  updateGuildPlugin,
  validatePluginConfig,
""",
)
replace_once(
    plugin_route,
    """  const result = await updateGuildPlugin(guildId, pluginId, session.user.id, updateInput);
  if (!result || !('manifest' in result)) {
""",
    """  let result: Awaited<ReturnType<typeof updateGuildPlugin>>;
  try {
    result = await updateGuildPlugin(guildId, pluginId, session.user.id, updateInput);
  } catch (error) {
    if (error instanceof BirthdayCardAssetSelectionUnavailableError) {
      return NextResponse.json(
        { error: '選択したBirthday Card画像が見つかりません。画像を選び直してください' },
        { status: 409 },
      );
    }
    throw error;
  }
  if (!result || !('manifest' in result)) {
""",
)

item_route = "apps/studio/src/app/api/guilds/[guildId]/birthday/card-assets/[assetId]/route.ts"
replace_once(
    item_route,
    """  deleteBirthdayCardAsset,
  getBirthdayCardAssetMetadata,
""",
    """  birthdayCardAssetGuildLockKey,
  getBirthdayCardAssetMetadata,
""",
)
old_delete = """  const plugin = await prisma.guildPlugin.findUnique({
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
"""
new_delete = """  const deletion = await prisma.$transaction(async (tx) => {
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
"""
replace_once(item_route, old_delete, new_delete)

config_test = ".github/scripts/birthday-card-asset-library-config.test.mjs"
replace_once(
    config_test,
    """  assert.match(manifest, /enum: \\['preset', 'asset', 'custom'\\]/u);
""",
    """  assert.match(manifest, /enum: \\['preset', 'asset', 'custom'\\]/u);
  const assetIdField = manifest.match(
    /birthdayCardAssetId: \\{(?<body>[\\s\\S]*?)\\n      \\},\\n      birthdayCardPreset:/u,
  );
  assert.ok(assetIdField?.groups?.body, 'birthdayCardAssetId field must exist');
  assert.doesNotMatch(assetIdField.groups.body, /default:/u);
""",
)

delete_test = ".github/scripts/birthday-card-asset-library-delete.test.mjs"
Path(delete_test).write_text("""import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const itemRoute = readFileSync(
  'apps/studio/src/app/api/guilds/[guildId]/birthday/card-assets/[assetId]/route.ts',
  'utf8',
);
const guildPlugins = readFileSync('apps/studio/src/lib/guild-plugins.ts', 'utf8');
const assetsDb = readFileSync('packages/db/src/birthday-card-assets.ts', 'utf8');

test('Persisted active Birthday Card asset cannot be deleted', () => {
  assert.match(itemRoute, /normalizeBirthdayCardConfig\\(plugin\\?\\.config\\)/u);
  assert.match(itemRoute, /config\\.birthdayCardBackgroundSource === 'asset'/u);
  assert.match(itemRoute, /config\\.birthdayCardAssetId === assetId/u);
  assert.match(itemRoute, /status: 409/u);
});

test('Asset selection and deletion share a Guild lock and selection verifies existence', () => {
  assert.match(assetsDb, /birthdayCardAssetGuildLockKey/u);
  assert.match(guildPlugins, /birthdayCardAssetGuildLockKey\\(guildId\\)/u);
  assert.match(itemRoute, /birthdayCardAssetGuildLockKey\\(guildId\\)/u);
  assert.match(guildPlugins, /tx\\.birthdayCardAsset\\.findFirst/u);
  assert.match(itemRoute, /prisma\\.\\$transaction/u);
  assert.match(itemRoute, /tx\\.birthdayCardAsset\\.deleteMany/u);
});
""")
