const DISCORD_ID_PATTERN = /^\d{17,20}$/u;
const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;

export interface ManualBirthdayDeliveryInput {
  discordUserId: string;
  localDate: string;
}

/**
 * Validates the manual birthday delivery trigger body (#1062):
 * exactly a Discord user id and a real calendar date in
 * `YYYY-MM-DD` form. The date *range* (JST today + past 7 days)
 * is not judged here — the plugin re-validates it as the second
 * line of defence and reports it as a reason code, so this
 * parser only rejects shapes that can never be a delivery.
 */
export function parseManualBirthdayDeliveryInput(
  value: unknown,
): ManualBirthdayDeliveryInput | null {
  if (!isRecord(value)) return null;
  const discordUserId = typeof value.discordUserId === 'string' ? value.discordUserId.trim() : '';
  const localDate = typeof value.localDate === 'string' ? value.localDate.trim() : '';
  if (!DISCORD_ID_PATTERN.test(discordUserId)) return null;
  const match = LOCAL_DATE_PATTERN.exec(localDate);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day)
    return null;
  return { discordUserId, localDate };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
