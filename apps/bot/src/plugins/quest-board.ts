import {
  ActionRowBuilder,
  AttachmentBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { PrismaClient } from '@herta/db';
import { questBoardManifest } from '@herta/plugin-catalog';
import {
  definePlugin,
  type PluginEventHandler,
  type PluginRuntimeContext,
} from '@herta/plugin-sdk';
import {
  callIvrmQuestBoard,
  callIvrmQuestBoardCard,
  type IvrmQuestBoardResult,
  type QuestBoardPeriodType,
  type QuestBoardStatus,
} from './quest-board-ivrm.js';
import {
  buildQuestBoardCardEmbed,
  buildQuestBoardEmbed,
  buildQuestBoardErrorEmbed,
  buildQuestBoardPeriodSelect,
  formatQuestBoardError,
  isQuestBoardPeriodType,
  parseQuestBoardPeriodCustomId,
  questBoardCardFileName,
  QUEST_BOARD_PERIOD_CUSTOM_ID_PREFIX,
  type QuestBoardEmbed,
} from './quest-board-core.js';

const inFlight = new Set<string>();

/**
 * Period switches whose API calls are in flight, keyed by guild and the
 * view owner's user id. A second press while one is running is rejected
 * instead of racing two edits of the same message.
 */
const pendingPeriodSwitch = new Set<string>();

interface QuestBoardConfig {
  enabled: boolean;
}

function periodSelectRow(
  userId: string,
  current: QuestBoardPeriodType,
): ActionRowBuilder<StringSelectMenuBuilder> {
  const data = buildQuestBoardPeriodSelect(userId, current);
  const menu = new StringSelectMenuBuilder()
    .setCustomId(data.customId)
    .setPlaceholder(data.placeholder)
    .addOptions(
      data.options.map((option) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(option.label)
          .setDescription(option.description)
          .setValue(option.value)
          .setDefault(option.default),
      ),
    );
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

export interface QuestBoardView {
  embeds: QuestBoardEmbed[];
  components: ActionRowBuilder<StringSelectMenuBuilder>[];
  files: AttachmentBuilder[];
  /**
   * Present (and empty) only in the Embed fallback view: switching
   * periods away from a card view must drop the previous period's
   * attachment, and an empty attachments list is what clears it.
   */
  attachments?: [];
}

/**
 * Builds the one-period board view: the period switcher dropdown
 * plus either the image card with its companion embed (Q3, the
 * main display) or — when no card PNG is given — the full Embed
 * view from Q2. Exported for tests; the command and the select
 * handler share it.
 */
export function buildQuestBoardView(
  userId: string,
  board: QuestBoardStatus,
  periodType: QuestBoardPeriodType,
  cardPng: Buffer | null = null,
): QuestBoardView {
  const components = [periodSelectRow(userId, periodType)];
  if (cardPng) {
    return {
      embeds: [buildQuestBoardCardEmbed(board, periodType)],
      components,
      files: [new AttachmentBuilder(cardPng, { name: questBoardCardFileName(periodType) })],
    };
  }
  return {
    embeds: [buildQuestBoardEmbed(board, periodType)],
    components,
    files: [],
    attachments: [],
  };
}

type QuestBoardViewResult =
  | { kind: 'view'; view: QuestBoardView }
  | { kind: 'error'; result: Exclude<IvrmQuestBoardResult, { status: 'ok' }> };

/**
 * Reads the board and builds the view for one period. The status
 * call owns the error branching (not linked, disabled, …); the
 * card call is fail-soft — any failure (renderer unavailable,
 * network, malformed payload) keeps the Embed view instead of
 * failing the command.
 */
export async function fetchQuestBoardView(
  guildId: string,
  userId: string,
  periodType: QuestBoardPeriodType,
  callApi: typeof callIvrmQuestBoard = callIvrmQuestBoard,
  callCard: typeof callIvrmQuestBoardCard = callIvrmQuestBoardCard,
): Promise<QuestBoardViewResult> {
  const result = await callApi(guildId, userId);
  if (result.status !== 'ok') return { kind: 'error', result };
  let png: Buffer | null = null;
  try {
    const card = await callCard(guildId, userId, periodType);
    if (card.status === 'ok') png = card.png;
  } catch {
    png = null;
  }
  return { kind: 'view', view: buildQuestBoardView(userId, result.board, periodType, png) };
}

interface QuestBoardSelectInteraction {
  guildId: string | null;
  user: { id: string };
  customId?: string;
  values?: string[];
  isStringSelectMenu?(): boolean;
  reply(options: { content: string; flags: number }): Promise<unknown>;
  deferUpdate(): Promise<unknown>;
  followUp(options: { content: string; flags: number }): Promise<unknown>;
  editReply(options: {
    embeds?: QuestBoardEmbed[];
    components: ActionRowBuilder<StringSelectMenuBuilder>[];
    files?: AttachmentBuilder[];
    attachments?: readonly never[];
  }): Promise<unknown>;
}

/**
 * Handles the period switcher dropdown. Exported for tests; the plugin
 * wires it through `interactionCreate` unchanged.
 *
 * The reply is ephemeral and personal (Kanata's decision for #946), so
 * unlike the public /game switchers only the member who ran the
 * command may switch: the custom id names that member, and anyone
 * else's press is rejected. The handler re-reads the board (progress
 * is derived server-side at read time) and rebuilds the whole view
 * for the selected period. A failed re-read leaves the message
 * untouched and tells only the presser via an ephemeral followUp.
 */
export async function handleQuestBoardPeriodSelect(
  context: PluginRuntimeContext<QuestBoardConfig, unknown, PrismaClient>,
  interaction: QuestBoardSelectInteraction | undefined,
  callApi: typeof callIvrmQuestBoard = callIvrmQuestBoard,
  callCard: typeof callIvrmQuestBoardCard = callIvrmQuestBoardCard,
): Promise<void> {
  if (
    !interaction?.isStringSelectMenu?.() ||
    !interaction.customId?.startsWith(QUEST_BOARD_PERIOD_CUSTOM_ID_PREFIX)
  )
    return;
  if (!interaction.guildId || interaction.guildId !== context.guildId) return;
  const parsed = parseQuestBoardPeriodCustomId(interaction.customId);
  if (!parsed) return;
  if (parsed.userId !== interaction.user.id) {
    await interaction.reply({
      content: 'この切替メニューは、コマンドを実行した本人だけが使えます。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (context.config.enabled === false) {
    await interaction.reply({
      content: 'クエストボードPluginは現在無効です。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const rawPeriod = interaction.values?.[0];
  if (!rawPeriod || !isQuestBoardPeriodType(rawPeriod)) return;
  const periodType: QuestBoardPeriodType = rawPeriod;
  const pendingKey = `${interaction.guildId}:${parsed.userId}`;
  if (pendingPeriodSwitch.has(pendingKey)) {
    await interaction.reply({
      content: '表示を切り替え中です。完了するまでお待ちください。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  pendingPeriodSwitch.add(pendingKey);
  try {
    await interaction.deferUpdate();
  } catch (error) {
    // The acknowledgement itself failed: there is no safe surface left
    // to report on, and the message must stay untouched.
    context.logger.error(
      { error: error instanceof Error ? error.name : 'UnknownError' },
      'Quest board period switch acknowledgement failed',
    );
    pendingPeriodSwitch.delete(pendingKey);
    return;
  }
  try {
    const fetched = await fetchQuestBoardView(
      interaction.guildId,
      parsed.userId,
      periodType,
      callApi,
      callCard,
    );
    if (fetched.kind === 'error') {
      // A failed switch must not destroy the view: leave the message
      // as-is and tell only the presser.
      await interaction
        .followUp({ content: formatQuestBoardError(fetched.result), flags: MessageFlags.Ephemeral })
        .catch(() => undefined);
      return;
    }
    await interaction.editReply(fetched.view);
  } catch (error) {
    context.logger.error(
      { error: error instanceof Error ? error.name : 'UnknownError' },
      'Quest board period switch failed',
    );
    await interaction
      .followUp({
        content: '表示を切り替えられませんでした。少し待ってから再度お試しください。',
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => undefined);
  } finally {
    pendingPeriodSwitch.delete(pendingKey);
  }
}

export const questBoardPlugin = definePlugin<QuestBoardConfig, unknown, PrismaClient>({
  manifest: questBoardManifest,
  provideCommands(context) {
    return [
      {
        definition: questBoardManifest.commands[0]!,
        async execute(interaction: ChatInputCommandInteraction) {
          const guildId = interaction.guildId;
          if (!guildId || context.config.enabled === false) {
            await interaction.reply({
              content: 'サーバー内でクエストボードPluginを有効にして利用してください。',
              flags: MessageFlags.Ephemeral,
            });
            return;
          }
          const userId = interaction.user.id;
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
            // The board is the member's own progress, so the reply
            // stays between the member and the bot (ephemeral).
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const subcommand = interaction.options.getSubcommand();
            if (!isQuestBoardPeriodType(subcommand)) {
              await interaction.editReply('不明な操作です。');
              return;
            }
            const fetched = await fetchQuestBoardView(guildId, userId, subcommand);
            if (fetched.kind === 'error') {
              await interaction.editReply({
                embeds: [buildQuestBoardErrorEmbed(fetched.result)],
              });
              return;
            }
            await interaction.editReply(fetched.view);
          } catch (error) {
            // Never include member values in logs or error replies.
            context.logger.error(
              { error: error instanceof Error ? error.name : 'UnknownError' },
              'Quest board command failed',
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
          await handleQuestBoardPeriodSelect(
            context,
            args[0] as QuestBoardSelectInteraction | undefined,
          );
        },
      },
    ] as PluginEventHandler<QuestBoardConfig, unknown, PrismaClient>[];
  },
});
