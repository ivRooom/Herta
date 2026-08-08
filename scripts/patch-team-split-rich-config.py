from pathlib import Path

manager = Path('apps/studio/src/components/team-split-manager.tsx')
text = manager.read_text(encoding='utf-8')
replacements = [
    (
        "import { Loader2, RefreshCw, Shuffle, UserMinus, UserPlus } from 'lucide-react';\n",
        "import { Loader2, RefreshCw, Shuffle, UserMinus, UserPlus } from 'lucide-react';\nimport type { GuildConfigurationOptions } from '@/lib/bot-guild-options';\nimport { DiscordChannelPicker } from './discord-entity-picker';\n",
    ),
    (
        "  maxTeamCount: number;\n}\n",
        "  maxTeamCount: number;\n  discordOptions?: GuildConfigurationOptions | null;\n}\n",
    ),
    (
        "  maxParticipantsLimit,\n  maxTeamCount,\n}: Props) {",
        "  maxParticipantsLimit,\n  maxTeamCount,\n  discordOptions,\n}: Props) {",
    ),
    (
        """            <label className=\"text-sm\">\n              <span className=\"mb-1.5 block text-muted\">チャンネルID</span>\n              <input\n                className={inputClass}\n                value={channelId}\n                onChange={(event) => setChannelId(event.target.value)}\n                required\n                pattern=\"\\d{17,20}\"\n              />\n            </label>\n""",
        """            <div className=\"text-sm\">\n              <span className=\"mb-1.5 block text-muted\">投稿チャンネル</span>\n              <DiscordChannelPicker\n                options={discordOptions?.channels ?? []}\n                value={channelId || null}\n                placeholder=\"参加募集を投稿するチャンネルを検索\"\n                onChange={(next) =>\n                  setChannelId(Array.isArray(next) ? (next[0] ?? '') : (next ?? ''))\n                }\n              />\n            </div>\n""",
    ),
    (
        """            <label className=\"text-sm\">\n              <span className=\"mb-1.5 block text-muted\">方式</span>\n              <select\n                className={inputClass}\n                value={mode}\n                onChange={(event) => setMode(event.target.value as 'random' | 'balanced')}\n              >\n                <option value=\"random\">ランダム</option>\n                <option value=\"balanced\">明示scoreで均等化</option>\n              </select>\n            </label>\n""",
        """            <div className=\"text-sm md:col-span-2\">\n              <span className=\"mb-1.5 block text-muted\">チーム分け方式</span>\n              <div className=\"grid gap-2 sm:grid-cols-2\">\n                <ModeCard\n                  active={mode === 'random'}\n                  title=\"ランダム\"\n                  description=\"参加者をランダムに割り当てます。気軽な募集向けです。\"\n                  onClick={() => setMode('random')}\n                />\n                <ModeCard\n                  active={mode === 'balanced'}\n                  title=\"バランス\"\n                  description=\"各参加者のscoreを使い、チーム合計値が近くなるように分けます。\"\n                  onClick={() => setMode('balanced')}\n                />\n              </div>\n            </div>\n""",
    ),
]
for old, new in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'manager target count must be 1, got {count}: {old[:100]!r}')
    text = text.replace(old, new, 1)

helper_marker = "function formatDate(value: string): string {"
helper = """function ModeCard({\n  active,\n  title,\n  description,\n  onClick,\n}: {\n  active: boolean;\n  title: string;\n  description: string;\n  onClick(): void;\n}) {\n  return (\n    <button\n      type=\"button\"\n      onClick={onClick}\n      aria-pressed={active}\n      className={`rounded-xl border p-3 text-left transition-colors ${\n        active ? 'border-primary bg-primary/10' : 'border-border bg-background hover:border-primary/40'\n      }`}\n    >\n      <span className=\"block font-medium\">{title}</span>\n      <span className=\"mt-1 block text-xs leading-5 text-muted\">{description}</span>\n    </button>\n  );\n}\n\n"""
if text.count(helper_marker) != 1:
    raise SystemExit('formatDate marker not found exactly once')
text = text.replace(helper_marker, helper + helper_marker, 1)
manager.write_text(text, encoding='utf-8')

page = Path('apps/studio/src/app/dashboard/guilds/[guildId]/team-split/page.tsx')
text = page.read_text(encoding='utf-8')
replacements = [
    (
        "import { getGuildPlugin } from '@/lib/guild-plugins';\n",
        "import { getGuildPlugin } from '@/lib/guild-plugins';\nimport { getGuildConfigurationOptions } from '@/lib/bot-guild-options';\n",
    ),
    (
        "  const plugin = await getGuildPlugin(guildId, 'team-split');\n  if (!plugin) notFound();\n",
        "  const [plugin, discordOptions] = await Promise.all([\n    getGuildPlugin(guildId, 'team-split'),\n    getGuildConfigurationOptions(guildId),\n  ]);\n  if (!plugin) notFound();\n",
    ),
    (
        "            maxTeamCount={config.maxTeamCount}\n          />",
        "            maxTeamCount={config.maxTeamCount}\n            discordOptions={discordOptions}\n          />",
    ),
]
for old, new in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'page target count must be 1, got {count}: {old[:100]!r}')
    text = text.replace(old, new, 1)
page.write_text(text, encoding='utf-8')
