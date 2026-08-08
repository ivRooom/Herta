from pathlib import Path

path = Path('apps/studio/src/components/plugin-config-studio-form.tsx')
text = path.read_text()
old = '''        <DiscordMessageTargetPicker
          guildId={guildId}
          channels={discordOptions?.channels ?? []}
          value={value}
          onChange={(next) => onChange(path, next)}
        />'''
new = '''        <DiscordMessageTargetPicker
          guildId={guildId}
          channels={discordOptions?.channels ?? []}
          value={value}
          nullable={nullable}
          onChange={(next) => onChange(path, next)}
        />'''
if old not in text:
    raise SystemExit('DiscordMessageTargetPicker target not found')
path.write_text(text.replace(old, new, 1))
