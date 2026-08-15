import type { PrismaClient } from '@herta/db';
import {
  DEFAULT_BOT_PRESENCE_CONFIG,
  normalizeBotPresenceConfig,
  type BotPresenceConfig,
} from '@herta/shared';

interface BotPresenceSettingRow {
  status: string;
  activity_type: string;
  activity_text: string;
}

export async function loadStoredBotPresence(prisma: PrismaClient): Promise<BotPresenceConfig> {
  const rows = await prisma.$queryRaw<BotPresenceSettingRow[]>`
    SELECT "status", "activity_type", "activity_text"
    FROM "bot_presence_settings"
    WHERE "id" = 'default'
    LIMIT 1
  `;
  const setting = rows[0];
  if (!setting) return { ...DEFAULT_BOT_PRESENCE_CONFIG };

  return normalizeBotPresenceConfig({
    status: setting.status,
    activityType: setting.activity_type,
    activityText: setting.activity_text,
  });
}
