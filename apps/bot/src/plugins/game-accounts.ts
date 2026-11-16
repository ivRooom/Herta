import {
  ActionRowBuilder,
  AttachmentBuilder,
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
import {
  callIvrmGameAccounts,
  type IvrmGameAccountsResult,
  type ShowcaseCharacterScore,
} from './game-accounts-ivrm.js';
import {
  buildGameAccountsErrorEmbed,
  buildLinkSuccessEmbed,
  buildListEmbed,
  buildNoticeEmbed,
  buildProgressEmbed,
  buildScoreCharacterEmbed,
  buildScoreEmbed,
  buildUnlinkCancelledEmbed,
  buildUnlinkConfirmEmbed,
  buildUnlinkSuccessEmbed,
  buildUnsupportedProgressEmbed,
  buildUnsupportedScoreEmbed,
  gameDefinition,
  gameName,
  isProgressSupported,
  isShowcaseSupported,
  scoreSwitcherCharacters,
  type GameEmbed,
} from './game-accounts-core.js';

const UNLINK_CUSTOM_ID_PREFIX = 'game-accounts:unlink:';
const SCORE_CUSTOM_ID_PREFIX = 'game-accounts:score:';

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
    files?: AttachmentBuilder[];
    /** Empty array clears attachments left over from a previous view. */
    attachments?: never[];
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

/** Discord caps an action row at 5 buttons; the switcher holds at most 6. */
const SCORE_BUTTONS_PER_ROW = 5;
const MAX_BUTTON_LABEL_CHARS = 80;

/**
 * Score switches whose API calls are in flight, keyed by guild and the
 * view owner's user id. A second press while one is running is rejected
 * instead of racing two edits of the same message.
 */
const pendingScoreSwitch = new Set<string>();

function buildScoreCustomId(userId: string, gameCode: string, characterId: string) {
  return `${SCORE_CUSTOM_ID_PREFIX}${userId}:${gameCode}:${characterId}`;
}

function parseScoreCustomId(
  customId: string,
): { userId: string; gameCode: string; characterId: string } | null {
  const parts = customId.slice(SCORE_CUSTOM_ID_PREFIX.length).split(':');
  if (parts.length !== 3) return null;
  const [userId, gameCode, characterId] = parts as [string, string, string];
  if (!/^\d{17,20}$/.test(userId) || !isKnownGameCode(gameCode)) return null;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(characterId)) return null;
  return { userId, gameCode, characterId };
}

function scoreButtonLabel(character: ShowcaseCharacterScore): string {
  const label = character.name ?? `キャラクターID ${character.id}`;
  if (label.length <= MAX_BUTTON_LABEL_CHARS) return label;
  return `${label.slice(0, MAX_BUTTON_LABEL_CHARS - 1)}…`;
}

function scoreSwitcherRows(
  userId: string,
  gameCode: string,
  characters: ShowcaseCharacterScore[],
  selectedId: string,
): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let index = 0; index < characters.length; index += SCORE_BUTTONS_PER_ROW) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const character of characters.slice(index, index + SCORE_BUTTONS_PER_ROW)) {
      const selected = character.id === selectedId;
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(buildScoreCustomId(userId, gameCode, character.id))
          .setLabel(scoreButtonLabel(character))
          .setStyle(selected ? ButtonStyle.Primary : ButtonStyle.Secondary)
          .setDisabled(selected),
      );
    }
    rows.push(row);
  }
  return rows;
}

export interface ScoreViewReply {
  embeds: GameEmbed[];
  components: ActionRowBuilder<ButtonBuilder>[];
  files?: AttachmentBuilder[];
}

type ScoreResult = Extract<IvrmGameAccountsResult, { status: 'ok'; action: 'score' }>;

/**
 * Builds the one-character score view (#1147 S3c): the selected
 * character's build-card PNG when the API renders one, with the
 * single-character text embed and the character switcher buttons in
 * both cases. Any card failure (unsupported game, no build, renderer
 * down) silently degrades to the text-only view; the buttons keep
 * working so another character may still produce a card. When no
 * character carries a score there is nothing to switch between, so
 * the classic all-characters embed is returned without buttons.
 * Exported for tests; the command and the button handler share it.
 */
export async function buildScoreViewReply(
  guildId: string,
  userId: string,
  result: ScoreResult,
  selectedId: string | undefined,
  callApi: typeof callIvrmGameAccounts = callIvrmGameAccounts,
): Promise<ScoreViewReply> {
  const characters = scoreSwitcherCharacters(result);
  if (characters.length === 0) return { embeds: [buildScoreEmbed(result)], components: [] };
  const selected = characters.find((character) => character.id === selectedId) ?? characters[0]!;
  const embed = buildScoreCharacterEmbed(result, selected.id) ?? buildScoreEmbed(result);
  const components = scoreSwitcherRows(userId, result.gameCode, characters, selected.id);
  try {
    const card = await callApi(guildId, userId, {
      action: 'card',
      gameCode: result.gameCode,
      characterId: selected.id,
    });
    if (card.status === 'ok' && card.action === 'card') {
      const png = card.cards.find((entry) => entry.characterId === selected.id) ?? card.cards[0];
      if (png) {
        return {
          embeds: [embed],
          components,
          files: [new AttachmentBuilder(png.png, { name: `game-card-${selected.id}.png` })],
        };
      }
    }
  } catch {
    // A failed card call is just the text view; never fail the score reply.
  }
  return { embeds: [embed], components };
}

/**
 * Handles the score character-switcher buttons. Exported for tests; the
 * plugin wires it through `interactionCreate` next to the unlink handler.
 *
 * The button carries only ids, so the handler re-reads the score (the
 * API serves the stored snapshot; nothing is fetched upstream) and
 * rebuilds the whole view for the pressed character. The score reply
 * is public (#923), so anyone in the channel may switch the view: the
 * ids in the button name the member whose showcase this is, and the
 * handler always re-reads THAT member's score — a presser can never
 * surface or affect their own data through someone else's buttons.
 * When the new view has no PNG, `attachments: []` clears the previous
 * card.
 */
export async function handleGameAccountsScoreButton(
  context: PluginRuntimeContext<GameAccountsConfig, unknown, PrismaClient>,
  interaction: GameButtonInteraction | undefined,
  callApi: typeof callIvrmGameAccounts = callIvrmGameAccounts,
): Promise<void> {
  if (!interaction?.isButton?.() || !interaction.customId?.startsWith(SCORE_CUSTOM_ID_PREFIX))
    return;
  if (!interaction.guildId || interaction.guildId !== context.guildId) return;
  const parsed = parseScoreCustomId(interaction.customId);
  if (!parsed) return;
  if (context.config.enabled === false) {
    await interaction.reply({
      content: 'ゲームアカウント連携Pluginは現在無効です。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const pendingKey = `${interaction.guildId}:${parsed.userId}`;
  if (pendingScoreSwitch.has(pendingKey)) {
    await interaction.reply({
      content: '表示を切り替え中です。完了するまでお待ちください。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  pendingScoreSwitch.add(pendingKey);
  try {
    await interaction.deferUpdate();
    // The view belongs to the member named in the button, whoever
    // pressed it: the re-read and the rebuilt buttons both use that id.
    const result = await callApi(interaction.guildId, parsed.userId, {
      action: 'score',
      gameCode: parsed.gameCode,
    });
    if (result.status !== 'ok') {
      await interaction.editReply({
        embeds: [buildGameAccountsErrorEmbed(result)],
        components: [],
        attachments: [],
      });
      return;
    }
    if (result.action !== 'score') {
      await interaction.editReply({
        embeds: [buildNoticeEmbed('処理できませんでした。少し待ってからお試しください。', 'error')],
        components: [],
        attachments: [],
      });
      return;
    }
    const view = await buildScoreViewReply(
      interaction.guildId,
      parsed.userId,
      result,
      parsed.characterId,
      callApi,
    );
    await interaction.editReply(
      view.files
        ? { embeds: view.embeds, components: view.components, files: view.files }
        : { embeds: view.embeds, components: view.components, attachments: [] },
    );
  } catch (error) {
    context.logger.error(
      { error: error instanceof Error ? error.name : 'UnknownError' },
      'Game accounts score switch failed',
    );
    await interaction.editReply({
      embeds: [
        buildNoticeEmbed('表示を切り替えられませんでした。少し待ってからお試しください。', 'error'),
      ],
      components: [],
      attachments: [],
    });
  } finally {
    pendingScoreSwitch.delete(pendingKey);
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
            // link registers the member's own UID, so it stays between
            // the member and the bot. list / score / progress are
            // showcases meant to be seen, so they post publicly (#923).
            await interaction.deferReply(
              subcommand === 'link' ? { flags: MessageFlags.Ephemeral } : {},
            );
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
              if (result.status !== 'ok') {
                await interaction.editReply({ embeds: [buildGameAccountsErrorEmbed(result)] });
                return;
              }
              if (result.action !== 'score') {
                await interaction.editReply({
                  embeds: [
                    buildNoticeEmbed(
                      '処理できませんでした。少し待ってからお試しください。',
                      'error',
                    ),
                  ],
                });
                return;
              }
              // One character at a time (#1147 S3c): the build-card PNG
              // when available, the single-character embed, and the
              // switcher buttons. Falls back to the classic embed when
              // no character carries a score.
              const view = await buildScoreViewReply(
                guildId,
                userId,
                result,
                undefined,
                callIvrmGameAccounts,
              );
              await interaction.editReply(view);
              return;
            }
            if (subcommand === 'progress') {
              const gameCode = interaction.options.getString('game', true);
              if (!isProgressSupported(gameCode)) {
                await interaction.editReply({ embeds: [buildUnsupportedProgressEmbed(gameCode)] });
                return;
              }
              const result = await callIvrmGameAccounts(guildId, userId, {
                action: 'progress',
                gameCode,
              });
              if (result.status === 'progress-unsupported') {
                await interaction.editReply({ embeds: [buildUnsupportedProgressEmbed(gameCode)] });
                return;
              }
              await interaction.editReply({
                embeds: [
                  result.status !== 'ok'
                    ? buildGameAccountsErrorEmbed(result)
                    : result.action === 'progress'
                      ? buildProgressEmbed(result)
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
          const interaction = args[0] as GameButtonInteraction | undefined;
          await handleGameAccountsUnlinkButton(context, interaction);
          await handleGameAccountsScoreButton(context, interaction);
        },
      },
    ] as PluginEventHandler<GameAccountsConfig, unknown, PrismaClient>[];
  },
});
