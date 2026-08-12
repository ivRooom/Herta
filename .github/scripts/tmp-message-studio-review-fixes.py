from pathlib import Path


def replace(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"pattern not found in {path}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1))


# config.ts: deterministic future guard + strict recurrence type.
path = "plugins/daily-content/src/config.ts"
replace(
    path,
    """export function normalizeDailyContentInput(
  input: DailyContentInput,
  config: DailyContentConfig,
): NormalizedDailyContentInput {""",
    """export function normalizeDailyContentInput(
  input: DailyContentInput,
  config: DailyContentConfig,
  now = new Date(),
): NormalizedDailyContentInput {""",
)
replace(
    path,
    """  const onceAt = normalizeOnceAt(input.onceAt, recurrenceType);
  const weekdays = normalizeWeekdays(input.weekdays, recurrenceType);""",
    """  const enabled = input.enabled ?? true;
  const onceAt = normalizeOnceAt(input.onceAt, recurrenceType, enabled, now);
  const weekdays = normalizeWeekdays(input.weekdays, recurrenceType);""",
)
replace(path, "    enabled: input.enabled ?? true,", "    enabled,")
replace(
    path,
    """function normalizeRecurrenceType(value: unknown): MessageStudioRecurrence {
  return value === 'once' || value === 'weekly' || value === 'daily' ? value : 'daily';
}""",
    """function normalizeRecurrenceType(value: unknown): MessageStudioRecurrence {
  if (value === undefined || value === null) return 'daily';
  if (value === 'once' || value === 'weekly' || value === 'daily') return value;
  throw new DailyContentValidationError(
    'recurrenceTypeはonce/daily/weeklyのいずれかを指定してください',
  );
}""",
)
replace(
    path,
    """function normalizeOnceAt(
  value: Date | string | null | undefined,
  recurrence: MessageStudioRecurrence,
) {
  if (recurrence !== 'once') return null;
  const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    throw new DailyContentValidationError('1回予約ではonceAtに有効な日時を指定してください');
  }
  return date;
}""",
    """function normalizeOnceAt(
  value: Date | string | null | undefined,
  recurrence: MessageStudioRecurrence,
  enabled: boolean,
  now: Date,
) {
  if (recurrence !== 'once') return null;
  const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    throw new DailyContentValidationError('1回予約ではonceAtに有効な日時を指定してください');
  }
  if (enabled && date.getTime() < now.getTime() + 60_000) {
    throw new DailyContentValidationError('1回予約の日時は現在時刻より1分以上先を指定してください');
  }
  return date;
}""",
)

# service.ts: pass deterministic now, keep one-shot enabled until a scheduled delivery succeeds.
path = "plugins/daily-content/src/service.ts"
replace(
    path,
    "  const normalized = normalizeDailyContentInput(input.schedule, input.config);",
    "  const normalized = normalizeDailyContentInput(input.schedule, input.config, now);",
)
replace(path, """      input.config,
    );""", """      input.config,
      now,
    );""")
replace(
    path,
    """        nextRunAt,
        lastScheduledAt: scheduledFor,
        ...(schedule.recurrenceType === 'once' ? { enabled: false } : {}),""",
    """        nextRunAt,
        lastScheduledAt: scheduledFor,""",
)
replace(
    path,
    "  input: { deliveryId: string; scheduleId: string; messageId: string; sentAt?: Date },",
    """  input: {
    deliveryId: string;
    scheduleId: string;
    messageId: string;
    sentAt?: Date;
    completeOneShot?: boolean;
  },""",
)
replace(
    path,
    """    await tx.dailyContent.update({
      where: { id: input.scheduleId },
      data: { lastSentAt: sentAt },
    });""",
    """    await tx.dailyContent.update({
      where: { id: input.scheduleId },
      data: {
        lastSentAt: sentAt,
        ...(input.completeOneShot ? { enabled: false, nextRunAt: null } : {}),
      },
    });""",
)

# message.ts: Canary/PTB URLs + formatter-compatible separators.
path = "plugins/daily-content/src/message.ts"
replace(
    path,
    r"  /^https?:\/\/(?:www\.)?(?:discord\.com|discordapp\.com)\/channels\/(\d{17,20})\/(\d{17,20})\/(\d{17,20})(?:\?.*)?$/i;",
    r"  /^https?:\/\/(?:(?:www|canary|ptb)\.)?(?:discord\.com|discordapp\.com)\/channels\/(\d{17,20})\/(\d{17,20})\/(\d{17,20})(?:\?.*)?$/i;",
)
replace(path, r"    .split(/[\s,、/]+/)", r"    .split(/[\s,、，・/]+/)")

# plugin.ts: actual guild verification, embed preview, format consistency, crosspost feedback.
path = "plugins/daily-content/src/plugin.ts"
replace(
    path,
    """  parseMessageStudioWeekdays,
  toDiscordApiEmbed,""",
    """  parseMessageStudioWeekdays,
  safeEmbedFromJson,
  toDiscordApiEmbed,""",
)
replace(
    path,
    """interface DailyContentReplyOptions {
  content: string;
  flags?: number;""",
    """interface DailyContentReplyOptions {
  content: string;
  embeds?: unknown[];
  flags?: number;""",
)
replace(
    path,
    """interface MessageTargetChannel {
  id: string;""",
    """interface MessageTargetChannel {
  id: string;
  guildId?: string | null;""",
)
replace(
    path,
    """    const heading = schedule.title ? `**${escapeMarkdown(schedule.title)}**\n` : '';
    const body = `${heading}${schedule.content}`;
    const truncated =
      body.length > MAX_PREVIEW_LENGTH
        ? `${body.slice(0, MAX_PREVIEW_LENGTH - 20)}\n…（省略）`
        : body;
    await respond(
      interaction,
      `プレビュー（<#${schedule.channelId}> / ${schedule.scheduleTime} ${schedule.timezone}）\n\n${truncated}`,
    );
    return;""",
    """    if (schedule.messageFormat === 'embed') {
      const apiEmbed = toDiscordApiEmbed(safeEmbedFromJson(schedule.embedJson));
      const title = schedule.title ? `\n管理タイトル: ${escapeMarkdown(schedule.title)}` : '';
      await respond(
        interaction,
        `プレビュー（<#${schedule.channelId}> / ${schedule.scheduleTime} ${schedule.timezone}）${title}`,
        apiEmbed ? [apiEmbed] : undefined,
      );
      return;
    }
    const heading = schedule.title ? `**${escapeMarkdown(schedule.title)}**\n` : '';
    const body = `${heading}${schedule.content}`;
    const truncated =
      body.length > MAX_PREVIEW_LENGTH
        ? `${body.slice(0, MAX_PREVIEW_LENGTH - 20)}\n…（省略）`
        : body;
    await respond(
      interaction,
      `プレビュー（<#${schedule.channelId}> / ${schedule.scheduleTime} ${schedule.timezone}）\n\n${truncated}`,
    );
    return;""",
)
for _ in range(2):
    replace(
        path,
        """      context.client,
      channelId,
      payload,""",
        """      context.client,
      context.guildId,
      channelId,
      payload,""",
    )
replace(
    path,
    """    if (crosspost && sent.crosspost) {
      try {""",
    """    if (crosspost && !sent.crosspost) {
      crosspostWarning =
        ' / このチャンネルはAnnouncement ChannelではないためCrosspostしませんでした';
    } else if (crosspost && sent.crosspost) {
      try {""",
)
replace(
    path,
    """    const channel = await context.client.channels.fetch(reference.channelId);
    if (!channel?.messages)
      throw new DailyContentValidationError('返信先チャンネルを取得できません');""",
    """    const channel = await context.client.channels.fetch(reference.channelId);
    if (!channel?.messages)
      throw new DailyContentValidationError('返信先チャンネルを取得できません');
    if (channel.guildId !== context.guildId) {
      throw new DailyContentValidationError('別サーバーのメッセージには返信できません');
    }""",
)
replace(
    path,
    """  const embed = readEmbed(interaction, config);
  if (!content.trim() && !embed)
    throw new DailyContentValidationError('本文またはEmbedを入力してください');
  return {
    content,
    messageFormat:
      interaction.options.getString('format') === 'embed' ? ('embed' as const) : ('text' as const),
    embed,
  };""",
    """  const rawEmbed = readEmbed(interaction, config);
  const requestedFormat = interaction.options.getString('format');
  const messageFormat =
    requestedFormat === 'embed' || (requestedFormat === null && rawEmbed) ? 'embed' : 'text';
  const embed = messageFormat === 'embed' ? rawEmbed : null;
  if (!content.trim() && !embed)
    throw new DailyContentValidationError('本文またはEmbedを入力してください');
  return { content, messageFormat, embed };""",
)
replace(
    path,
    """  const embed = readEmbed(interaction, config);
  const attachment = interaction.options.getAttachment('image');
  if (!content && !embed && !attachment) {
    throw new DailyContentValidationError('本文・Embed・画像のいずれかを入力してください');
  }
  const apiEmbed = toDiscordApiEmbed(embed);""",
    """  const rawEmbed = readEmbed(interaction, config);
  const requestedFormat = interaction.options.getString('format');
  const messageFormat =
    requestedFormat === 'embed' || (requestedFormat === null && rawEmbed) ? 'embed' : 'text';
  const embed = messageFormat === 'embed' ? rawEmbed : null;
  const attachment = interaction.options.getAttachment('image');
  if (!content && !embed && !attachment) {
    throw new DailyContentValidationError('本文・Embed・画像のいずれかを入力してください');
  }
  const apiEmbed = toDiscordApiEmbed(embed);""",
)
replace(
    path,
    """async function sendToTarget(
  client: MessageStudioClient,
  channelId: string,""",
    """async function sendToTarget(
  client: MessageStudioClient,
  guildId: string,
  channelId: string,""",
)
replace(
    path,
    """  const channel = await client.channels.fetch(channelId);
  if (!channel) throw new DailyContentValidationError('投稿先チャンネルを取得できません');""",
    """  const channel = await client.channels.fetch(channelId);
  if (!channel) throw new DailyContentValidationError('投稿先チャンネルを取得できません');
  if (channel.guildId !== guildId) {
    throw new DailyContentValidationError('別サーバーのチャンネルには投稿できません');
  }""",
)
replace(
    path,
    """async function respond(
  interaction: DailyContentCommandInteraction,
  content: string,
): Promise<void> {
  const options: DailyContentReplyOptions = {
    content,""",
    """async function respond(
  interaction: DailyContentCommandInteraction,
  content: string,
  embeds?: unknown[],
): Promise<void> {
  const options: DailyContentReplyOptions = {
    content,
    ...(embeds?.length ? { embeds } : {}),""",
)

# worker: honor stored format, finish one-shot after success, inspect crosspost status.
path = "apps/worker/src/daily-content.ts"
replace(
    path,
    "      embed: safeEmbedFromJson(delivery.dailyContent.embedJson),",
    """      embed:
        delivery.dailyContent.messageFormat === 'embed'
          ? safeEmbedFromJson(delivery.dailyContent.embedJson)
          : null,""",
)
replace(
    path,
    """      nonce: createDeliveryNonce(delivery.idempotencyKey),
    });""",
    """      nonce: createDeliveryNonce(delivery.idempotencyKey),
      onCrosspostWarning: ({ messageId, status, errorName }) =>
        options.logger.warn(
          {
            guildId: delivery.guildId,
            scheduleId: delivery.dailyContent.id,
            deliveryId: delivery.id,
            channelId: delivery.dailyContent.channelId,
            messageId,
            status,
            errorName,
          },
          'AnnouncementのCrosspostに失敗しました。元メッセージは配信済みです',
        ),
    });""",
)
replace(
    path,
    """      messageId,
    });""",
    """      messageId,
      completeOneShot:
        delivery.origin === 'scheduled' && delivery.dailyContent.recurrenceType === 'once',
    });""",
)
replace(
    path,
    """  nonce: string;
}): Promise<string> {""",
    """  nonce: string;
  onCrosspostWarning?: (details: {
    messageId: string;
    status?: number;
    errorName: string;
  }) => void;
}): Promise<string> {""",
)
replace(
    path,
    """  publishAnnouncement: boolean;
  nonce: string;
}): Promise<string> {
  const embed = toDiscordApiEmbed(input.embed);""",
    """  publishAnnouncement: boolean;
  nonce: string;
  onCrosspostWarning?: (details: {
    messageId: string;
    status?: number;
    errorName: string;
  }) => void;
}): Promise<string> {
  const embed = toDiscordApiEmbed(input.embed);""",
)
replace(
    path,
    """  if (input.publishAnnouncement) {
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
  }""",
    """  if (input.publishAnnouncement) {
    try {
      const crosspostResponse = await fetch(
        `${DISCORD_API_BASE_URL}/channels/${input.channelId}/messages/${message.id}/crosspost`,
        {
          method: 'POST',
          headers: { Authorization: `Bot ${input.token}` },
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!crosspostResponse.ok) {
        input.onCrosspostWarning?.({
          messageId: message.id,
          status: crosspostResponse.status,
          errorName: 'DailyContentCrosspostFailed',
        });
      }
    } catch (error) {
      input.onCrosspostWarning?.({
        messageId: message.id,
        errorName: resolveErrorName(error),
      });
      // Base message is already sent. Do not retry and duplicate it only because crosspost failed.
    }
  }""",
)

# Studio: SSR-safe date default, weekly guard, accessible editor, valid embed fields.
path = "apps/studio/src/components/daily-content-manager.tsx"
replace(path, "    onceAt: nextLocalDateTime(defaultTimezone),", "    onceAt: '',")
replace(
    path,
    """  useEffect(() => setSchedules(initialSchedules), [initialSchedules]);
  useEffect(() => setDeliveries(initialDeliveries), [initialDeliveries]);""",
    """  useEffect(() => setSchedules(initialSchedules), [initialSchedules]);
  useEffect(() => setDeliveries(initialDeliveries), [initialDeliveries]);
  useEffect(() => {
    setForm((current) =>
      current.onceAt ? current : { ...current, onceAt: nextLocalDateTime(current.timezone) },
    );
  }, []);""",
)
replace(
    path,
    """  function resetForm() {
    setEditingId(null);
    setForm(createEmptyForm(defaultTimezone, defaultChannelId));
  }""",
    """  function resetForm() {
    setEditingId(null);
    setForm({
      ...createEmptyForm(defaultTimezone, defaultChannelId),
      onceAt: nextLocalDateTime(defaultTimezone),
    });
  }""",
)
replace(
    path,
    """              <label className="mt-3 block">
                <span className="text-xs font-medium text-muted">通常本文</span>""",
    """              <div className="mt-3 block">
                <label htmlFor="message-studio-content" className="text-xs font-medium text-muted">
                  通常本文
                </label>""",
)
replace(
    path,
    """                  <textarea
                    ref={textareaRef}""",
    """                  <textarea
                    id="message-studio-content"
                    ref={textareaRef}""",
)
replace(
    path,
    """              </label>
            </section>

            {form.messageFormat === 'embed' ? (""",
    """              </div>
            </section>

            {form.messageFormat === 'embed' ? (""",
)
replace(
    path,
    "                disabled={busyKey === 'save' || !form.channelId}",
    """                disabled={
                  busyKey === 'save' ||
                  !form.channelId ||
                  (form.recurrenceType === 'weekly' && form.weekdays.length === 0)
                }""",
)
replace(
    path,
    """          ...(form.fields.some((field) => field.name.trim() || field.value.trim())
            ? {
                fields: form.fields
                  .filter((field) => field.name.trim() || field.value.trim())""",
    """          ...(form.fields.some((field) => field.name.trim() && field.value.trim())
            ? {
                fields: form.fields
                  .filter((field) => field.name.trim() && field.value.trim())""",
)

# Config tests.
p = Path("plugins/daily-content/src/config.test.ts")
text = p.read_text().replace(
    "const onceAt = new Date('2026-08-20T11:00:00Z');",
    "const onceAt = new Date('2099-08-20T11:00:00Z');",
)
insert = r'''

  it('未知のrecurrenceTypeをdailyへ黙って変換せず拒否する', () => {
    expect(() =>
      normalizeDailyContentInput(
        {
          channelId: '123456789012345678',
          content: 'content',
          scheduleTime: '09:00',
          recurrenceType: 'monthly' as never,
        },
        normalizeDailyContentConfig({}),
      ),
    ).toThrow('recurrenceTypeはonce/daily/weeklyのいずれかを指定してください');
  });

  it('有効な1回予約は現在時刻より1分以上先だけ受け付ける', () => {
    const now = new Date('2030-01-01T00:00:00Z');
    const base = {
      channelId: '123456789012345678',
      content: 'content',
      scheduleTime: '09:00',
      recurrenceType: 'once' as const,
    };
    expect(() =>
      normalizeDailyContentInput(
        { ...base, onceAt: new Date('2030-01-01T00:00:30Z') },
        normalizeDailyContentConfig({}),
        now,
      ),
    ).toThrow('1回予約の日時は現在時刻より1分以上先を指定してください');
    expect(
      normalizeDailyContentInput(
        { ...base, onceAt: new Date('2030-01-01T00:02:00Z') },
        normalizeDailyContentConfig({}),
        now,
      ).onceAt,
    ).toEqual(new Date('2030-01-01T00:02:00Z'));
  });
'''
if insert.strip() not in text:
    text = text.rsplit("\n});", 1)[0] + insert + "\n});\n"
p.write_text(text)

# Message helper tests.
p = Path("plugins/daily-content/src/message.test.ts")
text = p.read_text()
insert = r'''

  it('Canary/PTBのDiscordメッセージURLも受け付ける', () => {
    for (const host of ['canary.discord.com', 'ptb.discord.com']) {
      expect(
        parseDiscordMessageUrl(
          `https://${host}/channels/123456789012345678/223456789012345678/323456789012345678`,
        ),
      ).toMatchObject({ guildId: '123456789012345678', channelId: '223456789012345678' });
    }
  });

  it('一覧表示で使う中黒と全角カンマを曜日区切りとして再入力できる', () => {
    expect(parseMessageStudioWeekdays('月・水・金')).toEqual([1, 3, 5]);
    expect(parseMessageStudioWeekdays('月，水，金')).toEqual([1, 3, 5]);
  });
'''
if insert.strip() not in text:
    text = text.rsplit("\n});", 1)[0] + insert + "\n});\n"
p.write_text(text)

# Focused one-shot lifecycle regression.
Path("plugins/daily-content/src/service.test.ts").write_text(r'''import { describe, expect, it } from 'vitest';
import {
  markDeliverySent,
  reserveDueDelivery,
  type DailyContentDeliveryRecord,
  type DailyContentPrismaClient,
  type DailyContentRecord,
  type DailyContentTransactionClient,
} from './service.js';

function createHarness() {
  const scheduledFor = new Date('2030-01-01T00:10:00Z');
  let schedule: DailyContentRecord = {
    id: 'schedule-1',
    guildId: 'guild-1',
    channelId: '123456789012345678',
    title: 'one-shot',
    content: 'content',
    scheduleTime: '00:10',
    timezone: 'UTC',
    enabled: true,
    recurrenceType: 'once',
    onceAt: scheduledFor,
    weekdays: [],
    messageFormat: 'text',
    embedJson: null,
    publishAnnouncement: false,
    nextRunAt: scheduledFor,
    lastScheduledAt: null,
    lastSentAt: null,
    deletedAt: null,
    createdBy: 'user-1',
    updatedBy: 'user-1',
    createdAt: new Date('2029-12-01T00:00:00Z'),
    updatedAt: new Date('2029-12-01T00:00:00Z'),
  };
  let delivery: DailyContentDeliveryRecord | null = null;

  const tx = {
    dailyContent: {
      count: async () => 1,
      findMany: async () => [schedule],
      findFirst: async () => schedule,
      create: async () => schedule,
      update: async (args: Record<string, unknown>) => {
        const data = (args['data'] ?? {}) as Partial<DailyContentRecord>;
        schedule = { ...schedule, ...data };
        return schedule;
      },
      delete: async () => schedule,
    },
    dailyContentDelivery: {
      findMany: async () => (delivery ? [delivery] : []),
      findFirst: async () => delivery,
      create: async (args: Record<string, unknown>) => {
        const data = args['data'] as Record<string, unknown>;
        const now = new Date('2030-01-01T00:10:00Z');
        delivery = {
          id: 'delivery-1',
          dailyContentId: String(data['dailyContentId']),
          guildId: String(data['guildId']),
          idempotencyKey: String(data['idempotencyKey']),
          origin: 'scheduled',
          scheduledFor: data['scheduledFor'] as Date,
          status: 'pending',
          attemptCount: 0,
          messageId: null,
          errorName: null,
          queuedAt: null,
          startedAt: null,
          nextAttemptAt: data['nextAttemptAt'] as Date,
          sentAt: null,
          failedAt: null,
          createdAt: now,
          updatedAt: now,
        };
        return delivery;
      },
      update: async (args: Record<string, unknown>) => {
        if (!delivery) throw new Error('delivery missing');
        const data = (args['data'] ?? {}) as Partial<DailyContentDeliveryRecord>;
        delivery = { ...delivery, ...data };
        return delivery;
      },
    },
    auditLog: { create: async () => ({}) },
    guildPlugin: { findUnique: async () => ({ enabled: true }) },
    $queryRawUnsafe: async () => [],
  } as unknown as DailyContentTransactionClient;

  const prisma = {
    ...tx,
    $transaction: async <T>(callback: (client: DailyContentTransactionClient) => Promise<T>) =>
      callback(tx),
  } as unknown as DailyContentPrismaClient;

  return { prisma, scheduledFor, getSchedule: () => schedule, getDelivery: () => delivery };
}

describe('Message Studio one-shot delivery lifecycle', () => {
  it('予約確保時は有効のまま、予約配信成功後にだけ無効化する', async () => {
    const harness = createHarness();
    const reserved = await reserveDueDelivery(harness.prisma, 'schedule-1', harness.scheduledFor);

    expect(reserved?.status).toBe('pending');
    expect(harness.getSchedule().enabled).toBe(true);
    expect(harness.getSchedule().nextRunAt).toBeNull();

    const sentAt = new Date('2030-01-01T00:10:05Z');
    await markDeliverySent(harness.prisma, {
      deliveryId: reserved!.id,
      scheduleId: 'schedule-1',
      messageId: 'message-1',
      sentAt,
      completeOneShot: true,
    });

    expect(harness.getDelivery()?.status).toBe('sent');
    expect(harness.getSchedule().enabled).toBe(false);
    expect(harness.getSchedule().lastSentAt).toEqual(sentAt);
  });
});
''')
