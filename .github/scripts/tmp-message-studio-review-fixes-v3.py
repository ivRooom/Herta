from pathlib import Path

runner = Path('.tmp-message-studio-runner/.github/scripts/tmp-message-studio-review-fixes-v2.py')
exec(compile(runner.read_text(), str(runner), 'exec'), {'__name__': '__main__'})

plugin = Path('plugins/daily-content/src/plugin.ts')
text = plugin.read_text()
old = """  const messageFormat =
    requestedFormat === 'embed' || (requestedFormat === null && rawEmbed) ? 'embed' : 'text';"""
new = """  const messageFormat: 'text' | 'embed' =
    requestedFormat === 'embed' || (requestedFormat === null && rawEmbed) ? 'embed' : 'text';"""
count = text.count(old)
if count != 2:
    raise SystemExit(f'expected 2 messageFormat inference sites, found {count}')
plugin.write_text(text.replace(old, new))
