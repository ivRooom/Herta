import { PermissionFlagsBits, type Guild, type GuildMember } from 'discord.js';

export interface DailyDeliveryAlertEmbed {
  title: string;
  description: string;
  color: number;
  timestamp: string;
  fields: { name: string; value: string; inline: boolean }[];
  footer: { text: string };
}

export interface DailyDeliveryAlertMessage {
  embed: DailyDeliveryAlertEmbed;
  /** Plain-text rendering, for channels where the bot cannot post embeds. */
  text: string;
}

interface AlertSendOptions {
  content?: string;
  embeds?: DailyDeliveryAlertEmbed[];
  allowedMentions: { parse: [] };
}

interface AlertFallbackChannel {
  send: (options: AlertSendOptions) => Promise<unknown>;
}

/**
 * Resolve where a delivery-delay alert is posted. When a dedicated alert
 * channel is configured and the bot can post there, alerts go there so
 * operational warnings stay out of the member-facing announcement channel;
 * otherwise the announcement channel is used, as before.
 *
 * ViewChannel is deliberately not required for the alert channel: ops
 * channels may be post-only for the bot. Embeds need EmbedLinks, so a
 * channel with SendMessages but no EmbedLinks receives the plain-text
 * rendering instead of the embed. Any failure to resolve the alert channel
 * falls back silently — an alerting path must never break the scan itself.
 */
export async function dailyDeliveryAlertSender(
  guild: Guild,
  me: GuildMember,
  alertChannelId: string | undefined,
  fallback: AlertFallbackChannel,
): Promise<(message: DailyDeliveryAlertMessage) => Promise<unknown>> {
  if (alertChannelId) {
    try {
      const channel = await guild.channels.fetch(alertChannelId);
      if (channel?.isTextBased() && !channel.isThread() && 'send' in channel) {
        const permissions = channel.permissionsFor(me);
        if (permissions?.has(PermissionFlagsBits.SendMessages)) {
          if (permissions.has(PermissionFlagsBits.EmbedLinks)) {
            return (message) =>
              channel.send({ embeds: [message.embed], allowedMentions: { parse: [] } });
          }
          return (message) =>
            channel.send({ content: message.text, allowedMentions: { parse: [] } });
        }
      }
    } catch {
      /* fall back to the announcement channel */
    }
  }
  return (message) => fallback.send({ embeds: [message.embed], allowedMentions: { parse: [] } });
}

/** An alert fires only once polling failures have persisted this long. */
export const DAILY_DELIVERY_ALERT_AFTER_MS = 600_000;
/** While the same incident continues, repeat alerts are this far apart. */
export const DAILY_DELIVERY_ALERT_INTERVAL_MS = 10_800_000;

export type DailyDeliveryAlertKind = 'results' | 'corrections' | 'rescue';

export interface DailyDeliveryAlertIncident {
  readonly id: string;
  readonly firstFailureAt: number;
  lastAlertAt: number;
}

const KIND_SUFFIX: Record<DailyDeliveryAlertKind, string> = {
  results: 'R',
  corrections: 'C',
  rescue: 'S',
};

function jstParts(epochMs: number): { ymd: string; hm: string } {
  const d = new Date(epochMs + 9 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return {
    ymd: `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`,
    hm: `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`,
  };
}

/**
 * The incident id is derived from when the failure streak began (JST), so
 * every notification about the same continuing failure carries the same id
 * and a new streak is visibly a new incident.
 */
export function dailyDeliveryAlertId(kind: DailyDeliveryAlertKind, firstFailureAt: number): string {
  const { ymd, hm } = jstParts(firstFailureAt);
  return `${ymd}-${hm.replace(':', '')}-${KIND_SUFFIX[kind]}`;
}

function elapsedText(firstFailureAt: number, now: number): string {
  const elapsedMinutes = Math.max(0, Math.floor((now - firstFailureAt) / 60_000));
  return elapsedMinutes >= 60
    ? `${Math.floor(elapsedMinutes / 60)}時間${elapsedMinutes % 60}分`
    : `${elapsedMinutes}分`;
}

function alertPhase(incident: DailyDeliveryAlertIncident): string {
  return incident.lastAlertAt === 0 ? '初回通知' : '継続通知';
}

/** Footer appended to an alert message: incident id, start, and elapsed time. */
export function dailyDeliveryAlertFooter(
  incident: DailyDeliveryAlertIncident,
  now: number,
): string {
  const { hm } = jstParts(incident.firstFailureAt);
  return `アラートID: ${incident.id}（${alertPhase(incident)}） / 発生 ${hm} / 経過 ${elapsedText(incident.firstFailureAt, now)}`;
}

const ALERT_TEXTS: Record<DailyDeliveryAlertKind, { title: string; label: string }> = {
  results: { title: '⚠️ 日次問題の集計・結果配信が遅延しています', label: '結果配信' },
  corrections: { title: '⚠️ 日次問題の結果訂正の通知配信が遅延しています', label: '結果訂正' },
  rescue: { title: '⚠️ 追加問題の告知配信が遅延しています', label: '追加問題の告知' },
};

const ALERT_DESCRIPTION =
  '管理者は管理画面の集計状態を確認してください。確定済みの受取・回答は保持されています。';

/** Warning amber. */
const ALERT_COLOR = 0xfaa61a;

/**
 * Build the alert as a structured embed (id, phase, start, and elapsed time
 * as fields) plus the equivalent plain-text rendering for channels where
 * the bot may not post embeds.
 */
export function dailyDeliveryAlertMessage(
  kind: DailyDeliveryAlertKind,
  incident: DailyDeliveryAlertIncident,
  now: number,
): DailyDeliveryAlertMessage {
  const { title, label } = ALERT_TEXTS[kind];
  const { hm } = jstParts(incident.firstFailureAt);
  return {
    embed: {
      title,
      description: ALERT_DESCRIPTION,
      color: ALERT_COLOR,
      timestamp: new Date(incident.firstFailureAt).toISOString(),
      fields: [
        { name: 'アラートID', value: incident.id, inline: true },
        { name: '状態', value: alertPhase(incident), inline: true },
        { name: '発生', value: hm, inline: true },
        { name: '経過', value: elapsedText(incident.firstFailureAt, now), inline: true },
      ],
      footer: { text: `Herta 配信遅延アラート（${label}）` },
    },
    text: `${title}。${ALERT_DESCRIPTION}\n${dailyDeliveryAlertFooter(incident, now)}`,
  };
}

/**
 * Tracks one scanner's failure streak for one guild. A short blip during a
 * deploy never alerts: failures must persist for
 * DAILY_DELIVERY_ALERT_AFTER_MS first. A successful poll ends the incident;
 * the next failure streak starts a new incident with a new id.
 */
export class DailyDeliveryFailureTracker {
  private incident: DailyDeliveryAlertIncident | null = null;

  constructor(private readonly kind: DailyDeliveryAlertKind) {}

  recordSuccess(): void {
    this.incident = null;
  }

  /** Returns the incident when an alert should be sent for this failure. */
  recordFailure(now: number): DailyDeliveryAlertIncident | null {
    if (!this.incident) {
      this.incident = {
        id: dailyDeliveryAlertId(this.kind, now),
        firstFailureAt: now,
        lastAlertAt: 0,
      };
    }
    const incident = this.incident;
    const persisted = now - incident.firstFailureAt >= DAILY_DELIVERY_ALERT_AFTER_MS;
    const intervalElapsed =
      incident.lastAlertAt === 0 || now - incident.lastAlertAt >= DAILY_DELIVERY_ALERT_INTERVAL_MS;
    return persisted && intervalElapsed ? incident : null;
  }

  recordAlertSent(now: number): void {
    if (this.incident) this.incident.lastAlertAt = now;
  }
}
