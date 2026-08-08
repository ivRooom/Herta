from pathlib import Path

path = Path('apps/studio/src/components/plugin-config-studio-form.tsx')
text = path.read_text(encoding='utf-8')

replacements = [
    (
        "import { useMemo, useState } from 'react';\n\nimport {\n",
        "import { useMemo, useState } from 'react';\n\nimport type { GuildConfigurationOptions } from '@/lib/bot-guild-options';\nimport { DiscordChannelPicker, DiscordRolePicker } from './discord-entity-picker';\n\nimport {\n",
    ),
    (
        "  initialConfig,\n  schema,\n}: {\n  guildId: string;\n  pluginId: string;\n  initialEnabled: boolean;\n  initialConfig: Record<string, unknown>;\n  schema: Record<string, unknown>;\n}) {",
        "  initialConfig,\n  schema,\n  discordOptions,\n}: {\n  guildId: string;\n  pluginId: string;\n  initialEnabled: boolean;\n  initialConfig: Record<string, unknown>;\n  schema: Record<string, unknown>;\n  discordOptions?: GuildConfigurationOptions | null;\n}) {",
    ),
    (
        "                      onChange={update}\n                      onRemove={remove}\n                    />",
        "                      onChange={update}\n                      onRemove={remove}\n                      discordOptions={discordOptions}\n                    />",
    ),
    (
        "  required,\n  onChange,\n  onRemove,\n}: {\n  fieldKey: string;\n  schema: JsonSchema;\n  value: unknown;\n  path: Path;\n  required?: boolean;\n  onChange: (path: Path, value: unknown) => void;\n  onRemove: (path: Path) => void;\n}) {",
        "  required,\n  onChange,\n  onRemove,\n  discordOptions,\n}: {\n  fieldKey: string;\n  schema: JsonSchema;\n  value: unknown;\n  path: Path;\n  required?: boolean;\n  onChange: (path: Path, value: unknown) => void;\n  onRemove: (path: Path) => void;\n  discordOptions?: GuildConfigurationOptions | null;\n}) {",
    ),
    (
        "  const ui = schema['x-herta-ui'];\n\n  if (nullable && value === null) {",
        "  const ui = schema['x-herta-ui'];\n  const discordMultiple = type === 'array' || ui?.multiple === true;\n\n  if (ui?.widget === 'discord-channel' && (type === 'string' || type === 'array')) {\n    return (\n      <FieldShell title={title} schema={schema} required={required}>\n        <DiscordChannelPicker\n          options={discordOptions?.channels ?? []}\n          value={normalizeDiscordEntityValue(value, discordMultiple)}\n          multiple={discordMultiple}\n          placeholder={ui.placeholder}\n          onChange={(next) => onChange(path, next)}\n        />\n      </FieldShell>\n    );\n  }\n\n  if (ui?.widget === 'discord-role' && (type === 'string' || type === 'array')) {\n    return (\n      <FieldShell title={title} schema={schema} required={required}>\n        <DiscordRolePicker\n          options={discordOptions?.roles ?? []}\n          value={normalizeDiscordEntityValue(value, discordMultiple)}\n          multiple={discordMultiple}\n          placeholder={ui.placeholder}\n          editableOnly={ui.editableOnly}\n          mentionableOnly={ui.mentionableOnly}\n          onChange={(next) => onChange(path, next)}\n        />\n      </FieldShell>\n    );\n  }\n\n  if (nullable && value === null) {",
    ),
    (
        "              onChange={onChange}\n              onRemove={onRemove}\n            />",
        "              onChange={onChange}\n              onRemove={onRemove}\n              discordOptions={discordOptions}\n            />",
    ),
    (
        "                onChange={onChange}\n                onRemove={onRemove}\n              />",
        "                onChange={onChange}\n                onRemove={onRemove}\n                discordOptions={discordOptions}\n              />",
    ),
]

for old, new in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'replacement target count must be 1, got {count}: {old[:80]!r}')
    text = text.replace(old, new, 1)

helper_marker = "function humanizeKey(key: string): string {"
helper = """function normalizeDiscordEntityValue(\n  value: unknown,\n  multiple: boolean,\n): string | string[] | null {\n  if (multiple) {\n    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];\n  }\n  return typeof value === 'string' && value ? value : null;\n}\n\n"""
if text.count(helper_marker) != 1:
    raise SystemExit('helper marker not found exactly once')
text = text.replace(helper_marker, helper + helper_marker, 1)

path.write_text(text, encoding='utf-8')
