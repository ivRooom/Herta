import { getGuildConfigurationOptions } from '@/lib/bot-guild-options';
import { handleIvrmGuildChannels } from '@/lib/ivrm-guild-channels';

export const dynamic = 'force-dynamic';

/** Read the configured guild's channel directory through the existing ivrm integration. */
export async function GET(request: Request, { params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  return handleIvrmGuildChannels(request, guildId, getGuildConfigurationOptions);
}
