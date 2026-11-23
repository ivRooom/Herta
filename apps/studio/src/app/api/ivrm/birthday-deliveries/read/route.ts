import { prisma } from '@/lib/db';
import {
  authorizeBirthdayDeliveryHistoryRead,
  projectBirthdayDeliveryHistoryRow,
} from '@/lib/birthday-delivery-history';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  const input = await authorizeBirthdayDeliveryHistoryRead(request);
  if (input instanceof Response) return input;
  const reply = (body: unknown, status = 200) =>
    Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
  try {
    const rows = await prisma.$queryRaw<
      Array<{
        date: string;
        discordUserId: string;
        kind: string;
        status: string;
        errorName: string | null;
        completedAt: Date | null;
        createdAt: Date;
      }>
    >`SELECT local_date AS date,user_id AS "discordUserId",kind,status,error_name AS "errorName",completed_at AS "completedAt",created_at AS "createdAt" FROM birthday_deliveries WHERE guild_id=${input.guildId} AND local_date>=${input.from} AND local_date<=${input.to} ORDER BY local_date DESC,created_at DESC,idempotency_key ASC LIMIT ${input.limit} OFFSET ${input.offset}`;
    const counts = await prisma.$queryRaw<
      Array<{ total: number }>
    >`SELECT COUNT(*)::int AS total FROM birthday_deliveries WHERE guild_id=${input.guildId} AND local_date>=${input.from} AND local_date<=${input.to}`;
    const total = counts[0]?.total ?? 0;
    return reply({
      status: 'ok',
      guildId: input.guildId,
      items: rows.map((row) => projectBirthdayDeliveryHistoryRow(row)),
      pagination: {
        limit: input.limit,
        offset: input.offset,
        total,
        hasNext: input.offset + rows.length < total,
      },
    });
  } catch {
    return reply({ error: 'birthday_history_unavailable' }, 503);
  }
}
