import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { PrismaClient } from '@herta/db';
import { gameAccountsManifest } from '@herta/plugin-catalog';
import { definePlugin, type PluginEventHandler } from '@herta/plugin-sdk';
import { callIvrmGameAccounts } from './game-accounts-ivrm.js';
import {
  formatGameAccountsError,
  formatLinkSuccess,
  formatListMessage,
  formatScoreMessage,
  formatUnlinkSuccess,
  formatUnsupportedScoreMessage,
  gameDefinition,
  gameName,
  isShowcaseSupported,
} from './game-accounts-core.js';

const UNLINK_CUSTOM_ID_PREFIX = 'game-accounts:unlink:';

const inFlight = new Set<string>();

interface GameAccountsConfig {
  enabled: boolean;
}

interface GameButtonInteraction {
  guildId: string | null;
  user: { id: string };
  customId?: string;
  isButton?(): boolean;
  reply(options: { content: string; flags: number }): Promise<unknown>;
  update(options: { content: string; components: never[] }): Promise<unknown>;
}

function buildUnlinkCustomId(action: 'confirm' | 'cancel', userId: string, gameCode: string) {
  return `${UNLINK_CUSTOM_ID_PREFIX}${action}:${userId}:${gameCode}`;
}

function parseUnlinkCustomId(
  customId: string,
): { action: 'confirm' | 'cancel'; userId: string; gameCode: string } | null {
  const parts = customId.slice(UNLINK_CUSTOM_ID_PREFIX.length).split(':');
  if (parts.length !== 3) return null;
  const [action, userId, gameCode] = parts as [string, string, string];
  if (action !== 'confirm' && action !== 'cancel') return null;
  if (!/^\d{17,20}$/.test(userId) || !isKnownGameCode(gameCode)) return null;
  return { action, userId, gameCode };
}

function isKnownGameCode(gameCode: string): boolean {
  return gameDefinition(gameCode) !== undefined;
}

function unlinkConfirmRow(userId: string, gameCode: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildUnlinkCustomId('confirm', userId, gameCode))
      .setLabel('解除する')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(buildUnlinkCustomId('cancel', userId, gameCode))
      .setLabel('キャンセル')
      .setStyle(ButtonStyle.Secondary),
  );
}

export const gameAccountsPlugin = definePlugin<GameAccountsConfig, unknown, PrismaClient>({
  manifest: gameAccountsManifest,
  provideCommands(context) {
    return [
      {
        definition: gameAccountsManifest.commands[0]!,
        async execute(interaction: ChatInputCommandInteraction) {
          const guildId = interaction.guildId;
          if (!guildId || context.config.enabled === false) {
            await interaction.reply({
              content: 'サーバー内でゲームアカウント連携Pluginを有効にして利用してください。',
              flags: MessageFlags.Ephemeral,
            });
            return;
          }
          const userId = interaction.user.id;
          const subcommand = interaction.options.getSubcommand();

          // Unlink is destructive, so it never calls the API from the slash
          // command itself: the confirmation button below performs it.
          if (subcommand === 'unlink') {
            const gameCode = interaction.options.getString('game', true);
            await interaction.reply({
              content: `${gameName(gameCode)} のUID登録を解除します。Webのマイページからも消えます。よろしいですか？`,
              components: [unlinkConfirmRow(userId, gameCode)],
              flags: MessageFlags.Ephemeral,
            });
            return;
          }

          const key = `${guildId}:${userId}`;
          if (inFlight.has(key)) {
            await interaction.reply({
              content: '前の処理が終わってから、もう一度お試しください。',
              flags: MessageFlags.Ephemeral,
            });
            return;
          }
          inFlight.add(key);
          try {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            if (subcommand === 'link') {
              const gameCode = interaction.options.getString('game', true);
              const uid = interaction.options.getString('uid', true);
              const result = await callIvrmGameAccounts(guildId, userId, {
                action: 'link',
                gameCode,
                uid,
              });
              await interaction.editReply(
                result.status !== 'ok'
                  ? formatGameAccountsError(result)
                  : result.action === 'link'
                    ? formatLinkSuccess(result)
                    : '処理できませんでした。少し待ってからお試しください。',
              );
              return;
            }
            if (subcommand === 'list') {
              const result = await callIvrmGameAccounts(guildId, userId, { action: 'list' });
              await interaction.editReply(
                result.status !== 'ok'
                  ? formatGameAccountsError(result)
                  : result.action === 'list'
                    ? formatListMessage(result)
                    : '処理できませんでした。少し待ってからお試しください。',
              );
              return;
            }
            if (subcommand === 'score') {
              const gameCode = interaction.options.getString('game', true);
              if (!isShowcaseSupported(gameCode)) {
                await interaction.editReply(formatUnsupportedScoreMessage(gameCode));
                return;
              }
              const result = await callIvrmGameAccounts(guildId, userId, {
                action: 'score',
                gameCode,
              });
              await interaction.editReply(
                result.status !== 'ok'
                  ? formatGameAccountsError(result)
                  : result.action === 'score'
                    ? formatScoreMessage(result)
                    : '処理できませんでした。少し待ってからお試しください。',
              );
              return;
            }
            await interaction.editReply('不明な操作です。');
          } catch (error) {
            // Never include UIDs or other member values in logs or error replies.
            context.logger.error(
              { error: error instanceof Error ? error.name : 'UnknownError' },
              'Game accounts command failed',
            );
            await interaction.editReply('処理できませんでした。少し待ってからお試しください。');
          } finally {
            inFlight.delete(key);
          }
        },
      },
    ];
  },
  provideEvents() {
    return [
      {
        event: 'interactionCreate',
        async handler(context, ...args) {
          const interaction = args[0] as GameButtonInteraction | undefined;
          if (
            !interaction?.isButton?.() ||
            !interaction.customId?.startsWith(UNLINK_CUSTOM_ID_PREFIX)
          )
            return;
          if (!interaction.guildId || interaction.guildId !== context.guildId) return;
          const parsed = parseUnlinkCustomId(interaction.customId);
          if (!parsed) return;
          if (parsed.userId !== interaction.user.id) {
            await interaction.reply({
              content: 'この確認ボタンは、コマンドを実行した本人だけが使えます。',
              flags: MessageFlags.Ephemeral,
            });
            return;
          }
          if (context.config.enabled === false) {
            await interaction.reply({
              content: 'ゲームアカウント連携Pluginは現在無効です。',
              flags: MessageFlags.Ephemeral,
            });
            return;
          }
          if (parsed.action === 'cancel') {
            await interaction.update({
              content: `${gameName(parsed.gameCode)} のUID登録の解除をキャンセルしました。`,
              components: [],
            });
            return;
          }
          try {
            const result = await callIvrmGameAccounts(interaction.guildId, interaction.user.id, {
              action: 'unlink',
              gameCode: parsed.gameCode,
            });
            await interaction.update({
              content:
                result.status === 'ok'
                  ? formatUnlinkSuccess(parsed.gameCode)
                  : formatGameAccountsError(result),
              components: [],
            });
          } catch (error) {
            context.logger.error(
              { error: error instanceof Error ? error.name : 'UnknownError' },
              'Game accounts unlink failed',
            );
            await interaction.reply({
              content: '解除できませんでした。少し待ってからお試しください。',
              flags: MessageFlags.Ephemeral,
            });
          }
        },
      },
    ] as PluginEventHandler<GameAccountsConfig, unknown, PrismaClient>[];
  },
});
