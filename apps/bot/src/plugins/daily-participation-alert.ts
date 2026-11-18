import { PermissionFlagsBits, type Guild, type GuildMember } from 'discord.js';

interface AlertFallbackChannel {
  send: (options: { content: string; allowedMentions: { parse: [] } }) => Promise<unknown>;
}

/**
 * Resolve where a delivery-delay alert is posted. When a dedicated alert
 * channel is configured and the bot can post there, alerts go there so
 * operational warnings stay out of the member-facing announcement channel;
 * otherwise the announcement channel is used, as before.
 *
 * ViewChannel is deliberately not required for the alert channel: ops
 * channels may be post-only for the bot, and the alert is a plain text
 * message. Any failure to resolve the alert channel falls back silently —
 * an alerting path must never break the scan itself.
 */
export async function dailyDeliveryAlertSender(
  guild: Guild,
  me: GuildMember,
  alertChannelId: string | undefined,
  fallback: AlertFallbackChannel,
): Promise<(content: string) => Promise<unknown>> {
  if (alertChannelId) {
    try {
      const channel = await guild.channels.fetch(alertChannelId);
      if (
        channel?.isTextBased() &&
        !channel.isThread() &&
        'send' in channel &&
        channel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages)
      ) {
        return (content) => channel.send({ content, allowedMentions: { parse: [] } });
      }
    } catch {
      /* fall back to the announcement channel */
    }
  }
  return (content) => fallback.send({ content, allowedMentions: { parse: [] } });
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

/** Footer appended to an alert message: incident id, start, and elapsed time. */
export function dailyDeliveryAlertFooter(
  incident: DailyDeliveryAlertIncident,
  now: number,
): string {
  const { hm } = jstParts(incident.firstFailureAt);
  const elapsedMinutes = Math.max(0, Math.floor((now - incident.firstFailureAt) / 60_000));
  const elapsed =
    elapsedMinutes >= 60
      ? `${Math.floor(elapsedMinutes / 60)}時間${elapsedMinutes % 60}分`
      : `${elapsedMinutes}分`;
  const phase = incident.lastAlertAt === 0 ? '初回通知' : '継続通知';
  return `アラートID: ${incident.id}（${phase}） / 発生 ${hm} / 経過 ${elapsed}`;
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
