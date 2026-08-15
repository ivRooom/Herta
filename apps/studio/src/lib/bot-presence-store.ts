import {
  BOT_PRESENCE_EVENT_CHANNEL,
  DEFAULT_BOT_PRESENCE_CONFIG,
  createBotPresenceUpdateEvent,
  normalizeBotPresenceConfig,
  type BotPresenceConfig,
} from '@herta/shared';
import { prisma } from '@/lib/db';
import { redisCommand } from '@/lib/redis-command';

export interface BotPresenceState {
  config: BotPresenceConfig;
  persistenceAvailable: boolean;
}

interface BotPresenceSettingRow {
  status: string;
  activity_type: string;
  activity_text: string;
}

export async function getStoredBotPresence(): Promise<BotPresenceState> {
  try {
    const rows = await prisma.$queryRaw<BotPresenceSettingRow[]>`
      SELECT "status", "activity_type", "activity_text"
      FROM "bot_presence_settings"
      WHERE "id" = 'default'
      LIMIT 1
    `;
    const setting = rows[0];
    return {
      config: setting
        ? normalizeBotPresenceConfig({
            status: setting.status,
            activityType: setting.activity_type,
            activityText: setting.activity_text,
          })
        : { ...DEFAULT_BOT_PRESENCE_CONFIG },
      persistenceAvailable: true,
    };
  } catch (error) {
    console.error('Bot Presence設定のDB読み込みに失敗しました', {
      error: error instanceof Error ? error.name : 'UnknownError',
    });
    return { config: { ...DEFAULT_BOT_PRESENCE_CONFIG }, persistenceAvailable: false };
  }
}

export async function saveBotPresence(
  config: BotPresenceConfig,
  updatedBy: string,
): Promise<{
  persisted: boolean;
  subscriberCount: number;
}> {
  await prisma.$executeRaw`
    INSERT INTO "bot_presence_settings"
      ("id", "status", "activity_type", "activity_text", "updated_by", "updated_at")
    VALUES
      ('default', ${config.status}, ${config.activityType}, ${config.activityText}, ${updatedBy}, CURRENT_TIMESTAMP)
    ON CONFLICT ("id") DO UPDATE SET
      "status" = EXCLUDED."status",
      "activity_type" = EXCLUDED."activity_type",
      "activity_text" = EXCLUDED."activity_text",
      "updated_by" = EXCLUDED."updated_by",
      "updated_at" = CURRENT_TIMESTAMP
  `;

  const redisUrl = process.env['REDIS_URL'];
  if (!redisUrl) return { persisted: true, subscriberCount: 0 };

  try {
    const event = JSON.stringify(createBotPresenceUpdateEvent(config));
    const publishResult = await redisCommand(
      redisUrl,
      'PUBLISH',
      BOT_PRESENCE_EVENT_CHANNEL,
      event,
    );
    return {
      persisted: true,
      subscriberCount: typeof publishResult === 'number' ? Math.max(0, publishResult) : 0,
    };
  } catch (error) {
    console.error('Bot Presence更新イベントの発行に失敗しました', {
      error: error instanceof Error ? error.name : 'UnknownError',
    });
    return { persisted: true, subscriberCount: 0 };
  }
}
