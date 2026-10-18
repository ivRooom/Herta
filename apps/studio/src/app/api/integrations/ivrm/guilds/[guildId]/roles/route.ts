import { getGuildConfigurationOptions } from '@/lib/bot-guild-options';
import { handleIvrmGuildRoles } from '@/lib/ivrm-guild-roles';

export const dynamic = 'force-dynamic';

/** Read the configured guild's role directory through the existing ivrm integration. */
export async function GET(request: Request, { params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  return handleIvrmGuildRoles(request, guildId, getGuildConfigurationOptions);
}
