from pathlib import Path

path = Path('apps/studio/src/components/plugin-config-studio-form.tsx')
text = path.read_text()

import_marker = "import type { GuildConfigurationOptions } from '@/lib/bot-guild-options';\n"
merge_import = "import { mergeDiscordMessageTarget } from '@/lib/discord-message-target';\n"
if merge_import not in text:
    if import_marker not in text:
        raise SystemExit('bot-guild-options import marker not found')
    text = text.replace(import_marker, import_marker + merge_import, 1)

message_branch = """  if (ui?.widget === 'discord-message-target' && supportsDiscordMessageTarget) {
    return (
      <FieldShell title={title} schema={schema} required={required}>
        <DiscordMessageTargetPicker
          guildId={guildId}
          channels={discordOptions?.channels ?? []}
          value={value}
          onChange={(next) => onChange(path, next)}
        />
      </FieldShell>
    );
  }

"""
if message_branch not in text:
    raise SystemExit('message target branch not found')
text = text.replace(message_branch, '', 1)

nullable_block = """  if (nullable && value === null) {
    return (
      <FieldShell title={title} schema={schema} required={required}>
        <div className=\"flex items-center justify-between gap-3 rounded-xl border border-dashed border-border bg-background/60 p-3\">
          <span className=\"text-sm text-muted\">未設定（null）</span>
          <button
            type=\"button\"
            onClick={() => onChange(path, makeDefaultValue({ ...schema, nullable: false, type }))}
            className=\"rounded-lg border border-border px-3 py-2 text-sm hover:bg-surface\"
          >
            値を設定
          </button>
        </div>
      </FieldShell>
    );
  }

"""
if nullable_block not in text:
    raise SystemExit('nullable block not found')

new_message_branch = nullable_block + """  if (ui?.widget === 'discord-message-target' && supportsDiscordMessageTarget) {
    return (
      <FieldShell title={title} schema={schema} required={required}>
        <div className=\"space-y-2\">
          <DiscordMessageTargetPicker
            guildId={guildId}
            channels={discordOptions?.channels ?? []}
            value={value}
            onChange={(next) => onChange(path, mergeDiscordMessageTarget(value, next))}
          />
          {nullable ? (
            <div className=\"flex justify-end\">
              <button
                type=\"button\"
                onClick={() => onChange(path, null)}
                className=\"rounded-lg border border-border px-3 py-2 text-xs text-muted hover:bg-surface hover:text-foreground\"
              >
                未設定（null）に戻す
              </button>
            </div>
          ) : null}
        </div>
      </FieldShell>
    );
  }

"""
text = text.replace(nullable_block, new_message_branch, 1)
path.write_text(text)
