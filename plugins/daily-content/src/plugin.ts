import { definePlugin } from '@herta/plugin-sdk';
import type { CommandHandler, PluginRuntimeContext } from '@herta/plugin-sdk';
import { normalizeDailyContentConfig, type DailyContentConfig } from './config.js';
import { dailyContentManifest } from './manifest.js';
import {
  getDailyContent,
  reserveManualDelivery,
  type DailyContentPrismaClient,
} from './service.js';

const EPHEMERAL_FLAG = 64;
const MANAGE_GUILD_PERMISSION = 32n;
const MAX_PREVIEW_LENGTH = 1900;

interface PermissionSet {
  has(permission: bigint): boolean;
}

interface DailyContentCommandOptions {
  getSubcommand(): string;
  getString(name: string, required?: boolean): string | null;
}

interface DailyContentCommandInteraction {
  id: string;
  guildId: string | null;
  user: { id: string };
  memberPermissions: PermissionSet | null;
  options: DailyContentCommandOptions;
  replied: boolean;
  deferred: boolean;
  reply(options: DailyContentReplyOptions): Promise<unknown>;
  followUp(options: DailyContentReplyOptions): Promise<unknown>;
}

interface DailyContentReplyOptions {
  content: string;
  flags?: number;
  allowedMentions: { parse: [] };
}

type DailyContentRuntimeContext = PluginRuntimeContext<
  DailyContentConfig,
  unknown,
  DailyContentPrismaClient
>;

export const dailyContentPlugin = definePlugin<
  DailyContentConfig,
  unknown,
  DailyContentPrismaClient
>({
  manifest: dailyContentManifest,

  async onEnable(context) {
    normalizeDailyContentConfig(context.config);
    context.logger.info('Daily Content Plugin v1を有効化しました');
  },

  async onDisable(context) {
    context.logger.info('Daily Content Plugin v1を無効化しました');
  },

  provideCommands(context) {
    const command: CommandHandler<DailyContentCommandInteraction> = {
      definition: dailyContentManifest.commands[0]!,
      async execute(interaction) {
        await executeDailyContentCommand(context, interaction);
      },
    };
    return [command];
  },
});

async function executeDailyContentCommand(
  context: DailyContentRuntimeContext,
  interaction: DailyContentCommandInteraction,
): Promise<void> {
  if (!interaction.guildId || interaction.guildId !== context.guildId) {
    await respond(interaction, 'このコマンドは対象サーバー内でのみ利用できます');
    return;
  }
  if (!interaction.memberPermissions?.has(MANAGE_GUILD_PERMISSION)) {
    await respond(interaction, 'この操作には「サーバーの管理」権限が必要です');
    return;
  }

  const scheduleId = interaction.options.getString('schedule_id', true)?.trim();
  if (!scheduleId) {
    await respond(interaction, 'schedule_idを指定してください');
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  if (subcommand === 'preview') {
    await previewDailyContent(context, interaction, scheduleId);
    return;
  }
  if (subcommand === 'publish') {
    await queueManualDelivery(context, interaction, scheduleId);
    return;
  }

  await respond(interaction, '未対応のサブコマンドです');
}

async function previewDailyContent(
  context: DailyContentRuntimeContext,
  interaction: DailyContentCommandInteraction,
  scheduleId: string,
): Promise<void> {
  const schedule = await getDailyContent(context.prisma, context.guildId, scheduleId);
  if (!schedule) {
    await respond(interaction, '指定したDaily Contentが見つかりません');
    return;
  }

  const heading = schedule.title ? `**${escapeMarkdown(schedule.title)}**\n` : '';
  const body = `${heading}${schedule.content}`;
  const truncated =
    body.length > MAX_PREVIEW_LENGTH
      ? `${body.slice(0, MAX_PREVIEW_LENGTH - 20)}\n…（省略）`
      : body;
  await respond(
    interaction,
    `プレビュー（<#${schedule.channelId}> / ${schedule.scheduleTime} ${schedule.timezone}）\n\n${truncated}`,
  );
}

async function queueManualDelivery(
  context: DailyContentRuntimeContext,
  interaction: DailyContentCommandInteraction,
  scheduleId: string,
): Promise<void> {
  const delivery = await reserveManualDelivery(context.prisma, {
    guildId: context.guildId,
    scheduleId,
    actorId: interaction.user.id,
    requestId: interaction.id,
  });
  if (!delivery) {
    await respond(interaction, '指定したDaily Contentが見つかりません');
    return;
  }
  await respond(interaction, `手動配信をキューへ追加しました（配信ID: ${delivery.id}）`);
}

async function respond(
  interaction: DailyContentCommandInteraction,
  content: string,
): Promise<void> {
  const options: DailyContentReplyOptions = {
    content,
    flags: EPHEMERAL_FLAG,
    allowedMentions: { parse: [] },
  };
  if (interaction.replied || interaction.deferred) {
    await interaction.followUp(options);
  } else {
    await interaction.reply(options);
  }
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}\[\]()#+\-.!|>]/g, '\\$&');
}

export default dailyContentPlugin;
