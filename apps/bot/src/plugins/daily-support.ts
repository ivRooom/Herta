import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  type ButtonInteraction,
  type Client,
} from 'discord.js';

/**
 * Support escalation for failed daily operations (#896).
 *
 * When a Discord-side bonus claim or quiz answer fails for a service-side
 * reason, the failure reply gains two buttons: one that notifies the
 * operators (mentioning the configured support role in the configured
 * support channel) and one that links to the Member portal, where the
 * same operation can be retried on the Web. Nothing here changes the
 * success paths, and with no support channel configured the notify
 * button is simply not rendered (fail-safe).
 */

export type DailySupportKind = 'claim' | 'answer';

export type DailySupportFailureClass = 'service_unavailable' | 'account_unlinked' | 'unexpected';

export interface DailySupportConfig {
  supportChannelId?: string;
  supportRoleId?: string;
}

/** The portal page where the same operation can be retried on the Web. */
export const DAILY_SUPPORT_PORTAL_URL: Record<DailySupportKind, string> = {
  claim: 'https://member.ivrm.jp/login-bonus',
  answer: 'https://member.ivrm.jp/participation',
};

const SNOWFLAKE = /^[0-9]{17,20}$/;
const JST_DATE = /^\d{4}-\d\d-\d\d$/;
const TARGET_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function dailySupportConfigured(config: DailySupportConfig | undefined): boolean {
  return typeof config?.supportChannelId === 'string' && SNOWFLAKE.test(config.supportChannelId);
}

function supportRoleId(config: DailySupportConfig | undefined): string {
  return typeof config?.supportRoleId === 'string' && SNOWFLAKE.test(config.supportRoleId)
    ? config.supportRoleId
    : '';
}

/**
 * Maps a daily-bonus wallet status to a support failure class.
 * Setup states (profile_required / account_initialization_required) have
 * their own self-service guidance and never escalate; normal outcomes
 * return null.
 */
export function dailySupportFailureClass(status: string): DailySupportFailureClass | null {
  if (status === 'unavailable') return 'service_unavailable';
  if (status === 'unlinked') return 'account_unlinked';
  return null;
}

export interface DailySupportReference {
  kind: DailySupportKind;
  failureClass: DailySupportFailureClass;
  /** Claim: the JST slot date. Answer: the question id. */
  target: string;
}

const NOTIFY_PATTERN =
  /^daily-support:notify:(claim|answer):(service_unavailable|account_unlinked|unexpected):([A-Za-z0-9_-]{1,64})$/;

export function dailySupportNotifyCustomId(ref: DailySupportReference): string {
  return `daily-support:notify:${ref.kind}:${ref.failureClass}:${ref.target}`;
}

export function parseDailySupportNotifyCustomId(customId: string): DailySupportReference | null {
  const match = NOTIFY_PATTERN.exec(customId);
  if (!match) return null;
  const kind = match[1] as DailySupportKind;
  const target = match[3]!;
  if (kind === 'claim' ? !JST_DATE.test(target) : !TARGET_ID.test(target)) return null;
  return { kind, failureClass: match[2] as DailySupportFailureClass, target };
}

export function isDailySupportInteraction(customId: string): boolean {
  return customId.startsWith('daily-support:');
}

/**
 * The action row attached to a failure reply. The notify button appears
 * only when a support channel is configured; the portal link always
 * appears so the member can retry on the Web.
 */
export function dailySupportActionRow(
  ref: DailySupportReference,
  config: DailySupportConfig | undefined,
  notified = false,
): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>();
  if (dailySupportConfigured(config)) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(dailySupportNotifyCustomId(ref))
        .setLabel(notified ? '🛠 運営に知らせました' : '🛠 運営に知らせる')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(notified),
    );
  }
  row.addComponents(
    new ButtonBuilder()
      .setURL(DAILY_SUPPORT_PORTAL_URL[ref.kind])
      .setLabel('Memberポータルで試す')
      .setStyle(ButtonStyle.Link),
  );
  return row;
}

/** One notification per member, operation and target per dedupe window. */
export const DAILY_SUPPORT_DEDUPE_WINDOW_MS = 30 * 60 * 1000;
const notificationLog = new Map<string, number>();

export function dailySupportDedupeKey(
  guildId: string,
  userId: string,
  ref: DailySupportReference,
): string {
  return `${guildId}:${userId}:${ref.kind}:${ref.target}`;
}

/** Reserves a notification slot; returns false when already notified. */
export function tryReserveDailySupportNotification(key: string, now = Date.now()): boolean {
  const last = notificationLog.get(key);
  if (last !== undefined && now - last < DAILY_SUPPORT_DEDUPE_WINDOW_MS) return false;
  notificationLog.set(key, now);
  if (notificationLog.size > 1000) {
    for (const [entry, at] of notificationLog) {
      if (now - at >= DAILY_SUPPORT_DEDUPE_WINDOW_MS) notificationLog.delete(entry);
    }
  }
  return true;
}

export function releaseDailySupportNotification(key: string): void {
  notificationLog.delete(key);
}

export function clearDailySupportNotificationLog(): void {
  notificationLog.clear();
}

const KIND_LABEL: Record<DailySupportKind, string> = {
  claim: 'デイリーボーナス受取',
  answer: 'デイリー問題の表示・回答',
};

const FAILURE_CLASS_LABEL: Record<DailySupportFailureClass, string> = {
  service_unavailable: 'サービスに接続できない、または応答が異常でした',
  account_unlinked: 'ポイント口座の連携を確認できませんでした',
  unexpected: '予期しないエラーが発生しました',
};

/**
 * The operator notification body. Only the member, the time and the
 * failure kind are included — never internal error details or API
 * payloads.
 */
export function dailySupportNotificationContent(input: {
  userId: string;
  userDisplayName: string;
  ref: DailySupportReference;
  now: Date;
}): string {
  const time = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(input.now);
  return [
    '🛠 デイリー操作の失敗報告（Discord）',
    `対象: ${KIND_LABEL[input.ref.kind]}`,
    `内容: ${FAILURE_CLASS_LABEL[input.ref.failureClass]}`,
    `ユーザー: ${input.userDisplayName}（ID: ${input.userId}）`,
    `時刻: ${time} JST`,
    'Discord 側で失敗が続く場合は、Member ポータルでも試せるよう案内済みです。',
  ].join('\n');
}

export interface DailySupportContext {
  guildId: string;
  client: Client;
  config: DailySupportConfig;
}

/** Sends the operator notification. Never throws; false means not sent. */
export async function sendDailySupportNotification(
  ctx: DailySupportContext,
  input: {
    userId: string;
    userDisplayName: string;
    ref: DailySupportReference;
    now?: Date;
  },
): Promise<boolean> {
  if (!dailySupportConfigured(ctx.config)) return false;
  try {
    const channel = await ctx.client.channels.fetch(ctx.config.supportChannelId!);
    if (!channel?.isTextBased() || channel.isThread() || !('send' in channel)) return false;
    const roleId = supportRoleId(ctx.config);
    await channel.send({
      content: `${roleId ? `<@&${roleId}> ` : ''}${dailySupportNotificationContent({
        userId: input.userId,
        userDisplayName: input.userDisplayName,
        ref: input.ref,
        now: input.now ?? new Date(),
      })}`,
      allowedMentions: roleId
        ? { parse: [], roles: [roleId], users: [], repliedUser: false }
        : { parse: [] },
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Handles the 「運営に知らせる」 button. The button lives on an ephemeral
 * failure reply, so only the member who hit the failure can press it.
 */
export async function handleDailySupportNotify(
  ctx: DailySupportContext,
  interaction: ButtonInteraction,
): Promise<void> {
  const ref = parseDailySupportNotifyCustomId(interaction.customId);
  if (!ref) {
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: 'このボタンは無効です。当日の通知から再度お試しください。',
      allowedMentions: { parse: [] },
    });
    return;
  }
  if (!dailySupportConfigured(ctx.config)) {
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content:
        '運営への通知は現在設定されていません。Memberポータルからもお試しください。\n' +
        DAILY_SUPPORT_PORTAL_URL[ref.kind],
      allowedMentions: { parse: [] },
    });
    return;
  }
  const key = dailySupportDedupeKey(ctx.guildId, interaction.user.id, ref);
  if (!tryReserveDailySupportNotification(key)) {
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: 'この件は既に運営へ通知済みです。対応をお待ちください。',
      allowedMentions: { parse: [] },
    });
    return;
  }
  const sent = await sendDailySupportNotification(ctx, {
    userId: interaction.user.id,
    userDisplayName: interaction.user.displayName,
    ref,
  });
  if (!sent) {
    releaseDailySupportNotification(key);
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: '通知を送信できませんでした。時間をおいて再度お試しください。',
      allowedMentions: { parse: [] },
    });
    return;
  }
  // Disable the button on the original failure reply so the same failure
  // cannot be reported twice from the same message.
  try {
    await interaction.update({ components: [dailySupportActionRow(ref, ctx.config, true)] });
    await interaction.followUp({
      flags: MessageFlags.Ephemeral,
      content: '運営に知らせました。対応をお待ちください。',
      allowedMentions: { parse: [] },
    });
  } catch {
    await interaction
      .reply({
        flags: MessageFlags.Ephemeral,
        content: '運営に知らせました。対応をお待ちください。',
        allowedMentions: { parse: [] },
      })
      .catch(() => undefined);
  }
}
