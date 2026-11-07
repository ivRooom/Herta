import { searchGuildMembers } from '@/lib/bot-guild-members';
import { handleIvrmGuildMembers } from '@/lib/ivrm-guild-members';

export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await context.params;
  return handleIvrmGuildMembers(request, guildId, searchGuildMembers);
}
