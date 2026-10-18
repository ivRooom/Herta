import { getGuildConfigurationOptions } from '@/lib/bot-guild-options';
import { handleIvrmGuildRoles } from '@/lib/ivrm-guild-roles';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  return handleIvrmGuildRoles(request, guildId, getGuildConfigurationOptions);
}
