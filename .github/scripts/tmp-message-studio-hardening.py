from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    if old not in text:
        raise SystemExit(f'pattern not found in {path}: {old[:140]!r}')
    file.write_text(text.replace(old, new, 1))

replace_once(
    'plugins/daily-content/src/config.ts',
    '''  const onceAt = normalizeOnceAt(input.onceAt, recurrenceType);
  const weekdays = normalizeWeekdays(input.weekdays, recurrenceType);

  return {''',
    '''  const onceAt = normalizeOnceAt(input.onceAt, recurrenceType);
  const weekdays = normalizeWeekdays(input.weekdays, recurrenceType);
  const publishAnnouncement = input.publishAnnouncement === true;
  if (publishAnnouncement && !config.allowAnnouncementCrosspost) {
    throw new DailyContentValidationError(
      'Announcement CrosspostはPlugin設定で許可されていません',
    );
  }

  return {''',
)
replace_once(
    'plugins/daily-content/src/config.ts',
    '''    messageFormat,
    embed,
    publishAnnouncement: input.publishAnnouncement === true,
  };''',
    '''    messageFormat,
    embed,
    publishAnnouncement,
  };''',
)

# Ensure package version follows manifest version.
package_path = Path('plugins/daily-content/package.json')
package_text = package_path.read_text()
package_text = package_text.replace('"version": "1.0.0"', '"version": "2.0.0"', 1)
package_path.write_text(package_text)

print('Message Studio hardening patches applied')
