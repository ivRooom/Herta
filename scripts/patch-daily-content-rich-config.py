from pathlib import Path

manager = Path('apps/studio/src/components/daily-content-manager.tsx')
text = manager.read_text(encoding='utf-8')
replacements = [
    (
        "import { useRouter } from 'next/navigation';\n",
        "import { useRouter } from 'next/navigation';\nimport type { GuildConfigurationOptions } from '@/lib/bot-guild-options';\nimport { DiscordChannelPicker } from './discord-entity-picker';\n",
    ),
    (
        "const EMPTY_FORM: DailyContentFormState = {\n",
        "const COMMON_TIMEZONES = [\n  'Asia/Tokyo',\n  'Asia/Seoul',\n  'Asia/Singapore',\n  'UTC',\n  'Europe/London',\n  'Europe/Paris',\n  'America/New_York',\n  'America/Chicago',\n  'America/Denver',\n  'America/Los_Angeles',\n  'Australia/Sydney',\n] as const;\n\nconst EMPTY_FORM: DailyContentFormState = {\n",
    ),
    (
        "  pluginEnabled,\n}: {\n  guildId: string;\n  initialSchedules: DailyContentScheduleItem[];\n  initialDeliveries: DailyContentDeliveryItem[];\n  defaultTimezone: string;\n  maxContentLength: number;\n  pluginEnabled: boolean;\n}) {",
        "  pluginEnabled,\n  discordOptions,\n}: {\n  guildId: string;\n  initialSchedules: DailyContentScheduleItem[];\n  initialDeliveries: DailyContentDeliveryItem[];\n  defaultTimezone: string;\n  maxContentLength: number;\n  pluginEnabled: boolean;\n  discordOptions?: GuildConfigurationOptions | null;\n}) {",
    ),
    (
        """          <Field label=\"DiscordチャンネルID\">\n            <input\n              value={form.channelId}\n              onChange={(event) => setForm({ ...form, channelId: event.target.value })}\n              required\n              inputMode=\"numeric\"\n              pattern=\"\\d{17,20}\"\n              className={INPUT_CLASS_NAME}\n              placeholder=\"123456789012345678\"\n            />\n          </Field>\n""",
        """          <Field label=\"配信先チャンネル\">\n            <DiscordChannelPicker\n              options={discordOptions?.channels ?? []}\n              value={form.channelId || null}\n              placeholder=\"配信先チャンネルを検索\"\n              onChange={(next) =>\n                setForm({ ...form, channelId: Array.isArray(next) ? (next[0] ?? '') : (next ?? '') })\n              }\n            />\n            <p className=\"mt-1 text-[11px] text-muted\">\n              チャンネル名またはIDで検索できます。JSON/APIには従来どおりDiscord IDを保存します。\n            </p>\n          </Field>\n""",
    ),
    (
        """          <Field label=\"IANA timezone\">\n            <input\n              value={form.timezone}\n              onChange={(event) => setForm({ ...form, timezone: event.target.value })}\n              required\n              className={INPUT_CLASS_NAME}\n              placeholder=\"Asia/Tokyo\"\n            />\n          </Field>\n""",
        """          <Field label=\"Timezone\">\n            <input\n              list=\"daily-content-timezones\"\n              value={form.timezone}\n              onChange={(event) => setForm({ ...form, timezone: event.target.value })}\n              required\n              className={INPUT_CLASS_NAME}\n              placeholder=\"Asia/Tokyo\"\n              autoComplete=\"off\"\n            />\n            <datalist id=\"daily-content-timezones\">\n              {COMMON_TIMEZONES.map((timezone) => (\n                <option key={timezone} value={timezone} />\n              ))}\n            </datalist>\n            <p className=\"mt-1 text-[11px] text-muted\">主要Timezoneから選択するか、IANA timezoneを直接入力できます。</p>\n          </Field>\n""",
    ),
    (
        """                    <p className=\"mt-1 text-xs text-muted\">\n                      <span className=\"font-mono\">{schedule.scheduleTime}</span> {schedule.timezone}{' '}\n                      · <span className=\"font-mono\">#{schedule.channelId}</span>\n                    </p>\n""",
        """                    <p className=\"mt-1 text-xs text-muted\">\n                      <span className=\"font-mono\">{schedule.scheduleTime}</span> {schedule.timezone}{' '}\n                      · {formatChannelLabel(schedule.channelId, discordOptions)}\n                    </p>\n""",
    ),
]
for old, new in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'manager target count must be 1, got {count}: {old[:100]!r}')
    text = text.replace(old, new, 1)

helper_marker = "function Field({ label, children }: { label: string; children: React.ReactNode }) {"
helper = """function formatChannelLabel(\n  channelId: string,\n  discordOptions?: GuildConfigurationOptions | null,\n): string {\n  const channel = discordOptions?.channels.find((candidate) => candidate.id === channelId);\n  return channel ? `#${channel.name}` : `#${channelId}`;\n}\n\n"""
if text.count(helper_marker) != 1:
    raise SystemExit('field helper marker not found exactly once')
text = text.replace(helper_marker, helper + helper_marker, 1)
manager.write_text(text, encoding='utf-8')

page = Path('apps/studio/src/app/dashboard/guilds/[guildId]/daily-content/page.tsx')
text = page.read_text(encoding='utf-8')
replacements = [
    (
        "import { getGuildPlugin } from '@/lib/guild-plugins';\n",
        "import { getGuildPlugin } from '@/lib/guild-plugins';\nimport { getGuildConfigurationOptions } from '@/lib/bot-guild-options';\n",
    ),
    (
        "  const plugin = await getGuildPlugin(guildId, 'daily-content');\n  if (!plugin) notFound();\n",
        "  const [plugin, discordOptions] = await Promise.all([\n    getGuildPlugin(guildId, 'daily-content'),\n    getGuildConfigurationOptions(guildId),\n  ]);\n  if (!plugin) notFound();\n",
    ),
    (
        "            pluginEnabled={plugin.enabled}\n          />",
        "            pluginEnabled={plugin.enabled}\n            discordOptions={discordOptions}\n          />",
    ),
]
for old, new in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'page target count must be 1, got {count}: {old[:100]!r}')
    text = text.replace(old, new, 1)
page.write_text(text, encoding='utf-8')
