import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { PrismaClient } from '@herta/db';
import { gameAccountsManifest } from '@herta/plugin-catalog';
import {
  definePlugin,
  type PluginEventHandler,
  type PluginRuntimeContext,
} from '@herta/plugin-sdk';
import { callIvrmGameAccounts } from './game-accounts-ivrm.js';
import {
  buildGameAccountsErrorEmbed,
  buildLinkSuccessEmbed,
  buildListEmbed,
  buildNoticeEmbed,
  buildScoreEmbed,
  buildUnlinkCancelledEmbed,
  buildUnlinkConfirmEmbed,
  buildUnlinkSuccessEmbed,
  buildUnsupportedScoreEmbed,
  gameDefinition,
  gameName,
  isShowcaseSupported,
  type GameEmbed,
} from './game-accounts-core.js';

const UNLINK_CUSTOM_ID_PREFIX = 'game-accounts:unlink:';

const inFlight = new Set<string>();

/**
 * Confirmations whose unlink API call is in flight, keyed by
 * guild:user:game. A Cancel for a pending confirmation is rejected instead
 * of being shown as a cancellation, because the account will still be
 * deleted by the in-flight request.
 */
const pendingUnlink = new Set<string>();

interface GameAccountsConfig {
  enabled: boolean;
}

interface GameButtonInteraction {
  guildId: string | null;
  user: { id: string };
  customId?: string;
  isButton?(): boolean;
  reply(options: { content: string; flags: number }): Promise<unknown>;
  update(options: {
    embeds?: GameEmbed[];
    components: ActionRowBuilder<ButtonBuilder>[] | never[];
  }): Promise<unknown>;
  deferUpdate(): Promise<unknown>;
  editReply(options: {
    embeds?: GameEmbed[];
    components?: ActionRowBuilder<ButtonBuilder>[] | never[];
  }): Promise<unknown>;
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

function unlinkConfirmRowDisabled(userId: string, gameCode: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildUnlinkCustomId('confirm', userId, gameCode))
      .setLabel('解除する')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(buildUnlinkCustomId('cancel', userId, gameCode))
      .setLabel('キャンセル')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
  );
}

function unlinkPendingKey(guildId: string, userId: string, gameCode: string) {
  return `${guildId}:${userId}:${gameCode}`;
}

/**
 * Handles the unlink Confirm/Cancel buttons. Exported for tests; the plugin
 * wires it through `interactionCreate` unchanged.
 *
 * Two invariants:
 * - A confirmation is recorded as pending before the unlink API call
 *   starts, so a Cancel pressed while it is in flight is rejected with an
 *   "in progress" reply and never shown as a cancellation.
 * - The button interaction is acknowledged with `deferUpdate()` before the
 *   API call (the call may take longer than Discord's 3s window), and the
 *   result is shown via `editReply()`.
 */
export async function handleGameAccountsUnlinkButton(
  context: PluginRuntimeContext<GameAccountsConfig, unknown, PrismaClient>,
  interaction: GameButtonInteraction | undefined,
  callApi: typeof callIvrmGameAccounts = callIvrmGameAccounts,
): Promise<void> {
  if (!interaction?.isButton?.() || !interaction.customId?.startsWith(UNLINK_CUSTOM_ID_PREFIX))
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
  const pendingKey = unlinkPendingKey(interaction.guildId, parsed.userId, parsed.gameCode);
  if (parsed.action === 'cancel') {
    if (pendingUnlink.has(pendingKey)) {
      await interaction.reply({
        content: `${gameName(parsed.gameCode)} のUID登録の解除は進行中です。完了するまでお待ちください。`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.update({
      embeds: [buildUnlinkCancelledEmbed(parsed.gameCode)],
      components: [],
    });
    return;
  }
  if (pendingUnlink.has(pendingKey)) {
    await interaction.reply({
      content: `${gameName(parsed.gameCode)} のUID登録の解除は進行中です。完了するまでお待ちください。`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  pendingUnlink.add(pendingKey);
  try {
    await interaction.deferUpdate();
    // Disable the buttons right away so no further press can race the
    // in-flight unlink.
    await interaction.editReply({
      components: [unlinkConfirmRowDisabled(parsed.userId, parsed.gameCode)],
    });
    const result = await callApi(interaction.guildId, interaction.user.id, {
      action: 'unlink',
      gameCode: parsed.gameCode,
    });
    await interaction.editReply({
      embeds: [
        result.status === 'ok'
          ? buildUnlinkSuccessEmbed(parsed.gameCode)
          : buildGameAccountsErrorEmbed(result),
      ],
      components: [],
    });
  } catch (error) {
    context.logger.error(
      { error: error instanceof Error ? error.name : 'UnknownError' },
      'Game accounts unlink failed',
    );
    await interaction.editReply({
      embeds: [buildNoticeEmbed('解除できませんでした。少し待ってからお試しください。', 'error')],
      components: [],
    });
  } finally {
    pendingUnlink.delete(pendingKey);
  }
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
              embeds: [buildUnlinkConfirmEmbed(gameCode)],
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
              await interaction.editReply({
                embeds: [
                  result.status !== 'ok'
                    ? buildGameAccountsErrorEmbed(result)
                    : result.action === 'link'
                      ? buildLinkSuccessEmbed(result)
                      : buildNoticeEmbed(
                          '処理できませんでした。少し待ってからお試しください。',
                          'error',
                        ),
                ],
              });
              return;
            }
            if (subcommand === 'list') {
              const result = await callIvrmGameAccounts(guildId, userId, { action: 'list' });
              await interaction.editReply({
                embeds: [
                  result.status !== 'ok'
                    ? buildGameAccountsErrorEmbed(result)
                    : result.action === 'list'
                      ? buildListEmbed(result)
                      : buildNoticeEmbed(
                          '処理できませんでした。少し待ってからお試しください。',
                          'error',
                        ),
                ],
              });
              return;
            }
            if (subcommand === 'score') {
              const gameCode = interaction.options.getString('game', true);
              if (!isShowcaseSupported(gameCode)) {
                await interaction.editReply({ embeds: [buildUnsupportedScoreEmbed(gameCode)] });
                return;
              }
              const result = await callIvrmGameAccounts(guildId, userId, {
                action: 'score',
                gameCode,
              });
              await interaction.editReply({
                embeds: [
                  result.status !== 'ok'
                    ? buildGameAccountsErrorEmbed(result)
                    : result.action === 'score'
                      ? buildScoreEmbed(result)
                      : buildNoticeEmbed(
                          '処理できませんでした。少し待ってからお試しください。',
                          'error',
                        ),
                ],
              });
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
          await handleGameAccountsUnlinkButton(
            context,
            args[0] as GameButtonInteraction | undefined,
          );
        },
      },
    ] as PluginEventHandler<GameAccountsConfig, unknown, PrismaClient>[];
  },
});
