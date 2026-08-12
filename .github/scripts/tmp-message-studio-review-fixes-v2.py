from pathlib import Path

runner = Path('.tmp-message-studio-runner/.github/scripts/tmp-message-studio-review-fixes.py')
source = runner.read_text()

# The preview source contains TypeScript literal "\\n" sequences. Make only that
# old/new replacement pair raw Python strings so the matcher preserves backslashes.
marker = '# plugin.ts: actual guild verification, embed preview, format consistency, crosspost feedback.'
start = source.index(marker)
preview_start = source.index('replace(\n    path,\n    """    const heading', start)
old_open = source.index('"""', preview_start)
source = source[:old_open] + 'r' + source[old_open:]
new_search_from = old_open + 4
new_open = source.index('    """    if (schedule.messageFormat', new_search_from) + 4
source = source[:new_open] + 'r' + source[new_open:]

exec(compile(source, str(runner), 'exec'), {'__name__': '__main__'})

# A reserved one-shot intentionally has nextRunAt=null while its delivery is pending.
# Do not let the next worker scan re-initialize/disable that already-reserved schedule.
worker = Path('apps/worker/src/daily-content.ts')
text = worker.read_text()
old = """      onceAt: true,
      weekdays: true,
    },"""
new = """      onceAt: true,
      weekdays: true,
      lastScheduledAt: true,
    },"""
if old not in text:
    raise SystemExit('worker initializer select pattern not found')
text = text.replace(old, new, 1)
old = """    const recurrenceType =
      schedule.recurrenceType === 'once' || schedule.recurrenceType === 'weekly'
        ? schedule.recurrenceType
        : 'daily';"""
new = """    const recurrenceType =
      schedule.recurrenceType === 'once' || schedule.recurrenceType === 'weekly'
        ? schedule.recurrenceType
        : 'daily';
    if (recurrenceType === 'once' && schedule.lastScheduledAt) {
      // A delivery was already reserved. Keep the schedule enabled until that
      // scheduled delivery succeeds (or an operator explicitly disables it).
      continue;
    }"""
if old not in text:
    raise SystemExit('worker initializer recurrence pattern not found')
worker.write_text(text.replace(old, new, 1))
