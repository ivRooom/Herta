-- activity-logプラグインのconfig.trackProfile(1フラグに6種類のイベントが相乗り)を
-- 4つの細分化フラグ(trackNicknameAvatar/trackMemberRoles/trackServerSettings/
-- trackChannelManagement)へ分割し、合わせて今回新設した6つのトグル(trackInvites/
-- trackMembership/trackUsernameChange/trackRoleManagement/trackModerationBans/
-- trackTimeout)もデフォルトtrueで全activity-log行へ補完する。
--
-- configSchemaはadditionalProperties: falseかつ新フィールドもrequiredで検証される
-- (apps/studio/src/lib/plugin-config-ajv.ts)。保存済みconfigに残ったtrackProfileキーを
-- 消さないと以後そのGuildのactivity-log設定が一切保存できなくなる点に加え、
-- configPathPatch経由の個別フィールド更新(apps/studio/src/lib/plugin-config-patch.tsの
-- setExistingConfigPath)はまだ存在しないキーへの書き込みを拒否するため、新設6フラグを
-- 保存済みconfigへ事前に補完しておかないと、それらのトグルをStudioから一切変更できなく
-- なる(Ajvのdefault補完はキーが最初から無い場合には効くが、path-patch自体がキー不在を
-- 拒否するため、そちらには効かない)。
-- 既存の意思(trackProfile: false等)は4フラグへ引き継ぐ。新設6フラグは既存Guildに
-- とって新規追加の記録対象のため、他のtrackXxxと同じ既定trueとする。
UPDATE guild_plugins
SET config = (config - 'trackProfile') || jsonb_build_object(
  'trackNicknameAvatar', COALESCE((config->>'trackProfile')::boolean, true),
  'trackMemberRoles', COALESCE((config->>'trackProfile')::boolean, true),
  'trackServerSettings', COALESCE((config->>'trackProfile')::boolean, true),
  'trackChannelManagement', COALESCE((config->>'trackProfile')::boolean, true),
  'trackInvites', true,
  'trackMembership', true,
  'trackUsernameChange', true,
  'trackRoleManagement', true,
  'trackModerationBans', true,
  'trackTimeout', true
)
WHERE plugin_id = 'activity-log';
