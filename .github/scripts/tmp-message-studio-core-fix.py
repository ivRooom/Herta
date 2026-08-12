from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    if old not in text:
        raise SystemExit(f'pattern not found in {path}: {old[:120]!r}')
    file.write_text(text.replace(old, new, 1))

replace_once(
    'plugins/daily-content/src/service.ts',
    "embed: input.patch.embed !== undefined ? input.patch.embed : current.embedJson,",
    "embed:\n          input.patch.embed !== undefined\n            ? input.patch.embed\n            : (current.embedJson as DailyContentInput['embed']),",
)

worker_path = 'apps/worker/src/daily-content.ts'
replace_once(
    worker_path,
    '''  nextDailyOccurrence,
  normalizeDailyContentConfig,''',
    '''  nextContentOccurrence,
  normalizeDailyContentConfig,''',
)
replace_once(
    worker_path,
    '''    select: { id: true, guildId: true, scheduleTime: true, timezone: true },''',
    '''    select: {
      id: true,
      guildId: true,
      scheduleTime: true,
      timezone: true,
      recurrenceType: true,
      onceAt: true,
      weekdays: true,
    },''',
)
replace_once(
    worker_path,
    '''    const nextRunAt = nextDailyOccurrence({
      scheduleTime: schedule.scheduleTime,
      timezone: schedule.timezone,
      after: now,
    });
    await prisma.dailyContent.update({
      where: { id: schedule.id },
      data: { nextRunAt },
    });''',
    '''    const recurrenceType =
      schedule.recurrenceType === 'once' || schedule.recurrenceType === 'weekly'
        ? schedule.recurrenceType
        : 'daily';
    const nextRunAt = nextContentOccurrence({
      recurrenceType,
      onceAt: schedule.onceAt,
      weekdays: schedule.weekdays,
      scheduleTime: schedule.scheduleTime,
      timezone: schedule.timezone,
      after: now,
    });
    await prisma.dailyContent.update({
      where: { id: schedule.id },
      data: {
        nextRunAt,
        ...(recurrenceType === 'once' && !nextRunAt ? { enabled: false } : {}),
      },
    });''',
)

print('Message Studio core fix patches applied')
