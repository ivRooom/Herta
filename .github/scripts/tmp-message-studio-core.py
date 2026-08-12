from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    if old not in text:
        raise SystemExit(f'pattern not found in {path}: {old[:100]!r}')
    file.write_text(text.replace(old, new, 1))

# Prisma schema
schema_path = 'packages/db/prisma/schema.prisma'
schema = Path(schema_path).read_text()
old_model = '''model DailyContent {
  id              String    @id @default(uuid())
  guildId         String    @map("guild_id")
  channelId       String    @map("channel_id")
  title           String    @default("")
  content         String
  scheduleTime    String    @map("schedule_time")
  timezone        String    @default("Asia/Tokyo")
  enabled         Boolean   @default(true)
  nextRunAt       DateTime? @map("next_run_at") @db.Timestamptz(3)
  lastScheduledAt DateTime? @map("last_scheduled_at") @db.Timestamptz(3)
  lastSentAt      DateTime? @map("last_sent_at") @db.Timestamptz(3)
  deletedAt       DateTime? @map("deleted_at") @db.Timestamptz(3)
  createdBy       String?   @map("created_by")
  updatedBy       String?   @map("updated_by")
  createdAt       DateTime  @default(now()) @map("created_at")
  updatedAt       DateTime  @updatedAt @map("updated_at")

  deliveries DailyContentDelivery[]

  @@index([guildId, enabled])
  @@index([enabled, nextRunAt])
  @@map("daily_contents")
}'''
new_model = '''model DailyContent {
  id                  String    @id @default(uuid())
  guildId             String    @map("guild_id")
  channelId           String    @map("channel_id")
  title               String    @default("")
  content             String
  scheduleTime        String    @map("schedule_time")
  timezone            String    @default("Asia/Tokyo")
  enabled             Boolean   @default(true)
  recurrenceType      String    @default("daily") @map("recurrence_type") @db.VarChar(16)
  onceAt              DateTime? @map("once_at") @db.Timestamptz(3)
  weekdays            Int[]     @default([])
  messageFormat       String    @default("text") @map("message_format") @db.VarChar(16)
  embedJson           Json?     @map("embed_json")
  publishAnnouncement Boolean   @default(false) @map("publish_announcement")
  nextRunAt           DateTime? @map("next_run_at") @db.Timestamptz(3)
  lastScheduledAt     DateTime? @map("last_scheduled_at") @db.Timestamptz(3)
  lastSentAt          DateTime? @map("last_sent_at") @db.Timestamptz(3)
  deletedAt           DateTime? @map("deleted_at") @db.Timestamptz(3)
  createdBy           String?   @map("created_by")
  updatedBy           String?   @map("updated_by")
  createdAt           DateTime  @default(now()) @map("created_at")
  updatedAt           DateTime  @updatedAt @map("updated_at")

  deliveries DailyContentDelivery[]

  @@index([guildId, enabled])
  @@index([enabled, nextRunAt])
  @@index([guildId, recurrenceType, nextRunAt])
  @@map("daily_contents")
}'''
if old_model not in schema:
    raise SystemExit('DailyContent model not found')
Path(schema_path).write_text(schema.replace(old_model, new_model, 1))

# schedule local datetime parser
replace_once(
    'plugins/daily-content/src/schedule.ts',
    "export function dailyContentIdempotencyKey(scheduleId: string, scheduledFor: Date): string {",
    '''export function parseLocalDateTime(value: string, timezone: string): Date {
  const match = /^(\\d{4})[-/](\\d{2})[-/](\\d{2})[ T](\\d{2}):(\\d{2})$/.exec(value.trim());
  if (!match) {
    throw new DailyContentValidationError('日時はYYYY-MM-DD HH:mm形式で指定してください');
  }
  if (!isValidIanaTimezone(timezone)) {
    throw new DailyContentValidationError('timezoneに有効なIANA timezoneを指定してください');
  }
  const target: ZonedDateParts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
  };
  const normalizedDate = new Date(Date.UTC(target.year, target.month - 1, target.day));
  if (
    normalizedDate.getUTCFullYear() !== target.year ||
    normalizedDate.getUTCMonth() + 1 !== target.month ||
    normalizedDate.getUTCDate() !== target.day ||
    target.hour < 0 || target.hour > 23 || target.minute < 0 || target.minute > 59
  ) {
    throw new DailyContentValidationError('日時が不正です');
  }
  const candidates = resolveLocalDateTimeCandidates(target, timezone);
  if (candidates.length === 0) {
    throw new DailyContentValidationError('指定した現地時刻はtimezone上で存在しません');
  }
  return candidates[0]!;
}

export function dailyContentIdempotencyKey(scheduleId: string, scheduledFor: Date): string {''',
)

# service extensions
service_path = 'plugins/daily-content/src/service.ts'
replace_once(
    service_path,
    "import { dailyContentIdempotencyKey, nextDailyOccurrence } from './schedule.js';",
    "import { dailyContentIdempotencyKey, nextContentOccurrence } from './schedule.js';",
)
replace_once(
    service_path,
    '''  enabled: boolean;
  nextRunAt: Date | null;''',
    '''  enabled: boolean;
  recurrenceType: 'once' | 'daily' | 'weekly';
  onceAt: Date | null;
  weekdays: number[];
  messageFormat: 'text' | 'embed';
  embedJson: unknown | null;
  publishAnnouncement: boolean;
  nextRunAt: Date | null;''',
)
replace_once(
    service_path,
    '''  const nextRunAt = normalized.enabled
    ? nextDailyOccurrence({
        scheduleTime: normalized.scheduleTime,
        timezone: normalized.timezone,
        after: now,
      })
    : null;''',
    '''  const nextRunAt = normalized.enabled
    ? nextContentOccurrence({
        recurrenceType: normalized.recurrenceType,
        onceAt: normalized.onceAt,
        weekdays: normalized.weekdays,
        scheduleTime: normalized.scheduleTime,
        timezone: normalized.timezone,
        after: now,
      })
    : null;''',
)
replace_once(
    service_path,
    '''    const created = await tx.dailyContent.create({
      data: {
        guildId: input.guildId,
        ...normalized,
        nextRunAt,
        createdBy: input.actorId,
        updatedBy: input.actorId,
      },
    });''',
    '''    const { embed, ...stored } = normalized;
    const created = await tx.dailyContent.create({
      data: {
        guildId: input.guildId,
        ...stored,
        embedJson: embed,
        nextRunAt,
        createdBy: input.actorId,
        updatedBy: input.actorId,
      },
    });''',
)
replace_once(
    service_path,
    '''        timezone: input.patch.timezone ?? current.timezone,
        enabled: input.patch.enabled ?? current.enabled,
      },''',
    '''        timezone: input.patch.timezone ?? current.timezone,
        enabled: input.patch.enabled ?? current.enabled,
        recurrenceType: input.patch.recurrenceType ?? current.recurrenceType,
        onceAt: input.patch.onceAt !== undefined ? input.patch.onceAt : current.onceAt,
        weekdays: input.patch.weekdays !== undefined ? input.patch.weekdays : current.weekdays,
        messageFormat: input.patch.messageFormat ?? current.messageFormat,
        embed: input.patch.embed !== undefined ? input.patch.embed : current.embedJson,
        publishAnnouncement:
          input.patch.publishAnnouncement ?? current.publishAnnouncement,
      },''',
)
replace_once(
    service_path,
    '''    const scheduleChanged =
      normalized.scheduleTime !== current.scheduleTime ||
      normalized.timezone !== current.timezone ||
      normalized.enabled !== current.enabled;
    const nextRunAt = !normalized.enabled
      ? null
      : scheduleChanged || !current.nextRunAt
        ? nextDailyOccurrence({
            scheduleTime: normalized.scheduleTime,
            timezone: normalized.timezone,
            after: now,
          })
        : current.nextRunAt;''',
    '''    const scheduleChanged =
      normalized.scheduleTime !== current.scheduleTime ||
      normalized.timezone !== current.timezone ||
      normalized.enabled !== current.enabled ||
      normalized.recurrenceType !== current.recurrenceType ||
      normalized.onceAt?.getTime() !== current.onceAt?.getTime() ||
      normalized.weekdays.join(',') !== current.weekdays.join(',');
    const nextRunAt = !normalized.enabled
      ? null
      : scheduleChanged || !current.nextRunAt
        ? nextContentOccurrence({
            recurrenceType: normalized.recurrenceType,
            onceAt: normalized.onceAt,
            weekdays: normalized.weekdays,
            scheduleTime: normalized.scheduleTime,
            timezone: normalized.timezone,
            after: now,
          })
        : current.nextRunAt;''',
)
replace_once(
    service_path,
    '''    const updated = await tx.dailyContent.update({
      where: { id: current.id },
      data: {
        ...normalized,
        nextRunAt,
        updatedBy: input.actorId,
      },
    });''',
    '''    const { embed, ...stored } = normalized;
    const updated = await tx.dailyContent.update({
      where: { id: current.id },
      data: {
        ...stored,
        embedJson: embed,
        nextRunAt,
        updatedBy: input.actorId,
      },
    });''',
)
replace_once(
    service_path,
    '''    const nextRunAt = nextDailyOccurrence({
      scheduleTime: schedule.scheduleTime,
      timezone: schedule.timezone,
      after: scheduledFor,
    });
    await tx.dailyContent.update({
      where: { id: schedule.id },
      data: { nextRunAt, lastScheduledAt: scheduledFor },
    });''',
    '''    const nextRunAt = nextContentOccurrence({
      recurrenceType: schedule.recurrenceType,
      onceAt: schedule.onceAt,
      weekdays: schedule.weekdays,
      scheduleTime: schedule.scheduleTime,
      timezone: schedule.timezone,
      after: scheduledFor,
    });
    await tx.dailyContent.update({
      where: { id: schedule.id },
      data: {
        nextRunAt,
        lastScheduledAt: scheduledFor,
        ...(schedule.recurrenceType === 'once' ? { enabled: false } : {}),
      },
    });''',
)

# export message helpers
replace_once(
    'plugins/daily-content/src/index.ts',
    "export * from './schedule.js';\n",
    "export * from './schedule.js';\nexport * from './message.js';\n",
)

# worker imports and payload
worker_path = 'apps/worker/src/daily-content.ts'
replace_once(
    worker_path,
    '''  nextDailyOccurrence,
  normalizeDailyContentConfig,''',
    '''  nextDailyOccurrence,
  normalizeDailyContentConfig,
  safeEmbedFromJson,
  toDiscordApiEmbed,''',
)
replace_once(
    worker_path,
    '''      content: delivery.dailyContent.content,
      scheduledFor: delivery.scheduledFor,
      timezone: delivery.dailyContent.timezone,
      allowUserMentions: config.allowUserMentions,
      nonce: createDeliveryNonce(delivery.idempotencyKey),''',
    '''      content: delivery.dailyContent.content,
      embed: safeEmbedFromJson(delivery.dailyContent.embedJson),
      scheduledFor: delivery.scheduledFor,
      timezone: delivery.dailyContent.timezone,
      allowUserMentions: config.allowUserMentions,
      publishAnnouncement:
        delivery.dailyContent.publishAnnouncement && config.allowAnnouncementCrosspost,
      nonce: createDeliveryNonce(delivery.idempotencyKey),''',
)
replace_once(
    worker_path,
    '''  content: string;
  scheduledFor: Date;
  timezone: string;
  allowUserMentions: boolean;
  nonce: string;''',
    '''  content: string;
  embed: ReturnType<typeof safeEmbedFromJson>;
  scheduledFor: Date;
  timezone: string;
  allowUserMentions: boolean;
  publishAnnouncement: boolean;
  nonce: string;''',
)
replace_once(
    worker_path,
    '''  content: string;
  allowUserMentions: boolean;
  nonce: string;
}): Promise<string> {
  const response = await fetch(`${DISCORD_API_BASE_URL}/channels/${input.channelId}/messages`, {''',
    '''  content: string;
  embed: ReturnType<typeof safeEmbedFromJson>;
  allowUserMentions: boolean;
  publishAnnouncement: boolean;
  nonce: string;
}): Promise<string> {
  const embed = toDiscordApiEmbed(input.embed);
  const response = await fetch(`${DISCORD_API_BASE_URL}/channels/${input.channelId}/messages`, {''',
)
replace_once(
    worker_path,
    '''      content: input.content,
      nonce: input.nonce,
      enforce_nonce: true,
      allowed_mentions: { parse: input.allowUserMentions ? ['users'] : [] },''',
    '''      content: input.content || undefined,
      embeds: embed ? [embed] : undefined,
      nonce: input.nonce,
      enforce_nonce: true,
      allowed_mentions: { parse: input.allowUserMentions ? ['users'] : [] },''',
)
replace_once(
    worker_path,
    '''  if (typeof message.id !== 'string' || !message.id) {
    throw new DailyContentPublishError('DailyContentDiscordResponseInvalid', response.status);
  }
  return message.id;''',
    '''  if (typeof message.id !== 'string' || !message.id) {
    throw new DailyContentPublishError('DailyContentDiscordResponseInvalid', response.status);
  }
  if (input.publishAnnouncement) {
    try {
      await fetch(
        `${DISCORD_API_BASE_URL}/channels/${input.channelId}/messages/${message.id}/crosspost`,
        {
          method: 'POST',
          headers: { Authorization: `Bot ${input.token}` },
          signal: AbortSignal.timeout(10_000),
        },
      );
    } catch {
      // Base message is already sent. Do not retry and duplicate it only because crosspost failed.
    }
  }
  return message.id;''',
)
# Forum input signature occurs once after channel function; make sure embed is included.
replace_once(
    worker_path,
    '''  content: string;
  scheduledFor: Date;
  timezone: string;
  allowUserMentions: boolean;
  nonce: string;
}): Promise<string> {
  let response: Response;''',
    '''  content: string;
  embed: ReturnType<typeof safeEmbedFromJson>;
  scheduledFor: Date;
  timezone: string;
  allowUserMentions: boolean;
  publishAnnouncement: boolean;
  nonce: string;
}): Promise<string> {
  const embed = toDiscordApiEmbed(input.embed);
  let response: Response;''',
)
replace_once(
    worker_path,
    '''        message: {
          content: input.content,
          allowed_mentions: { parse: input.allowUserMentions ? ['users'] : [] },
        },''',
    '''        message: {
          content: input.content || undefined,
          embeds: embed ? [embed] : undefined,
          allowed_mentions: { parse: input.allowUserMentions ? ['users'] : [] },
        },''',
)

# remove initialize next run assumption of daily: inspect and patch its occurrence later by replacing nextDailyOccurrence calls
worker = Path(worker_path).read_text()
worker = worker.replace(
    '''nextDailyOccurrence({
          scheduleTime: schedule.scheduleTime,
          timezone: schedule.timezone,
          after: now,
        })''',
    '''schedule.recurrenceType === 'once'
        ? schedule.onceAt && schedule.onceAt > now
          ? schedule.onceAt
          : null
        : nextDailyOccurrence({
            scheduleTime: schedule.scheduleTime,
            timezone: schedule.timezone,
            after: now,
          })'''
)
Path(worker_path).write_text(worker)

print('Message Studio core patches applied')
