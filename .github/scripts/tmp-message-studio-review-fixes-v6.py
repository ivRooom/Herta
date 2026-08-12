from pathlib import Path


def replace(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"pattern not found in {path}: {old[:160]!r}")
    p.write_text(text.replace(old, new, 1))


# Preserve absolute ISO timestamps (GET returns these) and only interpret
# offset-less datetime-local values in the configured IANA timezone.
replace(
    'apps/studio/src/lib/message-studio-request.ts',
    """  if (typeof onceAt === 'string' && onceAt.trim()) {
    const timezone =
      typeof normalized.timezone === 'string' && normalized.timezone.trim()
        ? normalized.timezone.trim()
        : defaultTimezone;
    normalized.onceAt = parseLocalDateTime(onceAt.trim().replace('T', ' '), timezone);
  }
""",
    """  if (typeof onceAt === 'string' && onceAt.trim()) {
    const trimmed = onceAt.trim();
    const hasExplicitOffset = /(?:z|[+-]\\d{2}:?\\d{2})$/i.test(trimmed);
    if (!hasExplicitOffset) {
      const timezone =
        typeof normalized.timezone === 'string' && normalized.timezone.trim()
          ? normalized.timezone.trim()
          : defaultTimezone;
      normalized.onceAt = parseLocalDateTime(trimmed.replace('T', ' '), timezone);
    } else {
      normalized.onceAt = trimmed;
    }
  }
""",
)

# Scheduled Forum posts cannot be Announcement-crossposted. Surface the
# unsupported request through the same crosspost warning path as channel
# crosspost failures, while preserving the successfully-created Forum post.
replace(
    'apps/worker/src/daily-content.ts',
    """  if (FORUM_CHANNEL_TYPES.has(channel.type)) {
    return publishDiscordForumPost(input);
  }
""",
    """  if (FORUM_CHANNEL_TYPES.has(channel.type)) {
    const messageId = await publishDiscordForumPost(input);
    if (input.publishAnnouncement) {
      input.onCrosspostWarning?.({
        messageId,
        errorName: 'DailyContentForumCrosspostUnsupported',
      });
    }
    return messageId;
  }
""",
)

# Add Studio request-normalization regression tests.
Path('apps/studio/src/lib/message-studio-request.test.ts').write_text(r'''import { describe, expect, it } from 'vitest';
import { normalizeMessageStudioRequestBody } from './message-studio-request';

describe('normalizeMessageStudioRequestBody', () => {
  it('datetime-localは設定Timezoneの壁時計時刻としてUTCへ変換する', () => {
    const body = normalizeMessageStudioRequestBody(
      { onceAt: '2026-08-20T20:00', timezone: 'Asia/Tokyo' },
      'UTC',
    );
    expect(body.onceAt).toEqual(new Date('2026-08-20T11:00:00.000Z'));
  });

  it('GETで返るZ付きISO timestampをGET→PATCHでそのまま保持する', () => {
    const iso = '2026-08-20T11:00:00.000Z';
    const body = normalizeMessageStudioRequestBody(
      { onceAt: iso, timezone: 'Asia/Tokyo' },
      'UTC',
    );
    expect(body.onceAt).toBe(iso);
  });

  it('明示offset付きISO timestampもローカル時刻へ再解釈しない', () => {
    const iso = '2026-08-20T20:00:00+09:00';
    const body = normalizeMessageStudioRequestBody(
      { onceAt: iso, timezone: 'UTC' },
      'UTC',
    );
    expect(body.onceAt).toBe(iso);
  });
});
''')

# Strengthen the one-shot edit-race test so a real reserved delivery exists.
p = Path('plugins/daily-content/src/service.test.ts')
text = p.read_text()
old = r'''  it('配信中にone-shot日時が編集された場合は新しい予約を無効化しない', async () => {
    const originalAt = new Date('2030-01-01T00:10:00Z');
    const editedAt = new Date('2030-01-02T00:10:00Z');
    const harness = createHarness({
      onceAt: editedAt,
      lastScheduledAt: originalAt,
      nextRunAt: editedAt,
      enabled: true,
    });

    await markDeliverySent(harness.prisma, {
      deliveryId: 'delivery-1',
      scheduleId: 'schedule-1',
      guildId: 'guild-1',
      messageId: 'message-after-edit',
      completeOneShot: true,
      expectedOneShotAt: originalAt,
    }).catch(() => undefined);

    expect(harness.getSchedule().enabled).toBe(true);
    expect(harness.getSchedule().onceAt).toEqual(editedAt);
    expect(harness.getSchedule().nextRunAt).toEqual(editedAt);
  });'''
new = r'''  it('配信中にone-shot日時が編集された場合は新しい予約を無効化しない', async () => {
    const originalAt = new Date('2030-01-01T00:10:00Z');
    const editedAt = new Date('2030-01-02T00:10:00Z');
    const harness = createHarness({ onceAt: originalAt, nextRunAt: originalAt, enabled: true });

    const reserved = await reserveDueDelivery(harness.prisma, 'schedule-1', originalAt);
    expect(reserved).not.toBeNull();
    expect(harness.getSchedule().lastScheduledAt).toEqual(originalAt);

    const updated = await updateDailyContent(harness.prisma, {
      guildId: 'guild-1',
      scheduleId: 'schedule-1',
      actorId: 'user-2',
      config: normalizeDailyContentConfig({}),
      patch: { onceAt: editedAt, enabled: true },
      now: new Date('2030-01-01T00:11:00Z'),
    });
    expect(updated?.onceAt).toEqual(editedAt);
    expect(updated?.nextRunAt).toEqual(editedAt);

    await markDeliverySent(harness.prisma, {
      deliveryId: reserved!.id,
      scheduleId: 'schedule-1',
      guildId: 'guild-1',
      messageId: 'message-after-edit',
      completeOneShot: true,
      expectedOneShotAt: originalAt,
    });

    expect(harness.getDelivery()?.status).toBe('sent');
    expect(harness.getSchedule().enabled).toBe(true);
    expect(harness.getSchedule().onceAt).toEqual(editedAt);
    expect(harness.getSchedule().nextRunAt).toEqual(editedAt);
  });'''
if old not in text:
    raise SystemExit('one-shot edit-race test pattern not found')
p.write_text(text.replace(old, new, 1))
