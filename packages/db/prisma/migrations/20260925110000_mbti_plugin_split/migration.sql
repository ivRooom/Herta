-- MBTI診断をmini-games Pluginから独立したmbti Pluginへ分離するためのデータ移行。
-- スキーマ変更は無く、既存のplugins/guild_pluginsテーブルへの一回限りのデータ操作のみ行う。

-- 1. mbti Plugin catalogの行を用意する（guild_plugins.plugin_idのFK制約を満たすため）。
--    name/description/manifestはStudioで設定を保存した時点で正しい値へ上書きされるため、
--    ここでは最小限の妥当な値を入れておけば十分。
INSERT INTO "plugins" (id, name, description, version, author, category, is_official, manifest, created_at)
VALUES (
    'mbti',
    'MBTI',
    '50問の5段階評価に答えてMBTI風の性格診断を行い、結果に応じてDiscord Roleを自動付与できるPluginです',
    '1.0.0',
    'Herta',
    'fun',
    true,
    '{}'::jsonb,
    CURRENT_TIMESTAMP
)
ON CONFLICT (id) DO NOTHING;

-- 2. mini-games Pluginを導入済みの各Guildへ、mbti Pluginの行を新設する。
--    有効/無効状態はmini-games側の状態をそのまま引き継ぎ、/mbtiが引き続き同じ状態で
--    使えるようにする。mbtiRole<TYPE>の16キーはmini-games.configから抽出してコピーする。
INSERT INTO "guild_plugins" (guild_id, plugin_id, enabled, config, config_version, installed_at, updated_at)
SELECT
    guild_id,
    'mbti',
    enabled,
    jsonb_build_object(
        'enabled', true,
        'mbtiRoleINTJ', config->'mbtiRoleINTJ',
        'mbtiRoleINTP', config->'mbtiRoleINTP',
        'mbtiRoleENTJ', config->'mbtiRoleENTJ',
        'mbtiRoleENTP', config->'mbtiRoleENTP',
        'mbtiRoleINFJ', config->'mbtiRoleINFJ',
        'mbtiRoleINFP', config->'mbtiRoleINFP',
        'mbtiRoleENFJ', config->'mbtiRoleENFJ',
        'mbtiRoleENFP', config->'mbtiRoleENFP',
        'mbtiRoleISTJ', config->'mbtiRoleISTJ',
        'mbtiRoleISFJ', config->'mbtiRoleISFJ',
        'mbtiRoleESTJ', config->'mbtiRoleESTJ',
        'mbtiRoleESFJ', config->'mbtiRoleESFJ',
        'mbtiRoleISTP', config->'mbtiRoleISTP',
        'mbtiRoleISFP', config->'mbtiRoleISFP',
        'mbtiRoleESTP', config->'mbtiRoleESTP',
        'mbtiRoleESFP', config->'mbtiRoleESFP'
    ),
    1,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "guild_plugins"
WHERE plugin_id = 'mini-games'
ON CONFLICT (guild_id, plugin_id) DO NOTHING;

-- 3. mini-games側のconfigから、移行済みのmbtiRole<TYPE>キーを取り除く
--    （新しいmini-games manifestのconfigSchemaはこれらのキーを持たず、
--    additionalProperties: falseのため残したままだと次回Studio保存時に検証エラーになる）。
UPDATE "guild_plugins"
SET config = config
    - 'mbtiRoleINTJ' - 'mbtiRoleINTP' - 'mbtiRoleENTJ' - 'mbtiRoleENTP'
    - 'mbtiRoleINFJ' - 'mbtiRoleINFP' - 'mbtiRoleENFJ' - 'mbtiRoleENFP'
    - 'mbtiRoleISTJ' - 'mbtiRoleISFJ' - 'mbtiRoleESTJ' - 'mbtiRoleESFJ'
    - 'mbtiRoleISTP' - 'mbtiRoleISFP' - 'mbtiRoleESTP' - 'mbtiRoleESFP'
WHERE plugin_id = 'mini-games';
