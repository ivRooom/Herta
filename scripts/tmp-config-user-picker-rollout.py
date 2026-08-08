from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    text = file_path.read_text(encoding="utf-8")
    if text.count(old) != 1:
        raise SystemExit(f"{path}: expected exactly one match, got {text.count(old)}")
    file_path.write_text(text.replace(old, new, 1), encoding="utf-8")


team_split = "apps/studio/src/components/team-split-manager.tsx"
replace_once(
    team_split,
    "import { DiscordChannelPicker } from './discord-entity-picker';\n",
    "import { DiscordChannelPicker } from './discord-entity-picker';\n"
    "import { DiscordUserPicker } from './discord-user-picker';\n",
)
replace_once(
    team_split,
    '''              <input
                className={`${inputClass} mt-3`}
                value={participantUserId}
                onChange={(event) => setParticipantUserId(event.target.value)}
                placeholder="DiscordユーザーID"
                pattern="\\d{17,20}"
                required
              />''',
    '''              <div className="mt-3">
                <DiscordUserPicker
                  guildId={guildId}
                  value={participantUserId || null}
                  includeBots={false}
                  placeholder="参加者をユーザー名・表示名・IDで検索"
                  onChange={(value) =>
                    setParticipantUserId(
                      Array.isArray(value) ? (value[0] ?? '') : (value ?? ''),
                    )
                  }
                />
              </div>''',
)
replace_once(
    team_split,
    "disabled={!pluginEnabled || loading || detail.session.status !== 'open'}\n                className=\"mt-2 inline-flex",
    "disabled={\n                  !pluginEnabled ||\n                  loading ||\n                  detail.session.status !== 'open' ||\n                  !participantUserId\n                }\n                className=\"mt-2 inline-flex",
)

moderation = "apps/studio/src/components/moderation-config-form.tsx"
replace_once(
    moderation,
    "import { DiscordChannelPicker, DiscordRolePicker } from '@/components/discord-entity-picker';\n",
    "import { DiscordChannelPicker, DiscordRolePicker } from '@/components/discord-entity-picker';\n"
    "import { DiscordUserPicker } from '@/components/discord-user-picker';\n",
)
replace_once(
    moderation,
    '''          <ExemptionsSection
            config={config}
            patchConfig={patchConfig}
            discordOptions={discordOptions}
          />''',
    '''          <ExemptionsSection
            guildId={guildId}
            config={config}
            patchConfig={patchConfig}
            discordOptions={discordOptions}
          />''',
)
replace_once(
    moderation,
    '''function ExemptionsSection({
  config,
  patchConfig,
  discordOptions,
}: {
  config: ModerationConfigDraft;''',
    '''function ExemptionsSection({
  guildId,
  config,
  patchConfig,
  discordOptions,
}: {
  guildId: string;
  config: ModerationConfigDraft;''',
)
replace_once(
    moderation,
    '''        <IdListEditor
          title="除外ユーザーID"
          description="Bot・管理者など個別ユーザーを自動検知から除外します。"
          values={config.autoExemptUserIds}
          onChange={(values) => patchConfig({ autoExemptUserIds: values })}
        />''',
    '''        <div className="rounded-xl border border-border bg-background p-4">
          <p className="text-sm font-medium">除外ユーザー</p>
          <p className="mt-1 text-xs leading-5 text-muted">
            Bot・管理者など個別ユーザーを名前・表示名・IDで検索して自動検知から除外します。
          </p>
          <div className="mt-3">
            <DiscordUserPicker
              guildId={guildId}
              value={config.autoExemptUserIds}
              multiple
              placeholder="除外するユーザーを検索"
              onChange={(value) =>
                patchConfig({ autoExemptUserIds: Array.isArray(value) ? value : [] })
              }
            />
          </div>
        </div>''',
)

print("Config Studio User Picker rollout applied")
