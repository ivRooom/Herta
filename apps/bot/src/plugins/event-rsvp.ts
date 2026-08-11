import type { PrismaClient } from '@herta/db';
import { eventRsvpManifest } from '@herta/plugin-catalog';
import {
  definePlugin,
  type CommandHandler,
  type PluginEventHandler,
  type PluginRuntimeContext,
} from '@herta/plugin-sdk';
import {
  cancelCommunityEvent,
  claimDueEventReminders,
  closeExpiredCommunityEvents,
  createCommunityEvent,
  deleteCommunityEvent,
  getCommunityEventSnapshot,
  listEventsPendingFinalization,
  listGoingUserIds,
  listUpcomingCommunityEvents,
  markCommunityEventFinalized,
  markEventReminderSent,
  releaseEventReminderClaim,
  setCommunityEventMessageId,
  updateEventRsvp,
  type EventListRecord,
  type EventSnapshot,
} from './event-rsvp-repository.js';

const EPHEMERAL_FLAG = 64;
const EVENT_CUSTOM_ID_PREFIX = 'herta:event-rsvp:v1:';
const WORKER_INTERVAL_MS = 30_000;
const MAX_LIST_PAGE_LENGTH = 1900;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface EventRsvpConfig {
  enabled: boolean;
  ephemeralResponses: boolean;
  eventChannelId: string | null;
  timezone: string;
  defaultCapacity: number;
  maxCapacity: number;
  allowMaybe: boolean;
  allowWaitlist: boolean;
  registrationCloseMinutesBefore: number;
  reminderEnabled: boolean;
  reminderMinutesBefore: number;
  mentionParticipantsOnReminder: boolean;
  maxActivePerUser: number;
}

interface EventOptions {
  getSubcommand(): string;
  getString(name: string, required?: boolean): string | null;
  getInteger(name: string, required?: boolean): number | null;
}

interface MessageHandle {
  id: string;
  edit(options: EventMessage): Promise<unknown>;
  delete(): Promise<unknown>;
}

interface TextChannel {
  isTextBased(): boolean;
  send(options: EventMessage): Promise<MessageHandle>;
  messages: { fetch(messageId: string): Promise<MessageHandle> };
}

interface EventClient {
  channels: { fetch(channelId: string): Promise<TextChannel | null> };
}

interface ReplyOptions {
  content: string;
  flags?: number;
  allowedMentions: { parse: []; users?: string[] };
}

export interface EventMessage {
  content: string;
  components: Array<Record<string, unknown>>;
  allowedMentions: { parse: []; users?: string[] };
}

interface CommandInteraction {
  guildId: string | null;
  channelId: string | null;
  channel: TextChannel | null;
  user: { id: string };
  memberPermissions?: { has(permission: string): boolean } | null;
  options: EventOptions;
  reply(options: ReplyOptions): Promise<unknown>;
  followUp(options: ReplyOptions): Promise<unknown>;
}

interface ComponentInteraction {
  guildId: string | null;
  user: { id: string };
  customId?: string;
  isButton?(): boolean;
  reply(options: ReplyOptions): Promise<unknown>;
  followUp?(options: ReplyOptions): Promise<unknown>;
  update(options: EventMessage): Promise<unknown>;
}

type RuntimeContext = PluginRuntimeContext<EventRsvpConfig, EventClient, PrismaClient>;
const workerTimers = new Map<string, NodeJS.Timeout>();
const workerRuns = new Map<string, Promise<void>>();

export const eventRsvpPlugin = definePlugin<EventRsvpConfig, EventClient, PrismaClient>({
  manifest: eventRsvpManifest,
  async onEnable(context) {
    startWorker(context);
  },
  async onDisable(context) {
    stopWorker(context.guildId);
  },
  provideCommands(context) {
    const command: CommandHandler<CommandInteraction> = {
      definition: eventRsvpManifest.commands[0]!,
      async execute(interaction) {
        await executeEventCommand(context, interaction);
      },
    };
    return [command];
  },
  provideEvents() {
    return [
      {
        event: 'interactionCreate',
        async handler(context, ...args) {
          await handleComponent(
            context as RuntimeContext,
            args[0] as ComponentInteraction | undefined,
          );
        },
      },
    ] as PluginEventHandler<EventRsvpConfig>[];
  },
});

export function normalizeEventRsvpConfig(value: unknown): EventRsvpConfig {
  const source = isRecord(value) ? value : {};
  const maxCapacity = clamp(toInteger(source.maxCapacity, 100), 1, 500);
  return {
    enabled: source.enabled === undefined ? true : source.enabled === true,
    ephemeralResponses:
      source.ephemeralResponses === undefined ? true : source.ephemeralResponses === true,
    eventChannelId:
      typeof source.eventChannelId === 'string' && /^\d+$/.test(source.eventChannelId)
        ? source.eventChannelId
        : null,
    timezone: normalizeTimezone(source.timezone),
    defaultCapacity: clamp(toInteger(source.defaultCapacity, 0), 0, maxCapacity),
    maxCapacity,
    allowMaybe: source.allowMaybe === undefined ? true : source.allowMaybe === true,
    allowWaitlist: source.allowWaitlist === undefined ? true : source.allowWaitlist === true,
    registrationCloseMinutesBefore: clamp(
      toInteger(source.registrationCloseMinutesBefore, 0),
      0,
      10080,
    ),
    reminderEnabled: source.reminderEnabled === undefined ? true : source.reminderEnabled === true,
    reminderMinutesBefore: clamp(toInteger(source.reminderMinutesBefore, 60), 0, 10080),
    mentionParticipantsOnReminder:
      source.mentionParticipantsOnReminder === undefined
        ? true
        : source.mentionParticipantsOnReminder === true,
    maxActivePerUser: clamp(toInteger(source.maxActivePerUser, 5), 1, 20),
  };
}

export function buildEventMessage(snapshot: EventSnapshot): EventMessage {
  const startUnix = Math.floor(snapshot.startsAt.getTime() / 1000);
  const closeUnix = Math.floor(snapshot.registrationClosesAt.getTime() / 1000);
  const cancelled = snapshot.status === 'cancelled';
  const closed = snapshot.status !== 'open';
  const capacity =
    snapshot.capacity === null ? '定員なし' : `${snapshot.goingCount}/${snapshot.capacity}人`;
  const lines = [
    cancelled ? '🚫 **Event Cancelled**' : '📅 **Event / RSVP**',
    `**${snapshot.title}**`,
    snapshot.description ? snapshot.description : null,
    `🕒 <t:${startUnix}:F>（<t:${startUnix}:R>）`,
    snapshot.location ? `📍 ${snapshot.location}` : null,
    `✅ 参加: **${snapshot.goingCount}** / 🤔 未定: **${snapshot.maybeCount}** / ⏳ Waiting: **${snapshot.waitlistCount}**`,
    `👥 ${capacity}`,
    cancelled
      ? '受付状態: **キャンセル**'
      : closed
        ? '受付状態: **締切済み**'
        : `受付締切: <t:${closeUnix}:R>`,
    `Event ID: \`${snapshot.id}\``,
  ].filter((line): line is string => Boolean(line));

  const buttons: Array<Record<string, unknown>> = [
    {
      type: 2,
      style: 3,
      custom_id: `${EVENT_CUSTOM_ID_PREFIX}going:${snapshot.id}`,
      label: snapshot.allowWaitlist ? '✅ 参加 / Waiting' : '✅ 参加',
    },
  ];
  if (snapshot.allowMaybe) {
    buttons.push({
      type: 2,
      style: 2,
      custom_id: `${EVENT_CUSTOM_ID_PREFIX}maybe:${snapshot.id}`,
      label: '🤔 未定',
    });
  }
  buttons.push({
    type: 2,
    style: 4,
    custom_id: `${EVENT_CUSTOM_ID_PREFIX}declined:${snapshot.id}`,
    label: '❌ 不参加',
  });

  return {
    content: truncate(lines.join('\n'), 1990),
    components: closed || cancelled ? [] : [{ type: 1, components: buttons }],
    allowedMentions: { parse: [] },
  };
}

export function parseEventStart(value: string, timezone: string, now = Date.now()): Date | null {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, ys, ms, ds, hs, mins] = match;
  const parts = {
    year: Number(ys),
    month: Number(ms),
    day: Number(ds),
    hour: Number(hs),
    minute: Number(mins),
  };
  if (
    parts.month < 1 ||
    parts.month > 12 ||
    parts.day < 1 ||
    parts.day > 31 ||
    parts.hour > 23 ||
    parts.minute > 59
  )
    return null;
  try {
    const wallUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    let candidate = wallUtc - timezoneOffsetMs(timezone, new Date(wallUtc));
    candidate = wallUtc - timezoneOffsetMs(timezone, new Date(candidate));
    const date = new Date(candidate);
    const formatted = localParts(timezone, date);
    if (
      formatted.year !== parts.year ||
      formatted.month !== parts.month ||
      formatted.day !== parts.day ||
      formatted.hour !== parts.hour ||
      formatted.minute !== parts.minute
    )
      return null;
    if (date.getTime() < now + 5 * 60_000) return null;
    return date;
  } catch {
    return null;
  }
}

async function executeEventCommand(
  context: RuntimeContext,
  interaction: CommandInteraction,
): Promise<void> {
  if (!interaction.guildId) {
    await reply(context, interaction, 'このコマンドはDiscordサーバー内でのみ利用できます。');
    return;
  }
  const config = normalizeEventRsvpConfig(context.config);
  if (!config.enabled) {
    await reply(context, interaction, 'Event / RSVP Pluginは現在無効です。');
    return;
  }
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === 'create') return handleCreate(context, config, interaction);
  if (subcommand === 'list') return handleList(context, interaction);
  if (subcommand === 'info') return handleInfo(context, interaction);
  if (subcommand === 'cancel') return handleCancel(context, interaction);
  await reply(context, interaction, '不明なEvent操作です。');
}

async function handleCreate(
  context: RuntimeContext,
  config: EventRsvpConfig,
  interaction: CommandInteraction,
): Promise<void> {
  const title = interaction.options.getString('title', true)?.trim() ?? '';
  const description = interaction.options.getString('description')?.trim() || null;
  const location = interaction.options.getString('location')?.trim() || null;
  if (!title || title.length > 200)
    return reply(context, interaction, 'titleは1〜200文字で入力してください。');
  if (description && description.length > 1000)
    return reply(context, interaction, 'descriptionは1000文字以内で入力してください。');
  if (location && location.length > 200)
    return reply(context, interaction, 'locationは200文字以内で入力してください。');

  const startText = interaction.options.getString('start', true)?.trim() ?? '';
  const startsAt = parseEventStart(startText, config.timezone);
  if (!startsAt) {
    return reply(
      context,
      interaction,
      `startは ${config.timezone} の \`YYYY-MM-DD HH:mm\` 形式で、5分以上先を指定してください。`,
    );
  }
  const requestedCapacity = interaction.options.getInteger('capacity');
  if (requestedCapacity !== null && requestedCapacity > config.maxCapacity) {
    return reply(context, interaction, `capacityは最大${config.maxCapacity}人です。`);
  }
  const capacityValue = requestedCapacity ?? config.defaultCapacity;
  const capacity = capacityValue > 0 ? capacityValue : null;
  const desiredClose = startsAt.getTime() - config.registrationCloseMinutesBefore * 60_000;
  const registrationClosesAt = new Date(Math.max(Date.now() + 60_000, desiredClose));

  let channel = interaction.channel;
  let channelId = interaction.channelId;
  if (config.eventChannelId) {
    channel = await context.client.channels.fetch(config.eventChannelId).catch(() => null);
    channelId = config.eventChannelId;
  }
  if (!channelId || !channel?.isTextBased()) {
    return reply(
      context,
      interaction,
      'イベント投稿先チャンネルを利用できません。Studio設定とBot権限を確認してください。',
    );
  }

  const eventId = await createCommunityEvent(context.prisma, {
    guildId: interaction.guildId!,
    creatorId: interaction.user.id,
    channelId,
    title,
    description,
    location,
    timezone: config.timezone,
    startsAt,
    registrationClosesAt,
    capacity,
    allowMaybe: config.allowMaybe,
    allowWaitlist: config.allowWaitlist,
    reminderMinutes: config.reminderEnabled ? config.reminderMinutesBefore : 0,
    maxActivePerUser: config.maxActivePerUser,
  });
  if (!eventId) {
    return reply(
      context,
      interaction,
      `未開催イベントが上限（${config.maxActivePerUser}件）に達しています。`,
    );
  }

  let published: MessageHandle | null = null;
  try {
    const snapshot = await getCommunityEventSnapshot(context.prisma, eventId, interaction.guildId!);
    if (!snapshot) throw new Error('EventSnapshotMissing');
    published = await channel.send(buildEventMessage(snapshot));
    await setCommunityEventMessageId(context.prisma, eventId, published.id);
  } catch (error) {
    await published?.delete().catch(() => undefined);
    await deleteCommunityEvent(context.prisma, eventId).catch(() => undefined);
    context.logger.warn(
      { err: error, guildId: interaction.guildId, eventId },
      'Event投稿に失敗しました',
    );
    return reply(
      context,
      interaction,
      'イベント投稿に失敗しました。投稿先チャンネルの権限を確認してください。',
    );
  }

  await reply(
    context,
    interaction,
    `📅 Eventを作成しました。\nID: \`${eventId}\`\n開催: <t:${Math.floor(startsAt.getTime() / 1000)}:F>`,
  ).catch((error) => {
    context.logger.warn({ err: error, eventId }, 'Event作成後の確認メッセージ送信に失敗しました');
  });
}

async function handleList(context: RuntimeContext, interaction: CommandInteraction): Promise<void> {
  const records = await listUpcomingCommunityEvents(context.prisma, interaction.guildId!);
  const pages = formatEventListPages(records);
  await reply(context, interaction, pages[0]!);
  for (const page of pages.slice(1)) await followUp(context, interaction, page);
}

async function handleInfo(context: RuntimeContext, interaction: CommandInteraction): Promise<void> {
  const id = readId(interaction);
  if (!id) return reply(context, interaction, 'Event IDの形式が不正です。');
  const snapshot = await getCommunityEventSnapshot(context.prisma, id, interaction.guildId!);
  if (!snapshot) return reply(context, interaction, 'Eventが見つかりません。');
  await reply(context, interaction, formatEventInfo(snapshot));
}

async function handleCancel(
  context: RuntimeContext,
  interaction: CommandInteraction,
): Promise<void> {
  const id = readId(interaction);
  if (!id) return reply(context, interaction, 'Event IDの形式が不正です。');
  const snapshot = await getCommunityEventSnapshot(context.prisma, id, interaction.guildId!);
  if (!snapshot) return reply(context, interaction, 'Eventが見つかりません。');
  const isManager = interaction.memberPermissions?.has('ManageGuild') === true;
  if (snapshot.creatorId !== interaction.user.id && !isManager) {
    return reply(
      context,
      interaction,
      'Eventをキャンセルできるのは主催者またはManage Server権限保持者です。',
    );
  }
  const cancelled = await cancelCommunityEvent(context.prisma, id, interaction.guildId!);
  if (!cancelled) return reply(context, interaction, 'このEventはキャンセルできません。');
  const updated = await getCommunityEventSnapshot(context.prisma, id, interaction.guildId!);
  if (updated) {
    await finalizeEventMessage(context, updated).catch((error) => {
      context.logger.warn(
        { err: error, eventId: id },
        'Eventキャンセル表示更新に失敗しました。Workerで再試行します',
      );
    });
  }
  await reply(context, interaction, `Event \`${id}\` をキャンセルしました。`);
}

async function handleComponent(
  context: RuntimeContext,
  interaction: ComponentInteraction | undefined,
): Promise<void> {
  if (!interaction?.isButton?.() || !interaction.customId?.startsWith(EVENT_CUSTOM_ID_PREFIX))
    return;
  if (!interaction.guildId) return;
  const config = normalizeEventRsvpConfig(context.config);
  if (!config.enabled) {
    await interaction.reply({
      content: 'Event / RSVP Pluginは現在無効です。',
      flags: EPHEMERAL_FLAG,
      allowedMentions: { parse: [] },
    });
    return;
  }
  const payload = interaction.customId.slice(EVENT_CUSTOM_ID_PREFIX.length);
  const [requestedStatus, eventId] = payload.split(':');
  if (
    !eventId ||
    !UUID_PATTERN.test(eventId) ||
    !['going', 'maybe', 'declined'].includes(requestedStatus ?? '')
  )
    return;
  const result = await updateEventRsvp(context.prisma, {
    eventId,
    guildId: interaction.guildId,
    userId: interaction.user.id,
    requestedStatus: requestedStatus as 'going' | 'maybe' | 'declined',
  });
  if (!result.ok) {
    const message =
      result.reason === 'full'
        ? '定員に達しており、Waiting Listも無効です。'
        : result.reason === 'maybe-disabled'
          ? 'このEventでは「未定」を選択できません。'
          : result.reason === 'closed'
            ? 'このEventのRSVP受付は終了しています。'
            : 'Eventが見つかりません。';
    await interaction.reply({
      content: message,
      flags: EPHEMERAL_FLAG,
      allowedMentions: { parse: [] },
    });
    return;
  }
  const snapshot = await getCommunityEventSnapshot(context.prisma, eventId, interaction.guildId);
  if (!snapshot) return;
  await interaction.update(buildEventMessage(snapshot));
  if (result.status === 'waitlist') {
    await interaction
      .followUp?.({
        content: '定員に達しているためWaiting Listへ登録しました。',
        flags: EPHEMERAL_FLAG,
        allowedMentions: { parse: [] },
      })
      .catch(() => undefined);
  }
}

function startWorker(context: RuntimeContext): void {
  stopWorker(context.guildId);
  const run = () =>
    runWorker(context).catch((error) => {
      context.logger.warn(
        { err: error, guildId: context.guildId },
        'Event Worker実行に失敗しました',
      );
    });
  void run();
  const timer = setInterval(() => void run(), WORKER_INTERVAL_MS);
  timer.unref?.();
  workerTimers.set(context.guildId, timer);
}

function stopWorker(guildId: string): void {
  const timer = workerTimers.get(guildId);
  if (timer) clearInterval(timer);
  workerTimers.delete(guildId);
}

async function runWorker(context: RuntimeContext): Promise<void> {
  if (workerRuns.has(context.guildId)) return workerRuns.get(context.guildId);
  const promise = runWorkerUnsafe(context).finally(() => workerRuns.delete(context.guildId));
  workerRuns.set(context.guildId, promise);
  return promise;
}

async function runWorkerUnsafe(context: RuntimeContext): Promise<void> {
  const config = normalizeEventRsvpConfig(context.config);
  if (!config.enabled) return;
  await closeExpiredCommunityEvents(context.prisma, context.guildId);
  const pending = await listEventsPendingFinalization(context.prisma, context.guildId);
  for (const id of pending) {
    const snapshot = await getCommunityEventSnapshot(context.prisma, id, context.guildId);
    if (!snapshot) continue;
    await finalizeEventMessage(context, snapshot).catch((error) => {
      context.logger.warn({ err: error, eventId: id }, 'Event締切メッセージ更新に失敗しました');
    });
  }
  const reminders = await claimDueEventReminders(context.prisma, context.guildId);
  for (const reminder of reminders) {
    try {
      const channel = await context.client.channels.fetch(reminder.channelId);
      if (!channel?.isTextBased()) throw new Error('EventReminderChannelUnavailable');
      const users = config.mentionParticipantsOnReminder
        ? await listGoingUserIds(context.prisma, reminder.id)
        : [];
      const mentionUsers = users.slice(0, 50);
      const unix = Math.floor(reminder.startsAt.getTime() / 1000);
      const text = [
        '⏰ **Event Reminder**',
        `**${reminder.title}** は <t:${unix}:R> に開始します。`,
        reminder.location ? `📍 ${reminder.location}` : null,
        mentionUsers.length > 0 ? mentionUsers.map((id) => `<@${id}>`).join(' ') : null,
        users.length > 50
          ? `参加予定者は${users.length}名です（メンションは先頭50名まで）。`
          : null,
      ]
        .filter((line): line is string => Boolean(line))
        .join('\n');
      await channel.send({
        content: truncate(text, 1990),
        components: [],
        allowedMentions: { parse: [], users: mentionUsers },
      });
      await markEventReminderSent(context.prisma, reminder.id);
    } catch (error) {
      await releaseEventReminderClaim(context.prisma, reminder.id).catch(() => undefined);
      context.logger.warn({ err: error, eventId: reminder.id }, 'Event Reminder送信に失敗しました');
    }
  }
}

async function finalizeEventMessage(
  context: RuntimeContext,
  snapshot: EventSnapshot,
): Promise<void> {
  if (!snapshot.messageId) {
    await markCommunityEventFinalized(context.prisma, snapshot.id);
    return;
  }
  const channel = await context.client.channels.fetch(snapshot.channelId);
  if (!channel?.isTextBased()) throw new Error('EventChannelUnavailable');
  const message = await channel.messages.fetch(snapshot.messageId);
  await message.edit(buildEventMessage(snapshot));
  await markCommunityEventFinalized(context.prisma, snapshot.id);
}

export function formatEventListPages(records: readonly EventListRecord[]): string[] {
  if (records.length === 0) return ['今後開催されるEventはありません。'];
  const lines = records.map((record) => {
    const unix = Math.floor(record.startsAt.getTime() / 1000);
    const capacity =
      record.capacity === null
        ? `${record.goingCount}人`
        : `${record.goingCount}/${record.capacity}人`;
    return `• <t:${unix}:f> **${record.title}** — ${capacity} — \`${record.id}\``;
  });
  return paginate('**📅 Upcoming Events**', lines);
}

export function formatEventInfo(snapshot: EventSnapshot): string {
  const unix = Math.floor(snapshot.startsAt.getTime() / 1000);
  return truncate(
    [
      `**📅 ${snapshot.title}**`,
      `状態: **${snapshot.status === 'open' ? '受付中' : snapshot.status === 'closed' ? '締切済み' : 'キャンセル'}**`,
      `開催: <t:${unix}:F>`,
      snapshot.location ? `場所: ${snapshot.location}` : null,
      `参加: ${snapshot.goingCount} / 未定: ${snapshot.maybeCount} / Waiting: ${snapshot.waitlistCount} / 不参加: ${snapshot.declinedCount}`,
      snapshot.capacity === null ? '定員: なし' : `定員: ${snapshot.capacity}人`,
      `主催者: <@${snapshot.creatorId}>`,
      `Event ID: \`${snapshot.id}\``,
    ]
      .filter((line): line is string => Boolean(line))
      .join('\n'),
    1990,
  );
}

function readId(interaction: CommandInteraction): string | null {
  const id = interaction.options.getString('id', true)?.trim() ?? '';
  return UUID_PATTERN.test(id) ? id : null;
}

async function reply(
  context: RuntimeContext,
  interaction: CommandInteraction,
  content: string,
): Promise<void> {
  await interaction.reply({
    content: truncate(content, 1990),
    flags: normalizeEventRsvpConfig(context.config).ephemeralResponses ? EPHEMERAL_FLAG : undefined,
    allowedMentions: { parse: [] },
  });
}

async function followUp(
  context: RuntimeContext,
  interaction: CommandInteraction,
  content: string,
): Promise<void> {
  await interaction.followUp({
    content: truncate(content, 1990),
    flags: normalizeEventRsvpConfig(context.config).ephemeralResponses ? EPHEMERAL_FLAG : undefined,
    allowedMentions: { parse: [] },
  });
}

function paginate(title: string, lines: readonly string[]): string[] {
  const pages: string[] = [];
  let current = title;
  for (const line of lines) {
    const next = `${current}\n${line}`;
    if (next.length > MAX_LIST_PAGE_LENGTH) {
      pages.push(current);
      current = `${title}（続き）\n${line}`;
    } else current = next;
  }
  pages.push(current);
  return pages;
}

function normalizeTimezone(value: unknown): string {
  const timezone = typeof value === 'string' && value.length <= 64 ? value : 'Asia/Tokyo';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    return 'Asia/Tokyo';
  }
}

function localParts(timezone: string, date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
  };
}

function timezoneOffsetMs(timezone: string, date: Date): number {
  const parts = localParts(timezone, date);
  return (
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) -
    Math.floor(date.getTime() / 60_000) * 60_000
  );
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`;
}
function toInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback;
}
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
