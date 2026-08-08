from pathlib import Path

path = Path('apps/studio/src/components/plugin-config-studio-form.tsx')
text = path.read_text(encoding='utf-8')
replacements = [
    (
        "import type { GuildConfigurationOptions } from '@/lib/bot-guild-options';\nimport { DiscordChannelPicker, DiscordRolePicker } from './discord-entity-picker';\n",
        "import type { GuildConfigurationOptions } from '@/lib/bot-guild-options';\nimport { DiscordChannelPicker, DiscordRolePicker } from './discord-entity-picker';\nimport { DiscordUserPicker } from './discord-user-picker';\n",
    ),
    (
        "                      onRemove={remove}\n                      discordOptions={discordOptions}\n                    />",
        "                      onRemove={remove}\n                      discordOptions={discordOptions}\n                      guildId={guildId}\n                    />",
    ),
    (
        "  onRemove,\n  discordOptions,\n}: {\n",
        "  onRemove,\n  discordOptions,\n  guildId,\n}: {\n",
    ),
    (
        "  onRemove: (path: Path) => void;\n  discordOptions?: GuildConfigurationOptions | null;\n}) {",
        "  onRemove: (path: Path) => void;\n  discordOptions?: GuildConfigurationOptions | null;\n  guildId: string;\n}) {",
    ),
    (
        "  if (ui?.widget === 'discord-role' && supportsDiscordPicker) {\n    return (\n      <FieldShell title={title} schema={schema} required={required}>\n        <DiscordRolePicker\n          options={discordOptions?.roles ?? []}\n          value={normalizeDiscordEntityValue(value, discordMultiple)}\n          multiple={discordMultiple}\n          placeholder={ui.placeholder}\n          editableOnly={ui.editableOnly}\n          mentionableOnly={ui.mentionableOnly}\n          onChange={(next) => onChange(path, next)}\n        />\n      </FieldShell>\n    );\n  }\n\n",
        "  if (ui?.widget === 'discord-role' && supportsDiscordPicker) {\n    return (\n      <FieldShell title={title} schema={schema} required={required}>\n        <DiscordRolePicker\n          options={discordOptions?.roles ?? []}\n          value={normalizeDiscordEntityValue(value, discordMultiple)}\n          multiple={discordMultiple}\n          placeholder={ui.placeholder}\n          editableOnly={ui.editableOnly}\n          mentionableOnly={ui.mentionableOnly}\n          onChange={(next) => onChange(path, next)}\n        />\n      </FieldShell>\n    );\n  }\n\n  if (ui?.widget === 'discord-user' && supportsDiscordPicker) {\n    return (\n      <FieldShell title={title} schema={schema} required={required}>\n        <DiscordUserPicker\n          guildId={guildId}\n          value={normalizeDiscordEntityValue(value, discordMultiple)}\n          multiple={discordMultiple}\n          placeholder={ui.placeholder}\n          onChange={(next) => onChange(path, next)}\n        />\n      </FieldShell>\n    );\n  }\n\n",
    ),
    (
        "              onRemove={onRemove}\n              discordOptions={discordOptions}\n            />",
        "              onRemove={onRemove}\n              discordOptions={discordOptions}\n              guildId={guildId}\n            />",
    ),
    (
        "                onRemove={onRemove}\n                discordOptions={discordOptions}\n              />",
        "                onRemove={onRemove}\n                discordOptions={discordOptions}\n                guildId={guildId}\n              />",
    ),
]

for old, new in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'target count must be 1, got {count}: {old[:100]!r}')
    text = text.replace(old, new, 1)

path.write_text(text, encoding='utf-8')
