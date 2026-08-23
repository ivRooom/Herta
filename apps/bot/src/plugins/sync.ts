import {
  Routes,
  type Client,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import type { Logger } from '@herta/logger';
import type { SlashCommand } from '../commands/registry.js';
import { toDiscordCommandJSON } from '../commands/registry.js';
import { reconcilePluginRuntimeStartupOnce } from './runtime-startup-reconciliation.js';

export function buildGuildCommandBodies(
  coreCommands: SlashCommand[],
  pluginCommands: SlashCommand[],
  logger?: Logger,
): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
  const names = new Set<string>();
  const bodies: RESTPostAPIChatInputApplicationCommandsJSONBody[] = [];
  for (const command of [...coreCommands, ...pluginCommands]) {
    const name = command.definition.name;
    if (names.has(name)) {
      logger?.warn({ commandName: name }, '重複したGuild Commandをスキップしました');
      continue;
    }
    names.add(name);
    bodies.push(toDiscordCommandJSON(command));
  }
  return bodies;
}

export async function syncGuildCommands(
  client: Client,
  guildId: string,
  coreCommands: SlashCommand[],
  pluginCommands: SlashCommand[],
  logger: Logger,
): Promise<void> {
  const appId = client.application?.id ?? process.env['DISCORD_CLIENT_ID'];
  if (!appId) {
    const error = new Error('Discord Application ID is unavailable');
    logger.warn(
      { guildId },
      'Discord Application ID が取得できないため、Guild Commandの登録を実行できません',
    );
    throw error;
  }

  const body = buildGuildCommandBodies(coreCommands, pluginCommands, logger);
  const commandNames = body.map((command) => command.name);
  try {
    await client.rest.put(Routes.applicationGuildCommands(appId, guildId), { body });
    logger.info({ guildId, count: body.length, commandNames }, 'Guild Commandを登録しました');
    await reconcilePluginRuntimeStartupOnce(guildId, logger);
  } catch (error) {
    logger.error(
      { err: error, guildId, appId, count: body.length, commandNames },
      'Guild Commandの登録に失敗しました',
    );
    throw error;
  }
}
