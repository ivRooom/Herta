from pathlib import Path

bot = Path('apps/bot/src/bot.ts')
text = bot.read_text(encoding='utf-8')
replacements = [
    (
        "import type { DiscordHealthObservation } from './health/types.js';\n",
        "import type { DiscordHealthObservation } from './health/types.js';\nimport {\n  searchGuildMemberOptions,\n  type GuildMemberOption,\n} from './health/guild-members.js';\n",
    ),
    (
        "  async getGuildConfigurationOptions(guildId: string): Promise<GuildConfigurationOptions | null> {\n    return loadGuildConfigurationOptions(this.client, guildId);\n  }\n\n",
        "  async getGuildConfigurationOptions(guildId: string): Promise<GuildConfigurationOptions | null> {\n    return loadGuildConfigurationOptions(this.client, guildId);\n  }\n\n  async searchGuildMembers(\n    guildId: string,\n    query: string,\n    limit: number,\n  ): Promise<GuildMemberOption[] | null> {\n    return searchGuildMemberOptions(this.client, guildId, query, limit);\n  }\n\n",
    ),
]
for old, new in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'bot target count must be 1, got {count}: {old[:100]!r}')
    text = text.replace(old, new, 1)
bot.write_text(text, encoding='utf-8')

main = Path('apps/bot/src/main.ts')
text = main.read_text(encoding='utf-8')
old = "      getGuildOptions: (guildId) => bot.getGuildConfigurationOptions(guildId),\n"
new = "      getGuildOptions: (guildId) => bot.getGuildConfigurationOptions(guildId),\n      searchGuildMembers: (guildId, query, limit) => bot.searchGuildMembers(guildId, query, limit),\n"
if text.count(old) != 1:
    raise SystemExit(f'main target count must be 1, got {text.count(old)}')
main.write_text(text.replace(old, new, 1), encoding='utf-8')

server = Path('apps/bot/src/health/server.ts')
text = server.read_text(encoding='utf-8')
replacements = [
    (
        "import type { GuildConfigurationOptions } from './guild-options.js';\n",
        "import type { GuildConfigurationOptions } from './guild-options.js';\nimport type { GuildMemberOption } from './guild-members.js';\n",
    ),
    (
        "  getGuildOptions?: (guildId: string) => Promise<GuildConfigurationOptions | null>;\n",
        "  getGuildOptions?: (guildId: string) => Promise<GuildConfigurationOptions | null>;\n  searchGuildMembers?: (\n    guildId: string,\n    query: string,\n    limit: number,\n  ) => Promise<GuildMemberOption[] | null>;\n",
    ),
    (
        "    const pathname = new URL(url, 'http://localhost').pathname;\n    const guildOptionsMatch = /^\\/internal\\/guilds\\/(\\d+)\\/options$/u.exec(pathname);\n",
        "    const requestUrl = new URL(url, 'http://localhost');\n    const pathname = requestUrl.pathname;\n    const guildMemberSearchMatch = /^\\/internal\\/guilds\\/(\\d+)\\/members$/u.exec(pathname);\n    if (guildMemberSearchMatch) {\n      if (method !== 'GET') {\n        response.setHeader('Allow', 'GET');\n        this.sendJson(response, 405, { status: 'method_not_allowed' });\n        return;\n      }\n      if (!this.options.searchGuildMembers) {\n        this.sendJson(response, 404, { status: 'not_found' });\n        return;\n      }\n\n      const query = requestUrl.searchParams.get('query')?.trim() ?? '';\n      if (!/^\\d{17,20}$/u.test(query) && query.length < 2) {\n        this.sendJson(response, 400, { status: 'query_too_short' });\n        return;\n      }\n      const requestedLimit = Number.parseInt(requestUrl.searchParams.get('limit') ?? '20', 10);\n      const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(20, requestedLimit)) : 20;\n      try {\n        const members = await withTimeout(\n          this.options.searchGuildMembers(guildMemberSearchMatch[1]!, query, limit),\n          this.options.config.checkTimeoutMs + 2_000,\n        );\n        if (!members) {\n          this.sendJson(response, 404, { status: 'guild_not_found' });\n          return;\n        }\n        this.sendJson(response, 200, { members });\n      } catch {\n        this.sendJson(response, 503, { status: 'unavailable' });\n      }\n      return;\n    }\n\n    const guildOptionsMatch = /^\\/internal\\/guilds\\/(\\d+)\\/options$/u.exec(pathname);\n",
    ),
]
for old, new in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'server target count must be 1, got {count}: {old[:100]!r}')
    text = text.replace(old, new, 1)
server.write_text(text, encoding='utf-8')
