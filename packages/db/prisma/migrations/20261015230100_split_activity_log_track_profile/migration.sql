-- activity-logプラグインのconfig.trackProfile(1フラグに6種類のイベントが相乗り)を
-- 4つの細分化フラグ(trackNicknameAvatar/trackMemberRoles/trackServerSettings/
-- trackChannelManagement)へ分割する。configSchemaがadditionalProperties: falseで
-- 検証されるため、保存済みconfigに残ったtrackProfileキーを消さないと以後そのGuildの
-- activity-log設定が一切保存できなくなる(PATCH時に保存済みconfigを土台にマージする
-- 経路があるため)。既存の意思(trackProfile: false等)は4フラグへ引き継ぐ。
UPDATE guild_plugins
SET config = (config - 'trackProfile') || jsonb_build_object(
  'trackNicknameAvatar', COALESCE((config->>'trackProfile')::boolean, true),
  'trackMemberRoles', COALESCE((config->>'trackProfile')::boolean, true),
  'trackServerSettings', COALESCE((config->>'trackProfile')::boolean, true),
  'trackChannelManagement', COALESCE((config->>'trackProfile')::boolean, true)
)
WHERE plugin_id = 'activity-log' AND config ? 'trackProfile';
