import {
  authorizeBirthdayManualDelivery,
  BirthdayManualDeliveryError,
  requestBirthdayManualDelivery,
} from '@/lib/birthday-manual-delivery';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const input = await authorizeBirthdayManualDelivery(request);
  if (input instanceof Response) return input;
  const reply = (body: unknown, status = 200) =>
    Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
  try {
    const result = await requestBirthdayManualDelivery(input.guildId, {
      discordUserId: input.discordUserId,
      localDate: input.localDate,
    });
    return reply({ status: 'ok', guildId: input.guildId, result });
  } catch (error) {
    if (error instanceof BirthdayManualDeliveryError && error.status === 404) {
      // Bot build without the manual-delivery endpoint: the run
      // cannot be executed, reported as unavailable like every
      // other upstream failure.
      return reply({ error: 'birthday_manual_delivery_unavailable' }, 503);
    }
    if (error instanceof BirthdayManualDeliveryError) {
      return reply({ error: 'birthday_manual_delivery_unavailable' }, error.status);
    }
    return reply({ error: 'birthday_manual_delivery_unavailable' }, 503);
  }
}
