from pathlib import Path

path = Path('apps/bot/src/health/server.ts')
text = path.read_text()
old = """        const profile = await withTimeout(
          this.options.updateGuildBotProfile(guildId, input),
          this.options.config.checkTimeoutMs + 5_000,
        );
"""
new = """        const profile = await this.options.updateGuildBotProfile(guildId, input);
"""
if old not in text:
    raise SystemExit('target profile mutation timeout block was not found')
path.write_text(text.replace(old, new, 1))
