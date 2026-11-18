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
