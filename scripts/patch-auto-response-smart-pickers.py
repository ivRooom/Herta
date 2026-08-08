from pathlib import Path

manager = Path('apps/studio/src/components/auto-response-rule-manager.tsx')
text = manager.read_text(encoding='utf-8')
replacements = [
    (
        "import { Loader2, Plus, Save, Trash2 } from 'lucide-react';\n",
        "import { Loader2, Plus, Save, Trash2 } from 'lucide-react';\nimport type { GuildConfigurationOptions } from '@/lib/bot-guild-options';\nimport { DiscordChannelPicker, DiscordRolePicker } from './discord-entity-picker';\n",
    ),
    ("  channelIds: string;\n  roleIds: string;\n", "  channelIds: string[];\n  roleIds: string[];\n"),
    ("    channelIds: '',\n    roleIds: '',\n", "    channelIds: [],\n    roleIds: [],\n"),
    (
        "  defaultRuleCooldownSeconds: number;\n}\n",
        "  defaultRuleCooldownSeconds: number;\n  discordOptions?: GuildConfigurationOptions | null;\n}\n",
    ),
    (
        "  defaultRuleCooldownSeconds,\n}: RuleManagerProps) {",
        "  defaultRuleCooldownSeconds,\n  discordOptions,\n}: RuleManagerProps) {",
    ),
    (
        "          <RuleFields value={draft} onChange={setDraft} />",
        "          <RuleFields value={draft} onChange={setDraft} discordOptions={discordOptions} />",
    ),
    (
        "              onDeleted={(ruleId) => {\n                setRules((current) => current.filter((candidate) => candidate.id !== ruleId));\n                router.refresh();\n              }}\n            />",
        "              onDeleted={(ruleId) => {\n                setRules((current) => current.filter((candidate) => candidate.id !== ruleId));\n                router.refresh();\n              }}\n              discordOptions={discordOptions}\n            />",
    ),
    (
        "  onDeleted,\n}: {\n  guildId: string;\n  rule: AutoResponseRuleItem;\n  onUpdated(rule: AutoResponseRuleItem): void;\n  onDeleted(ruleId: string): void;\n}) {",
        "  onDeleted,\n  discordOptions,\n}: {\n  guildId: string;\n  rule: AutoResponseRuleItem;\n  onUpdated(rule: AutoResponseRuleItem): void;\n  onDeleted(ruleId: string): void;\n  discordOptions?: GuildConfigurationOptions | null;\n}) {",
    ),
    (
        "        <RuleFields value={draft} onChange={setDraft} />",
        "        <RuleFields value={draft} onChange={setDraft} discordOptions={discordOptions} />",
    ),
    (
        "function RuleFields({ value, onChange }: { value: RuleDraft; onChange(value: RuleDraft): void }) {",
        "function RuleFields({\n  value,\n  onChange,\n  discordOptions,\n}: {\n  value: RuleDraft;\n  onChange(value: RuleDraft): void;\n  discordOptions?: GuildConfigurationOptions | null;\n}) {",
    ),
    (
        """      <Field label=\"対象チャンネルID（カンマ区切り）\">\n        <input\n          value={value.channelIds}\n          onChange={(event) => update('channelIds', event.target.value)}\n          className=\"input font-mono\"\n          placeholder=\"123456789, 987654321\"\n        />\n      </Field>\n      <Field label=\"対象ロールID（カンマ区切り）\">\n        <input\n          value={value.roleIds}\n          onChange={(event) => update('roleIds', event.target.value)}\n          className=\"input font-mono\"\n          placeholder=\"123456789\"\n        />\n      </Field>\n""",
        """      <Field label=\"対象チャンネル\">\n        <DiscordChannelPicker\n          options={discordOptions?.channels ?? []}\n          value={value.channelIds}\n          multiple\n          placeholder=\"対象チャンネルを検索\"\n          onChange={(next) => update('channelIds', Array.isArray(next) ? next : next ? [next] : [])}\n        />\n      </Field>\n      <Field label=\"対象ロール\">\n        <DiscordRolePicker\n          options={discordOptions?.roles ?? []}\n          value={value.roleIds}\n          multiple\n          placeholder=\"対象ロールを検索\"\n          onChange={(next) => update('roleIds', Array.isArray(next) ? next : next ? [next] : [])}\n        />\n      </Field>\n""",
    ),
    ("    channelIds: rule.channelIds.join(', '),\n    roleIds: rule.roleIds.join(', '),\n", "    channelIds: [...rule.channelIds],\n    roleIds: [...rule.roleIds],\n"),
    (
        """function toRequestBody(draft: RuleDraft) {\n  return {\n    ...draft,\n    channelIds: splitIds(draft.channelIds),\n    roleIds: splitIds(draft.roleIds),\n  };\n}\n\nfunction splitIds(value: string): string[] {\n  return value\n    .split(',')\n    .map((item) => item.trim())\n    .filter(Boolean);\n}\n""",
        """function toRequestBody(draft: RuleDraft) {\n  return {\n    ...draft,\n    channelIds: [...draft.channelIds],\n    roleIds: [...draft.roleIds],\n  };\n}\n""",
    ),
]

for old, new in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'manager target count must be 1, got {count}: {old[:100]!r}')
    text = text.replace(old, new, 1)
manager.write_text(text, encoding='utf-8')

page = Path('apps/studio/src/app/dashboard/guilds/[guildId]/auto-response/page.tsx')
text = page.read_text(encoding='utf-8')
replacements = [
    (
        "import { getGuildPlugin } from '@/lib/guild-plugins';\n",
        "import { getGuildPlugin } from '@/lib/guild-plugins';\nimport { getGuildConfigurationOptions } from '@/lib/bot-guild-options';\n",
    ),
    (
        "  const plugin = await getGuildPlugin(guildId, 'auto-response');\n  if (!plugin) notFound();\n",
        "  const [plugin, discordOptions] = await Promise.all([\n    getGuildPlugin(guildId, 'auto-response'),\n    getGuildConfigurationOptions(guildId),\n  ]);\n  if (!plugin) notFound();\n",
    ),
    (
        "            defaultRuleCooldownSeconds={config.defaultRuleCooldownSeconds}\n          />",
        "            defaultRuleCooldownSeconds={config.defaultRuleCooldownSeconds}\n            discordOptions={discordOptions}\n          />",
    ),
]
for old, new in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'page target count must be 1, got {count}: {old[:100]!r}')
    text = text.replace(old, new, 1)
page.write_text(text, encoding='utf-8')
