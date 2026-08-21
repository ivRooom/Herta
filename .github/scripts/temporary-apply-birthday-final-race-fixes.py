from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    if old not in text:
        raise SystemExit(f'pattern not found: {path}')
    file.write_text(text.replace(old, new, 1))


replace_once(
    'packages/db/src/birthday-card-background.ts',
    '''export async function getBirthdayCardRuntimeBackground(\n  prisma: PrismaClient,\n  guildId: string,\n): Promise<BirthdayCardBackgroundRecord | null> {\n  const plugin = await prisma.guildPlugin.findUnique({\n    where: { guildId_pluginId: { guildId, pluginId: 'birthday-role' } },\n    select: { config: true },\n  });\n  const assetSelection = resolveBirthdayCardAssetSelection(plugin?.config);\n''',
    '''export async function getBirthdayCardRuntimeBackground(\n  prisma: PrismaClient,\n  guildId: string,\n  configSnapshot: unknown,\n): Promise<BirthdayCardBackgroundRecord | null> {\n  const assetSelection = resolveBirthdayCardAssetSelection(configSnapshot);\n''',
)

replace_once(
    'apps/bot/src/plugins/birthday-role.ts',
    '''? await getBirthdayCardRuntimeBackground(context.prisma, context.guildId).catch(\n''',
    '''? await getBirthdayCardRuntimeBackground(context.prisma, context.guildId, config).catch(\n''',
)

replace_once(
    'packages/db/src/birthday-card-assets.ts',
    '''export async function setBirthdayCardAssetPreset(\n  prisma: PrismaClient,\n  input: { guildId: string; assetId: string; isPreset: boolean; updatedBy: string },\n): Promise<BirthdayCardAssetMetadata | null> {\n  const rows = await prisma.$queryRaw<BirthdayCardAssetMetadata[]>`\n    UPDATE "birthday_card_assets"\n    SET\n      "is_preset" = ${input.isPreset},\n      "updated_by" = ${input.updatedBy},\n      "updated_at" = CURRENT_TIMESTAMP\n    WHERE "guild_id" = ${input.guildId} AND "id" = ${input.assetId}\n    RETURNING\n      "id",\n      "guild_id" AS "guildId",\n      "name",\n      "content_type" AS "contentType",\n      "size_bytes" AS "sizeBytes",\n      "width",\n      "height",\n      "sha256",\n      "is_preset" AS "isPreset",\n      "created_at" AS "createdAt",\n      "updated_at" AS "updatedAt"\n  `;\n  return rows[0] ?? null;\n}\n''',
    '''export async function setBirthdayCardAssetPreset(\n  prisma: PrismaClient,\n  input: { guildId: string; assetId: string; isPreset: boolean; updatedBy: string },\n): Promise<BirthdayCardAssetMetadata | null> {\n  return prisma.$transaction(async (tx) => {\n    const lockKey = birthdayCardAssetGuildLockKey(input.guildId);\n    await tx.$executeRaw`\n      SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))\n    `;\n\n    const rows = await tx.$queryRaw<BirthdayCardAssetMetadata[]>`\n      UPDATE "birthday_card_assets"\n      SET\n        "is_preset" = ${input.isPreset},\n        "updated_by" = ${input.updatedBy},\n        "updated_at" = CURRENT_TIMESTAMP\n      WHERE "guild_id" = ${input.guildId} AND "id" = ${input.assetId}\n      RETURNING\n        "id",\n        "guild_id" AS "guildId",\n        "name",\n        "content_type" AS "contentType",\n        "size_bytes" AS "sizeBytes",\n        "width",\n        "height",\n        "sha256",\n        "is_preset" AS "isPreset",\n        "created_at" AS "createdAt",\n        "updated_at" AS "updatedAt"\n    `;\n    return rows[0] ?? null;\n  });\n}\n''',
)

Path('.github/scripts/birthday-card-asset-library-runtime-snapshot.test.mjs').write_text('''import assert from 'node:assert/strict';\nimport { readFileSync } from 'node:fs';\nimport test from 'node:test';\n\nconst background = readFileSync('packages/db/src/birthday-card-background.ts', 'utf8');\nconst botRole = readFileSync('apps/bot/src/plugins/birthday-role.ts', 'utf8');\n\ntest('Birthday Card runtime background uses the worker config snapshot', () => {\n  assert.match(background, /configSnapshot: unknown/u);\n  assert.match(background, /resolveBirthdayCardAssetSelection\\(configSnapshot\\)/u);\n  assert.doesNotMatch(background, /guildPlugin\\.findUnique/u);\n  assert.match(\n    botRole,\n    /getBirthdayCardRuntimeBackground\\(context\\.prisma, context\\.guildId, config\\)/u,\n  );\n});\n''')

Path('.github/scripts/birthday-card-asset-library-preset-lock.test.mjs').write_text('''import assert from 'node:assert/strict';\nimport { readFileSync } from 'node:fs';\nimport test from 'node:test';\n\nconst assets = readFileSync('packages/db/src/birthday-card-assets.ts', 'utf8');\nconst itemRoute = readFileSync(\n  'apps/studio/src/app/api/guilds/[guildId]/birthday/card-assets/[assetId]/route.ts',\n  'utf8',\n);\n\ntest('Preset mutation and deletion share the Guild advisory lock', () => {\n  const presetMutation = assets.slice(\n    assets.indexOf('export async function setBirthdayCardAssetPreset'),\n    assets.indexOf('export async function deleteBirthdayCardAsset'),\n  );\n  assert.match(presetMutation, /prisma\\.\\$transaction/u);\n  assert.match(presetMutation, /birthdayCardAssetGuildLockKey\\(input\\.guildId\\)/u);\n  assert.match(presetMutation, /pg_advisory_xact_lock/u);\n  assert.match(presetMutation, /UPDATE "birthday_card_assets"/u);\n  assert.match(itemRoute, /birthdayCardAssetGuildLockKey\\(guildId\\)/u);\n  assert.match(itemRoute, /pg_advisory_xact_lock/u);\n});\n''')
