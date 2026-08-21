from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    if old not in text:
        raise SystemExit(f"expected snippet not found in {path}: {old[:120]!r}")
    file.write_text(text.replace(old, new, 1))


editor = "apps/studio/src/components/birthday-card-editor.tsx"
replace_once(
    editor,
    """  const canUseAsset =
    editable.has('birthdayCardBackgroundSource') && editable.has('birthdayCardAssetId');
""",
    """  const canUseAsset =
    canWriteAssets &&
    editable.has('birthdayCardBackgroundSource') &&
    editable.has('birthdayCardAssetId');
""",
)
replace_once(
    editor,
    """  const selectedDraftAsset =
    config.birthdayCardBackgroundSource === 'asset' && config.birthdayCardAssetId
      ? (assets.find((asset) => asset.id === config.birthdayCardAssetId) ?? null)
      : null;
""",
    """  const selectedDraftAsset =
    config.birthdayCardBackgroundSource === 'asset' && config.birthdayCardAssetId
      ? (assets.find((asset) => asset.id === config.birthdayCardAssetId) ?? null)
      : null;
  const persistedActiveAssetId =
    saved.birthdayCardBackgroundSource === 'asset' ? (saved.birthdayCardAssetId ?? null) : null;
""",
)
replace_once(
    editor,
    """      (config.birthdayCardBackgroundSource === 'asset' && asset.id === config.birthdayCardAssetId)
""",
    """      (saved.birthdayCardBackgroundSource === 'asset' && asset.id === saved.birthdayCardAssetId)
""",
)
replace_once(
    editor,
    """                    disabled={!canReadAssets || !canReadAssetId || !config.birthdayCardAssetId}
""",
    """                    disabled={
                      !canWriteAssets || !canReadAssets || !canReadAssetId || !config.birthdayCardAssetId
                    }
""",
)
replace_once(
    editor,
    """        selectedAssetId={selectedDraftAsset?.id ?? null}
""",
    """        selectedAssetId={selectedDraftAsset?.id ?? null}
        protectedAssetId={persistedActiveAssetId}
""",
)

library = "apps/studio/src/components/birthday-card-asset-library.tsx"
replace_once(
    library,
    """  selectedAssetId,
  canRead,
""",
    """  selectedAssetId,
  protectedAssetId,
  canRead,
""",
)
replace_once(
    library,
    """  selectedAssetId: string | null;
  canRead: boolean;
""",
    """  selectedAssetId: string | null;
  protectedAssetId: string | null;
  canRead: boolean;
""",
)
replace_once(
    library,
    """            const selected = asset.id === selectedAssetId;
""",
    """            const selected = asset.id === selectedAssetId;
            const protectedFromDelete = asset.id === protectedAssetId;
""",
)
replace_once(
    library,
    """                        disabled={pending || selected || (asset.isPreset && !canManagePresets)}
""",
    """                        disabled={
                          pending ||
                          selected ||
                          protectedFromDelete ||
                          (asset.isPreset && !canManagePresets)
                        }
""",
)

bot_role = "apps/bot/src/plugins/birthday-role.ts"
replace_once(
    bot_role,
    """        const customBackground =
          config.birthdayCardEnabled &&
          config.birthdayCardBackgroundSource === 'custom' &&
          todaysRegistrations.length > 0
""",
    """        const usesStoredBirthdayCardBackground =
          config.birthdayCardBackgroundSource === 'custom' ||
          config.birthdayCardBackgroundSource === 'asset';
        const customBackground =
          config.birthdayCardEnabled &&
          usesStoredBirthdayCardBackground &&
          todaysRegistrations.length > 0
""",
)
replace_once(
    bot_role,
    """          config.birthdayCardEnabled &&
          config.birthdayCardBackgroundSource === 'custom' &&
          todaysRegistrations.length > 0 &&
          !customBackground
""",
    """          config.birthdayCardEnabled &&
          usesStoredBirthdayCardBackground &&
          todaysRegistrations.length > 0 &&
          !customBackground
""",
)
replace_once(
    bot_role,
    "Birthday Cardカスタム背景を取得できないためプリセットへfallbackします",
    "Birthday Card背景を取得できないためプリセットへfallbackします",
)
replace_once(
    bot_role,
    "Birthday Cardカスタム背景が未登録のためプリセットへfallbackします",
    "Birthday Card背景が未登録のためプリセットへfallbackします",
)

catalog = "packages/plugin-catalog/src/index.ts"
replace_once(
    catalog,
    """/**
 * Birthday Card Asset LibraryはStudio上では `asset` をSource of Truthとして保持する。
 * 既存Birthday Role runtimeはcustom background bytesを受け取る契約なので、Botへ渡す
 * runtime configだけ `custom` として扱い、永続configとDashboardの意味は変更しない。
 */
export function normalizeRuntimePluginConfig(
  pluginId: string,
  config: Record<string, unknown>,
): Record<string, unknown> {
  if (pluginId !== 'birthday-role' || config['birthdayCardBackgroundSource'] !== 'asset') {
    return config;
  }
  return { ...config, birthdayCardBackgroundSource: 'custom' };
}
""",
    """/**
 * Runtimeでも永続configのbackground source discriminatorを保持する。
 * Asset Libraryとlegacy customはBot側で明示的に分岐し、意味を潰さない。
 */
export function normalizeRuntimePluginConfig(
  _pluginId: string,
  config: Record<string, unknown>,
): Record<string, unknown> {
  return config;
}
""",
)

runtime_test = Path("packages/plugin-catalog/src/birthday-runtime-config.test.ts")
runtime_test.write_text("""import { describe, expect, it } from 'vitest';
import { normalizeRuntimePluginConfig } from './index.js';

describe('normalizeRuntimePluginConfig', () => {
  it('Birthday Card Asset Libraryのasset discriminatorをruntimeでも保持する', () => {
    const source = {
      birthdayCardBackgroundSource: 'asset',
      birthdayCardAssetId: '123e4567-e89b-42d3-a456-426614174000',
      birthdayCardEnabled: true,
    };

    expect(normalizeRuntimePluginConfig('birthday-role', source)).toBe(source);
  });

  it('legacy customにAsset IDが残っていてもcustomとして保持する', () => {
    const source = {
      birthdayCardBackgroundSource: 'custom',
      birthdayCardAssetId: '123e4567-e89b-42d3-a456-426614174000',
    };

    expect(normalizeRuntimePluginConfig('birthday-role', source)).toBe(source);
    expect(source.birthdayCardBackgroundSource).toBe('custom');
  });
});
""")

plugin_route = "apps/studio/src/app/api/guilds/[guildId]/plugins/[pluginId]/route.ts"
replace_once(
    plugin_route,
    """import { isSameOriginMutationRequest } from '@/lib/request-origin';
import { resolveStudioAccess } from '@/lib/studio-access';
""",
    """import { isSameOriginMutationRequest } from '@/lib/request-origin';
import { resolveStudioAccess } from '@/lib/studio-access';
import { studioBirthdayResource } from '@/lib/studio-policy-resources';
""",
)
replace_once(
    plugin_route,
    """    if (deniedFields.length > 0) {
      return NextResponse.json(
        {
          error: '編集権限のないPlugin設定項目が含まれています',
          fields: deniedFields,
        },
        { status: 403 },
      );
    }
""",
    """    if (deniedFields.length > 0) {
      return NextResponse.json(
        {
          error: '編集権限のないPlugin設定項目が含まれています',
          fields: deniedFields,
        },
        { status: 403 },
      );
    }

    const selectsBirthdayAsset =
      pluginId === 'birthday-role' &&
      validation.config['birthdayCardBackgroundSource'] === 'asset' &&
      changedFields.some(
        (fieldKey) =>
          fieldKey === 'birthdayCardBackgroundSource' || fieldKey === 'birthdayCardAssetId',
      );
    if (
      selectsBirthdayAsset &&
      !hasEffectivePluginPermission(
        access.access,
        'studio.settings.write',
        studioBirthdayResource(guildId, 'card-assets'),
      )
    ) {
      return NextResponse.json(
        {
          error: 'この画像をBirthday Card背景として使用する権限がありません',
          resource: studioBirthdayResource(guildId, 'card-assets'),
        },
        { status: 403 },
      );
    }
""",
)

schema = "packages/db/prisma/schema.prisma"
replace_once(
    schema,
    """  settings               GuildSettings?
  birthdayCardBackground BirthdayCardBackground?
  members                GuildMember[]
""",
    """  settings               GuildSettings?
  birthdayCardBackground BirthdayCardBackground?
  birthdayCardAssets     BirthdayCardAsset[]
  members                GuildMember[]
""",
)
replace_once(
    schema,
    """model User {
""",
    """model BirthdayCardAsset {
  id          String   @id
  guildId     String   @map(\"guild_id\")
  name        String   @db.VarChar(120)
  contentType String   @map(\"content_type\") @db.VarChar(32)
  content     Bytes
  sizeBytes   Int      @map(\"size_bytes\")
  width       Int
  height      Int
  sha256      String   @db.Char(64)
  isPreset    Boolean  @default(false) @map(\"is_preset\")
  createdBy   String   @map(\"created_by\")
  updatedBy   String   @map(\"updated_by\")
  createdAt   DateTime @default(now()) @map(\"created_at\") @db.Timestamptz(3)
  updatedAt   DateTime @default(now()) @updatedAt @map(\"updated_at\") @db.Timestamptz(3)

  guild Guild @relation(fields: [guildId], references: [id], onDelete: Cascade, onUpdate: Cascade)

  // Content, dimensions, and SHA-256 CHECK constraints are enforced by migration SQL.
  @@index([guildId, isPreset(sort: Desc), updatedAt(sort: Desc)], map: \"birthday_card_assets_guild_preset_updated_idx\")
  @@index([guildId, sha256], map: \"birthday_card_assets_guild_sha256_idx\")
  @@map(\"birthday_card_assets\")
}

model User {
""",
)

Path(".github/scripts/nginx-birthday-card.test.mjs").write_text("""import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const nginx = readFileSync('deploy/docker/nginx/default.conf', 'utf8');

test('Birthday Card upload endpoints alone receive the larger nginx body limit', () => {
  const birthdayLocation = nginx.match(
    /location ~ \"\\^\\/api\\/guilds\\/\\[0-9\\]\\{17,20\\}\\/birthday\\/card-\\(background\\|test\\|assets\\)\\$\" \\{(?<body>[\\s\\S]*?)\\n    \\}/u,
  );

  assert.ok(birthdayLocation?.groups?.body, 'Birthday Card upload location must exist');
  assert.match(birthdayLocation.groups.body, /client_max_body_size 9m;/u);
  assert.match(birthdayLocation.groups.body, /proxy_pass http:\\/\\/studio;/u);

  const genericApiLocation = nginx.match(/location \\/api\\/ \\{(?<body>[\\s\\S]*?)\\n    \\}/u);
  assert.ok(genericApiLocation?.groups?.body, 'generic Studio API location must exist');
  assert.doesNotMatch(
    genericApiLocation.groups.body,
    /client_max_body_size/u,
    'larger request bodies must not be enabled for every Studio API',
  );

  const relaxedRoute = /^\\/api\\/guilds\\/[0-9]{17,20}\\/birthday\\/card-(background|test|assets)$/u;
  assert.equal(relaxedRoute.test('/api/guilds/12345678901234567/birthday/card-assets'), true);
  assert.equal(
    relaxedRoute.test('/api/guilds/12345678901234567/birthday/card-assets/asset-id'),
    false,
  );
  assert.equal(
    relaxedRoute.test('/api/guilds/12345678901234567/birthday/card-assets/asset-id/content'),
    false,
  );
});
""")

Path(".github/scripts/birthday-card-asset-library-ui.test.mjs").write_text("""import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const editor = readFileSync('apps/studio/src/components/birthday-card-editor.tsx', 'utf8');
const library = readFileSync('apps/studio/src/components/birthday-card-asset-library.tsx', 'utf8');

test('Upload and Guild Preset promotion remain separate Birthday Card actions', () => {
  assert.match(editor, /method: 'POST'/u);
  assert.match(editor, /\\/birthday\\/card-assets/u);
  assert.match(editor, /\\{ isPreset: !asset\\.isPreset \\}/u);
  assert.match(library, /画像を登録/u);
  assert.match(library, /Presetに追加/u);
  assert.match(library, /Presetから解除/u);
  assert.match(library, /この背景を使用/u);
  assert.match(editor, /canUseAsset =\\s*canWriteAssets &&/su);
  assert.match(
    editor,
    /selectedDraftAsset =\\s*config\\.birthdayCardBackgroundSource === 'asset' &&/su,
  );
  assert.match(
    editor,
    /saved\\.birthdayCardBackgroundSource === 'asset' && asset\\.id === saved\\.birthdayCardAssetId/su,
  );
  assert.match(library, /protectedFromDelete/u);
});
""")

Path(".github/scripts/birthday-card-asset-library-contract.test.mjs").write_text("""import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const dbBackground = readFileSync('packages/db/src/birthday-card-background.ts', 'utf8');
const botRole = readFileSync('apps/bot/src/plugins/birthday-role.ts', 'utf8');
const catalog = readFileSync('packages/plugin-catalog/src/index.ts', 'utf8');
const editor = readFileSync('apps/studio/src/components/birthday-card-editor.tsx', 'utf8');

test('Asset Library selection is wired through a Bot-only background resolver', () => {
  assert.match(dbBackground, /getBirthdayCardRuntimeBackground/u);
  assert.match(dbBackground, /getBirthdayCardAsset\\(prisma, guildId, assetSelection\\)/u);
  assert.match(botRole, /getBirthdayCardRuntimeBackground/u);
  assert.match(botRole, /birthdayCardBackgroundSource === 'asset'/u);
  assert.match(catalog, /return config;/u);
  assert.match(editor, /birthdayCardBackgroundSource: 'asset'/u);
  assert.match(editor, /birthdayCardAssetId: asset\\.id/u);
});

test('Legacy card-background accessor does not expose Asset Library bytes', () => {
  const legacyAccessor = dbBackground.match(
    /export async function getBirthdayCardBackground\\([\\s\\S]*?\\n\\}/u,
  )?.[0];
  assert.ok(legacyAccessor);
  assert.match(legacyAccessor, /getLegacyBirthdayCardBackground/u);
  assert.doesNotMatch(legacyAccessor, /getBirthdayCardAsset/u);
});
""")

migration_test = ".github/scripts/birthday-card-asset-library-migration.test.mjs"
replace_once(
    migration_test,
    """const migration = readFileSync(
  'packages/db/prisma/migrations/20260821013000_birthday_card_asset_library/migration.sql',
  'utf8',
);
""",
    """const migration = readFileSync(
  'packages/db/prisma/migrations/20260821013000_birthday_card_asset_library/migration.sql',
  'utf8',
);
const schema = readFileSync('packages/db/prisma/schema.prisma', 'utf8');
""",
)
replace_once(
    migration_test,
    """  assert.match(migration, /birthday_card_assets_guild_sha256_idx/u);
""",
    """  assert.match(migration, /birthday_card_assets_guild_sha256_idx/u);
  assert.match(schema, /model BirthdayCardAsset/u);
  assert.match(schema, /birthdayCardAssets\\s+BirthdayCardAsset\\[\\]/u);
  assert.match(schema, /@@map\\(\"birthday_card_assets\"\\)/u);
""",
)

config_test = ".github/scripts/birthday-card-asset-library-config.test.mjs"
replace_once(
    config_test,
    """const policyResources = readFileSync('apps/studio/src/lib/studio-policy-resources.ts', 'utf8');
""",
    """const policyResources = readFileSync('apps/studio/src/lib/studio-policy-resources.ts', 'utf8');
const pluginRoute = readFileSync(
  'apps/studio/src/app/api/guilds/[guildId]/plugins/[pluginId]/route.ts',
  'utf8',
);
""",
)
replace_once(
    config_test,
    """  assert.match(policyResources, /'card-presets'/u);
""",
    """  assert.match(policyResources, /'card-presets'/u);
  assert.match(pluginRoute, /studioBirthdayResource\\(guildId, 'card-assets'\\)/u);
  assert.match(pluginRoute, /selectsBirthdayAsset/u);
""",
)
