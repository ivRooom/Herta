from pathlib import Path

path = Path('apps/studio/src/components/plugin-config-studio-form.tsx')
text = path.read_text(encoding='utf-8')
old = """  const dirty =\n    enabled !== savedEnabled || stringifyConfig(config) !== stringifyConfig(savedConfig);\n"""
new = """  const savedConfigText = stringifyConfig(savedConfig);\n  const dirty =\n    enabled !== savedEnabled ||\n    (mode === 'json' ? jsonText !== savedConfigText : stringifyConfig(config) !== savedConfigText);\n"""
if text.count(old) != 1:
    raise SystemExit(f'dirty target count must be 1, got {text.count(old)}')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
