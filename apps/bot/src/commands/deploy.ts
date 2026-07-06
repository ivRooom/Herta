import { Routes, type Client } from 'discord.js';
import type { Logger } from 'pino';
import type { CommandRegistry } from './registry.js';

export async function deployGuildCommands(
  client: Client,
  registry: CommandRegistry,
  logger: Logger,
): Promise<void> {
  const guildId = process.env['DISCORD_GUILD_ID_DEV'];
  if (!guildId) {
    logger.warn(
      'DISCORD_GUILD_ID_DEV が設定されていないため、Guild Command の登録をスキップします',
    );
    return;
  }

  const appId = client.application?.id ?? process.env['DISCORD_CLIENT_ID'];
  if (!appId) {
    logger.warn('Discord Application ID が取得できないため、Guild Command の登録をスキップします');
    return;
  }

  try {
    const body = registry.toDiscordJSON();
    await client.rest.put(Routes.applicationGuildCommands(appId, guildId), { body });
    logger.info({ guildId, count: body.length }, 'Guild Command を登録しました');
  } catch (error) {
    logger.error({ err: error, guildId, appId }, 'Guild Command の登録に失敗しました');
  }
}
