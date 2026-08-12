from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    if old not in text:
        raise SystemExit(f'pattern not found in {path}: {old[:160]!r}')
    file.write_text(text.replace(old, new, 1))

# Studio one-shot date/time must be shown using the schedule timezone, not the browser timezone.
replace_once(
    'apps/studio/src/components/daily-content-manager.tsx',
    '    onceAt: nextLocalDateTime(),',
    '    onceAt: nextLocalDateTime(defaultTimezone),',
)
replace_once(
    'apps/studio/src/components/daily-content-manager.tsx',
    '''      onceAt: schedule.onceAt ? toDateTimeLocal(schedule.onceAt) : nextLocalDateTime(),''',
    '''      onceAt: schedule.onceAt
        ? toDateTimeLocal(schedule.onceAt, schedule.timezone)
        : nextLocalDateTime(schedule.timezone),''',
)
replace_once(
    'apps/studio/src/components/daily-content-manager.tsx',
    '''function nextLocalDateTime(): string {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  date.setSeconds(0, 0);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function toDateTimeLocal(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return nextLocalDateTime();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}''',
    '''function nextLocalDateTime(timezone: string): string {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  date.setSeconds(0, 0);
  return formatZonedDateTimeLocal(date, timezone);
}

function toDateTimeLocal(value: string, timezone: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return nextLocalDateTime(timezone);
  return formatZonedDateTimeLocal(date, timezone);
}

function formatZonedDateTimeLocal(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date);
  const values = new Map(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${values.get('year')}-${values.get('month')}-${values.get('day')}T${values.get('hour')}:${values.get('minute')}`;
}''',
)

# Slash commands: explicit Forum thread title separate from Embed title.
manifest = Path('plugins/daily-content/src/manifest.ts')
text = manifest.read_text()
needle = '''const targetOption: CommandOption = {
  name: 'channel',
  description: '投稿先。省略時は設定済みのお知らせチャンネル',
  type: 'channel',
  required: false,
};
'''
replacement = needle + '''
const forumTitleOption: CommandOption = {
  name: 'forum_title',
  description: 'Forumへ投稿する場合のスレッドタイトル',
  type: 'string',
  required: false,
};
'''
if needle not in text:
    raise SystemExit('targetOption block not found')
text = text.replace(needle, replacement, 1)
text = text.replace('''            targetOption,
            ...contentOptions,''', '''            targetOption,
            forumTitleOption,
            ...contentOptions,''')
text = text.replace('''            targetOption,
            ...contentOptions.filter''', '''            targetOption,
            forumTitleOption,
            ...contentOptions.filter''')
text = text.replace('''            { ...targetOption, required: true },
            ...contentOptions,''', '''            { ...targetOption, required: true },
            forumTitleOption,
            ...contentOptions,''')
manifest.write_text(text)

replace_once(
    'plugins/daily-content/src/plugin.ts',
    '''function readForumTitle(interaction: DailyContentCommandInteraction): string {
  return (
    (interaction.options.getString('embed_title') ?? 'お知らせ').trim().slice(0, 100) || 'お知らせ'
  );
}''',
    '''function readForumTitle(interaction: DailyContentCommandInteraction): string {
  return (
    (
      interaction.options.getString('forum_title') ??
      interaction.options.getString('embed_title') ??
      'お知らせ'
    )
      .trim()
      .slice(0, 100) || 'お知らせ'
  );
}''',
)

# Setup guide explains the expanded operational permissions.
replace_once(
    'apps/studio/src/components/plugin-setup-overview.tsx',
    '''  'daily-content': [
    '配信先・時刻・Timezoneを最初に設定すると、定期配信の事故を防ぎやすくなります。',
    'ForumやThreadを配信先にする場合は、Discord側の投稿権限も確認してください。',
  ],''',
    '''  'daily-content': [
    'Message Composerから1回・日次・週次のお知らせ、通常文、Embed、画像URL、Forum投稿を作成できます。',
    'Forum / ThreadではCreate Public Threads・Send Messages in Threads、お知らせChannelではSend Messages権限を確認してください。',
    '即時発言と返信は /announce send・/say send・/say reply から利用でき、画像ファイルは即時コマンドへ直接添付できます。',
  ],''',
)

print('Message Studio polish patches applied')
