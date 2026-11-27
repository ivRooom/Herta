import { searchMemberActivityEvents } from '@herta/db';
import { prisma } from '@/lib/db';
import {
  authorizeMemberActivityRead,
  projectMemberActivityEvent,
} from '@/lib/member-activity-read';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  const input = await authorizeMemberActivityRead(request);
  if (input instanceof Response) return input;
  const reply = (body: unknown, status = 200) =>
    Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
  try {
    const result = await searchMemberActivityEvents(prisma, {
      guildId: input.guildId,
      from: input.from,
      toExclusive: input.toExclusive,
      event: input.event,
      userId: input.userId,
      channelId: input.channelId,
      page: input.page,
      pageSize: input.pageSize,
    });
    return reply({
      status: 'ok',
      guildId: input.guildId,
      items: result.items.map((item) => projectMemberActivityEvent(item)),
      pagination: {
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
        totalPages: result.totalPages,
        hasNext: result.page < result.totalPages,
      },
    });
  } catch (error) {
    console.error('member_activity_read_failed', error);
    return reply({ error: 'member_activity_unavailable' }, 503);
  }
}
