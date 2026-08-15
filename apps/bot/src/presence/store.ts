import type { PrismaClient } from '@herta/db';
import {
  DEFAULT_BOT_PRESENCE_CONFIG,
  normalizeBotPresenceConfig,
  type BotPresenceConfig,
} from '@herta/shared';

export async function loadStoredBotPresence(prisma: PrismaClient): Promise<BotPresenceConfig> {
  const setting = await prisma.botPresenceSetting.findUnique({
    where: { id: 'default' },
    select: {
      status: true,
      activityType: true,
      activityText: true,
    },
  });
  if (!setting) return { ...DEFAULT_BOT_PRESENCE_CONFIG };
  return normalizeBotPresenceConfig(setting);
}
