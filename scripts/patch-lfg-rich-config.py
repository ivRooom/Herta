from pathlib import Path

manager = Path('apps/studio/src/components/lfg-manager.tsx')
text = manager.read_text(encoding='utf-8')
replacements = [
    (
        "import { CheckCircle2, Loader2, Plus, RefreshCw, Search, Users, XCircle } from 'lucide-react';\n",
        "import { CheckCircle2, Loader2, Plus, RefreshCw, Search, Users, XCircle } from 'lucide-react';\nimport type { GuildConfigurationOptions } from '@/lib/bot-guild-options';\nimport { DiscordChannelPicker } from './discord-entity-picker';\n",
    ),
    (
        "const initialForm: CreateForm = {\n",
        "const GAME_PRESETS = [\n  'Minecraft',\n  'VALORANT',\n  'Apex Legends',\n  'Fortnite',\n  'Overwatch 2',\n  'League of Legends',\n  'Splatoon 3',\n  'Monster Hunter Wilds',\n  '雑談・イベント',\n] as const;\n\nconst initialForm: CreateForm = {\n",
    ),
    (
        "  maxPlayersLimit,\n}: {\n  guildId: string;\n  initialPosts: LfgPostItem[];\n  pluginEnabled: boolean;\n  maxPlayersLimit: number;\n}) {",
        "  maxPlayersLimit,\n  discordOptions,\n}: {\n  guildId: string;\n  initialPosts: LfgPostItem[];\n  pluginEnabled: boolean;\n  maxPlayersLimit: number;\n  discordOptions?: GuildConfigurationOptions | null;\n}) {",
    ),
    (
        "              <Detail label=\"チャンネル\" value={detail.post.channelId} />",
        "              <Detail\n                label=\"チャンネル\"\n                value={formatChannelLabel(detail.post.channelId, discordOptions)}\n              />",
    ),
    (
        """          <Field label=\"チャンネルID\">\n            <input\n              required\n              value={form.channelId}\n              onChange={(event) => setForm({ ...form, channelId: event.target.value })}\n              className=\"w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm\"\n            />\n          </Field>\n""",
        """          <Field label=\"投稿チャンネル\">\n            <DiscordChannelPicker\n              options={discordOptions?.channels ?? []}\n              value={form.channelId || null}\n              placeholder=\"募集を投稿するチャンネルを検索\"\n              onChange={(next) =>\n                setForm({ ...form, channelId: Array.isArray(next) ? (next[0] ?? '') : (next ?? '') })\n              }\n            />\n          </Field>\n""",
    ),
    (
        """          <Field label=\"ゲーム・イベント\">\n            <input\n              required\n              value={form.game}\n              onChange={(event) => setForm({ ...form, game: event.target.value })}\n              className=\"w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm\"\n            />\n          </Field>\n""",
        """          <Field label=\"ゲーム・イベント\">\n            <input\n              list=\"lfg-game-presets\"\n              required\n              value={form.game}\n              onChange={(event) => setForm({ ...form, game: event.target.value })}\n              className=\"w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm\"\n              placeholder=\"ゲーム名またはイベント名\"\n              autoComplete=\"off\"\n            />\n            <datalist id=\"lfg-game-presets\">\n              {GAME_PRESETS.map((game) => (\n                <option key={game} value={game} />\n              ))}\n            </datalist>\n          </Field>\n""",
    ),
]
for old, new in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'manager target count must be 1, got {count}: {old[:100]!r}')
    text = text.replace(old, new, 1)

helper_marker = "function Detail({ label, value }: { label: string; value: string }) {"
helper = """function formatChannelLabel(\n  channelId: string,\n  discordOptions?: GuildConfigurationOptions | null,\n): string {\n  const channel = discordOptions?.channels.find((candidate) => candidate.id === channelId);\n  return channel ? `#${channel.name}` : channelId;\n}\n\n"""
if text.count(helper_marker) != 1:
    raise SystemExit('detail marker not found exactly once')
text = text.replace(helper_marker, helper + helper_marker, 1)
manager.write_text(text, encoding='utf-8')

page = Path('apps/studio/src/app/dashboard/guilds/[guildId]/lfg/page.tsx')
text = page.read_text(encoding='utf-8')
replacements = [
    (
        "import { getGuildPlugin } from '@/lib/guild-plugins';\n",
        "import { getGuildPlugin } from '@/lib/guild-plugins';\nimport { getGuildConfigurationOptions } from '@/lib/bot-guild-options';\n",
    ),
    (
        "  const plugin = await getGuildPlugin(guildId, 'lfg');\n  if (!plugin) notFound();\n",
        "  const [plugin, discordOptions] = await Promise.all([\n    getGuildPlugin(guildId, 'lfg'),\n    getGuildConfigurationOptions(guildId),\n  ]);\n  if (!plugin) notFound();\n",
    ),
    (
        "            maxPlayersLimit={config.maxPlayersLimit}\n          />",
        "            maxPlayersLimit={config.maxPlayersLimit}\n            discordOptions={discordOptions}\n          />",
    ),
]
for old, new in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'page target count must be 1, got {count}: {old[:100]!r}')
    text = text.replace(old, new, 1)
page.write_text(text, encoding='utf-8')
