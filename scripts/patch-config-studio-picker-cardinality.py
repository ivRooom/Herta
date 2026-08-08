from pathlib import Path

path = Path('apps/studio/src/components/plugin-config-studio-form.tsx')
text = path.read_text(encoding='utf-8')
old = """  const ui = schema['x-herta-ui'];
  const discordMultiple = type === 'array' || ui?.multiple === true;

  if (ui?.widget === 'discord-channel' && (type === 'string' || type === 'array')) {
"""
new = """  const ui = schema['x-herta-ui'];
  const discordMultiple = type === 'array';
  const supportsDiscordPicker =
    type === 'string' ||
    (type === 'array' && schemaPrimaryType(schema.items ?? {}) === 'string');

  if (ui?.widget === 'discord-channel' && supportsDiscordPicker) {
"""
if text.count(old) != 1:
    raise SystemExit(f'first target count must be 1, got {text.count(old)}')
text = text.replace(old, new, 1)
old2 = """  if (ui?.widget === 'discord-role' && (type === 'string' || type === 'array')) {
"""
new2 = """  if (ui?.widget === 'discord-role' && supportsDiscordPicker) {
"""
if text.count(old2) != 1:
    raise SystemExit(f'second target count must be 1, got {text.count(old2)}')
text = text.replace(old2, new2, 1)
path.write_text(text, encoding='utf-8')
