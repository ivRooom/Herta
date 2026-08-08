from pathlib import Path

# ui metadata
path = Path('apps/studio/src/lib/plugin-config-studio.ts')
text = path.read_text()
old = "      | 'discord-emoji'\n      | string;"
new = "      | 'discord-emoji'\n      | 'discord-message-target'\n      | string;"
if old not in text:
    raise SystemExit('widget union target not found')
text = text.replace(old, new, 1)
path.write_text(text)

# Config Studio renderer
path = Path('apps/studio/src/components/plugin-config-studio-form.tsx')
text = path.read_text()
import_marker = "import { DiscordUserPicker } from './discord-user-picker';"
message_import = "import { DiscordMessageTargetPicker } from './discord-message-target-picker';"
if message_import not in text:
    if import_marker not in text:
        raise SystemExit('DiscordUserPicker import target not found')
    text = text.replace(import_marker, message_import + '\n' + import_marker, 1)

picker_marker = """  const supportsDiscordPicker =
    type === 'string' || (type === 'array' && schemaPrimaryType(schema.items ?? {}) === 'string');
"""
picker_extended = picker_marker + """  const messageTargetProperties = schema.properties ?? {};
  const supportsDiscordMessageTarget =
    type === 'object' &&
    schemaPrimaryType(messageTargetProperties.channelId ?? {}) === 'string' &&
    schemaPrimaryType(messageTargetProperties.messageId ?? {}) === 'string';
"""
if 'supportsDiscordMessageTarget' not in text:
    if picker_marker not in text:
        raise SystemExit('supportsDiscordPicker target not found')
    text = text.replace(picker_marker, picker_extended, 1)

emoji_branch = """  if (ui?.widget === 'discord-emoji' && supportsDiscordPicker) {
    return (
      <FieldShell title={title} schema={schema} required={required}>
        <DiscordEmojiPicker
          options={discordOptions?.emojis ?? []}
          value={normalizeDiscordEntityValue(value, discordMultiple)}
          multiple={discordMultiple}
          placeholder={ui.placeholder}
          onChange={(next) => onChange(path, next)}
        />
      </FieldShell>
    );
  }
"""
message_branch = emoji_branch + """

  if (ui?.widget === 'discord-message-target' && supportsDiscordMessageTarget) {
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
if "ui?.widget === 'discord-message-target'" not in text:
    if emoji_branch not in text:
        raise SystemExit('discord emoji branch target not found')
    text = text.replace(emoji_branch, message_branch, 1)

path.write_text(text)
