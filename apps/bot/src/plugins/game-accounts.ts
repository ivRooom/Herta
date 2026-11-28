import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
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
  type GameRankingAxis,
  type GameRankingFormula,
  type GameScoreFormula,
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
  buildRankingEmbed,
  buildUnsupportedProgressEmbed,
  buildUnsupportedScoreEmbed,
  formatJstDateTime,
  gameDefinition,
  gameName,
  isProgressSupported,
  isScoreFormula,
  isShowcaseSupported,
  RANKING_AXIS_OPTIONS,
  RANKING_DEFAULT_SELECTION,
  RANKING_FORMULA_OPTIONS,
  SCORE_DEFAULT_FORMULA,
  SCORE_FORMULA_OPTIONS,
  rankingCardRequestInput,
  rankingCharacterOptions,
  rankingRequestInput,
  rankingSlotOptions,
  scoreCardRequestInput,
  scoreSwitcherCharacters,
  type GameEmbed,
  type RankingSelection,
} from './game-accounts-core.js';
import {
  GENSHIN_PROGRESS_CARD_FILE_NAME,
  renderGenshinProgressCard,
} from './game-progress-card.js';
import {
  STARRAIL_PROGRESS_CARD_FILE_NAME,
  renderStarRailProgressCard,
} from './game-progress-starrail-card.js';

const UNLINK_CUSTOM_ID_PREFIX = 'game-accounts:unlink:';
const SCORE_CUSTOM_ID_PREFIX = 'game-accounts:score:';
const SCORE_FORMULA_CUSTOM_ID_PREFIX = 'game-accounts:score-formula:';

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
    components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] | never[];
  }): Promise<unknown>;
  deferUpdate(): Promise<unknown>;
  editReply(options: {
    embeds?: GameEmbed[];
    components?: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] | never[];
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

/**
 * The button id carries the current score formula (#1366 S3) next to
 * the character, so switching characters keeps the formula the viewer
 * picked. Messages posted before the formula existed have a 3-part
 * id; those still parse, with the default formula.
 */
function buildScoreCustomId(
  userId: string,
  gameCode: string,
  characterId: string,
  formula: GameScoreFormula,
) {
  return `${SCORE_CUSTOM_ID_PREFIX}${userId}:${gameCode}:${characterId}:${formula}`;
}

function parseScoreCustomId(
  customId: string,
): { userId: string; gameCode: string; characterId: string; formula: GameScoreFormula } | null {
  const parts = customId.slice(SCORE_CUSTOM_ID_PREFIX.length).split(':');
  if (parts.length !== 3 && parts.length !== 4) return null;
  const [userId, gameCode, characterId] = parts as [string, string, string];
  if (!/^\d{17,20}$/.test(userId) || !isKnownGameCode(gameCode)) return null;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(characterId)) return null;
  const formula = parts[3] ?? SCORE_DEFAULT_FORMULA;
  if (!isScoreFormula(formula)) return null;
  return { userId, gameCode, characterId, formula };
}

function buildScoreFormulaCustomId(
  userId: string,
  gameCode: string,
  characterId: string,
  formula: GameScoreFormula,
) {
  return `${SCORE_FORMULA_CUSTOM_ID_PREFIX}${userId}:${gameCode}:${characterId}:${formula}`;
}

function parseScoreFormulaCustomId(
  customId: string,
): { userId: string; gameCode: string; characterId: string; formula: GameScoreFormula } | null {
  const parts = customId.slice(SCORE_FORMULA_CUSTOM_ID_PREFIX.length).split(':');
  if (parts.length !== 4) return null;
  const [userId, gameCode, characterId, formula] = parts as [string, string, string, string];
  if (!/^\d{17,20}$/.test(userId) || !isKnownGameCode(gameCode)) return null;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(characterId)) return null;
  if (!isScoreFormula(formula)) return null;
  return { userId, gameCode, characterId, formula };
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
  formula: GameScoreFormula,
): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let index = 0; index < characters.length; index += SCORE_BUTTONS_PER_ROW) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const character of characters.slice(index, index + SCORE_BUTTONS_PER_ROW)) {
      const selected = character.id === selectedId;
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(buildScoreCustomId(userId, gameCode, character.id, formula))
          .setLabel(scoreButtonLabel(character))
          .setStyle(selected ? ButtonStyle.Primary : ButtonStyle.Secondary)
          .setDisabled(selected),
      );
    }
    rows.push(row);
  }
  return rows;
}

/**
 * The formula dropdown (#1366 S3) sits on its own row under the
 * character buttons: at most 2 button rows (6 characters, 5 per row)
 * plus this row stays well inside Discord's 5-row cap. The current
 * formula is the default option, and the id carries it too, so the
 * state survives in the message itself like the ranking dropdowns.
 */
function scoreFormulaSelectRow(
  userId: string,
  gameCode: string,
  characterId: string,
  formula: GameScoreFormula,
): ActionRowBuilder<StringSelectMenuBuilder> {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(buildScoreFormulaCustomId(userId, gameCode, characterId, formula))
    .setPlaceholder('スコアの計算方法')
    .addOptions(
      SCORE_FORMULA_OPTIONS.map((option) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(option.label)
          .setDescription(option.description)
          .setValue(option.value)
          .setDefault(option.value === formula),
      ),
    );
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

export interface ScoreViewReply {
  embeds: GameEmbed[];
  components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[];
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
 *
 * The formula (#1366 S3) selects which score the card renders and
 * which numbers the embed shows; the formula dropdown rides under
 * the character buttons so either control rebuilds the whole view.
 * Exported for tests; the command and the switch handlers share it.
 */
export async function buildScoreViewReply(
  guildId: string,
  userId: string,
  result: ScoreResult,
  selectedId: string | undefined,
  formula: GameScoreFormula = SCORE_DEFAULT_FORMULA,
  callApi: typeof callIvrmGameAccounts = callIvrmGameAccounts,
): Promise<ScoreViewReply> {
  const characters = scoreSwitcherCharacters(result);
  if (characters.length === 0) return { embeds: [buildScoreEmbed(result)], components: [] };
  const selected = characters.find((character) => character.id === selectedId) ?? characters[0]!;
  const embed = buildScoreCharacterEmbed(result, selected.id, formula) ?? buildScoreEmbed(result);
  const components: ScoreViewReply['components'] = [
    ...scoreSwitcherRows(userId, result.gameCode, characters, selected.id, formula),
    scoreFormulaSelectRow(userId, result.gameCode, selected.id, formula),
  ];
  try {
    const card = await callApi(
      guildId,
      userId,
      scoreCardRequestInput(result.gameCode, selected.id, formula),
    );
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
      parsed.formula,
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

interface GameScoreSelectInteraction {
  guildId: string | null;
  user: { id: string };
  customId?: string;
  values?: string[];
  isStringSelectMenu?(): boolean;
  reply(options: { content: string; flags: number }): Promise<unknown>;
  deferUpdate(): Promise<unknown>;
  followUp(options: { content: string; flags: number }): Promise<unknown>;
  editReply(options: {
    embeds?: GameEmbed[];
    components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[];
    files?: AttachmentBuilder[];
    /** Empty array clears attachments left over from a previous view. */
    attachments?: never[];
  }): Promise<unknown>;
}

/**
 * Handles the score formula dropdown (#1366 S3). Exported for tests;
 * the plugin wires it through `interactionCreate` next to the score
 * button handler.
 *
 * The score reply is public (#923), so anyone in the channel may
 * switch the formula — the same rule as the character buttons and
 * the ranking dropdowns. The custom id names the member whose
 * showcase this is plus the character on display; the re-read always
 * uses THAT member, and the new formula comes from the selected
 * value. The in-flight guard is shared with the character buttons
 * (same key), because both rebuild the same message.
 *
 * Failure handling follows the ranking dropdown: a failed re-read
 * leaves the public message untouched and tells only the presser
 * (ephemeral followUp). A failed card render is softer — the view
 * builder already degrades to the text view for the new formula.
 */
export async function handleGameAccountsScoreFormulaSelect(
  context: PluginRuntimeContext<GameAccountsConfig, unknown, PrismaClient>,
  interaction: GameScoreSelectInteraction | undefined,
  callApi: typeof callIvrmGameAccounts = callIvrmGameAccounts,
): Promise<void> {
  if (
    !interaction?.isStringSelectMenu?.() ||
    !interaction.customId?.startsWith(SCORE_FORMULA_CUSTOM_ID_PREFIX)
  )
    return;
  if (!interaction.guildId || interaction.guildId !== context.guildId) return;
  const parsed = parseScoreFormulaCustomId(interaction.customId);
  if (!parsed) return;
  if (context.config.enabled === false) {
    await interaction.reply({
      content: 'ゲームアカウント連携Pluginは現在無効です。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const rawFormula = interaction.values?.[0];
  if (!rawFormula || !isScoreFormula(rawFormula)) return;
  const formula: GameScoreFormula = rawFormula;
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
  } catch (error) {
    // The acknowledgement itself failed: there is no safe surface left
    // to report on, and the shared message must stay untouched.
    context.logger.error(
      { error: error instanceof Error ? error.name : 'UnknownError' },
      'Game accounts score formula switch acknowledgement failed',
    );
    pendingScoreSwitch.delete(pendingKey);
    return;
  }
  try {
    const result = await callApi(interaction.guildId, parsed.userId, {
      action: 'score',
      gameCode: parsed.gameCode,
    });
    if (result.status !== 'ok' || result.action !== 'score') {
      // A failed switch must not destroy the public view everyone is
      // looking at: leave the message as-is and tell only the presser.
      await interaction
        .followUp({
          content:
            result.status !== 'ok'
              ? 'スコアを取得できませんでした。少し待ってから再度お試しください。'
              : '処理できませんでした。少し待ってから再度お試しください。',
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => undefined);
      return;
    }
    const view = await buildScoreViewReply(
      interaction.guildId,
      parsed.userId,
      result,
      parsed.characterId,
      formula,
      callApi,
    );
    // When the new view has no PNG, `attachments: []` clears the
    // previous card (same pattern as the character buttons).
    await interaction.editReply(
      view.files
        ? { embeds: view.embeds, components: view.components, files: view.files }
        : { embeds: view.embeds, components: view.components, attachments: [] },
    );
  } catch (error) {
    context.logger.error(
      { error: error instanceof Error ? error.name : 'UnknownError' },
      'Game accounts score formula switch failed',
    );
    await interaction
      .followUp({
        content: '表示を切り替えられませんでした。少し待ってから再度お試しください。',
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => undefined);
  } finally {
    pendingScoreSwitch.delete(pendingKey);
  }
}

const RANKING_CUSTOM_ID_PREFIX = 'game-accounts:ranking:';

type RankingSelectKind = 'axis' | 'char' | 'formula' | 'slot';
const RANKING_SELECT_KINDS: readonly string[] = ['axis', 'char', 'formula', 'slot'];
const RANKING_AXES: readonly string[] = ['character', 'piece', 'formula'];
const RANKING_FORMULAS: readonly string[] = ['cv', 'rolls'];

interface GameSelectInteraction {
  guildId: string | null;
  user: { id: string };
  customId?: string;
  values?: string[];
  isStringSelectMenu?(): boolean;
  reply(options: { content: string; flags: number }): Promise<unknown>;
  deferUpdate(): Promise<unknown>;
  followUp(options: { content: string; flags: number }): Promise<unknown>;
  editReply(options: {
    embeds?: GameEmbed[];
    components: ActionRowBuilder<StringSelectMenuBuilder>[];
    files?: AttachmentBuilder[];
    /** Empty array clears attachments left over from a previous view. */
    attachments?: never[];
  }): Promise<unknown>;
}

/**
 * Ranking switches whose API calls are in flight, keyed by guild and the
 * view owner's user id (same pattern as the score switcher).
 */
const pendingRankingSwitch = new Set<string>();

/**
 * The custom id carries the selection dimensions that survive a switch:
 * the kind being changed, the view owner, the game, and the axis /
 * formula pair. The axis-specific filter (character / slot) is NOT
 * carried: each axis has exactly one filter kind, so switching the
 * axis resets the filter — and the formula too, since it only has
 * meaning under the formula axis. That keeps the id short and the
 * state unambiguous.
 */
function buildRankingCustomId(
  kind: RankingSelectKind,
  userId: string,
  gameCode: string,
  selection: RankingSelection,
) {
  return `${RANKING_CUSTOM_ID_PREFIX}${kind}:${userId}:${gameCode}:${selection.axis}:${selection.formula}`;
}

function parseRankingCustomId(customId: string): {
  kind: RankingSelectKind;
  userId: string;
  gameCode: string;
  axis: GameRankingAxis;
  formula: GameRankingFormula;
} | null {
  const parts = customId.slice(RANKING_CUSTOM_ID_PREFIX.length).split(':');
  if (parts.length !== 5) return null;
  const [kind, userId, gameCode, axis, formula] = parts as [string, string, string, string, string];
  if (!RANKING_SELECT_KINDS.includes(kind)) return null;
  if (!/^\d{17,20}$/.test(userId) || !isKnownGameCode(gameCode)) return null;
  if (!RANKING_AXES.includes(axis) || !RANKING_FORMULAS.includes(formula)) return null;
  return {
    kind: kind as RankingSelectKind,
    userId,
    gameCode,
    axis: axis as GameRankingAxis,
    formula: formula as GameRankingFormula,
  };
}

type RankingResult = Extract<IvrmGameAccountsResult, { status: 'ok'; action: 'ranking' }>;

function rankingSelectRow(
  kind: RankingSelectKind,
  userId: string,
  result: RankingResult,
  selection: RankingSelection,
  placeholder: string,
  options: { value: string; label: string; description?: string }[],
  selectedValue: string,
): ActionRowBuilder<StringSelectMenuBuilder> {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(buildRankingCustomId(kind, userId, result.gameCode, selection))
    .setPlaceholder(placeholder)
    .addOptions(
      options.map((option) => {
        // Discord caps option labels and descriptions at 100 characters;
        // the values (ids and keys) stay untouched.
        const builder = new StringSelectMenuOptionBuilder()
          .setLabel(option.label.length > 100 ? `${option.label.slice(0, 99)}…` : option.label)
          .setValue(option.value === '' ? '__all__' : option.value)
          .setDefault(option.value === selectedValue);
        if (option.description)
          builder.setDescription(
            option.description.length > 100
              ? `${option.description.slice(0, 99)}…`
              : option.description,
          );
        return builder;
      }),
    );
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

/**
 * The ranking view: the embed plus the dropdown rows (#1196 R3,
 * Kanata's request). Row 1 always switches the axis; row 2 is the
 * axis-specific filter (character / formula / slot). An empty option
 * value travels as "__all__" because Discord rejects empty values.
 */
export function buildRankingView(
  userId: string,
  result: RankingResult,
  selection: RankingSelection,
): {
  embeds: GameEmbed[];
  components: ActionRowBuilder<StringSelectMenuBuilder>[];
} {
  const components = [
    rankingSelectRow(
      'axis',
      userId,
      result,
      selection,
      'ランキングの種類',
      RANKING_AXIS_OPTIONS.map((option) => ({
        value: option.value,
        label: option.label,
        description: option.description,
      })),
      selection.axis,
    ),
  ];
  if (selection.axis === 'character' && result.availableCharacters.length > 0) {
    components.push(
      rankingSelectRow(
        'char',
        userId,
        result,
        selection,
        'キャラクターで絞り込み',
        rankingCharacterOptions(result),
        selection.characterId ?? '',
      ),
    );
  } else if (selection.axis === 'formula') {
    components.push(
      rankingSelectRow(
        'formula',
        userId,
        result,
        selection,
        '計算式',
        RANKING_FORMULA_OPTIONS.map((option) => ({
          value: option.value,
          label: option.label,
          description: option.description,
        })),
        selection.formula,
      ),
    );
  } else if (selection.axis === 'piece' && result.availableSlots.length > 0) {
    components.push(
      rankingSelectRow(
        'slot',
        userId,
        result,
        selection,
        '部位で絞り込み',
        rankingSlotOptions(result),
        selection.slot ?? '',
      ),
    );
  }
  return { embeds: [buildRankingEmbed(result, selection)], components };
}

export interface RankingViewReply {
  embeds: GameEmbed[];
  components: ActionRowBuilder<StringSelectMenuBuilder>[];
  files?: AttachmentBuilder[];
}

/**
 * Builds the ranking view with its image card (#1402 S3): the same
 * selection's ranking rendered as a PNG when the API renders one,
 * with the text embed and the dropdowns in both cases. Any card
 * failure (empty ranking, renderer down) silently degrades to the
 * text-only view; the dropdowns keep working so another selection
 * may still produce a card. Exported for tests; the command and the
 * select handler share it.
 */
export async function buildRankingViewReply(
  guildId: string,
  userId: string,
  result: RankingResult,
  selection: RankingSelection,
  callApi: typeof callIvrmGameAccounts = callIvrmGameAccounts,
): Promise<RankingViewReply> {
  const view = buildRankingView(userId, result, selection);
  try {
    const card = await callApi(
      guildId,
      userId,
      rankingCardRequestInput(result.gameCode, selection),
    );
    if (card.status === 'ok' && card.action === 'ranking_card') {
      return {
        ...view,
        files: [new AttachmentBuilder(card.png, { name: 'ranking-card.png' })],
      };
    }
  } catch {
    // A failed card call is just the text view; never fail the ranking reply.
  }
  return view;
}

export interface ProgressViewReply {
  content?: string;
  embeds: GameEmbed[];
  files?: AttachmentBuilder[];
}

/**
 * Builds the progress reply (#1010, #1079): for Genshin or Star Rail
 * with a stored snapshot, the reply is the generated image card plus
 * a short caption; every other case (no snapshot yet, non-ok results)
 * keeps the text embed. A card render failure silently degrades to
 * the text embed, exactly like the ranking card.
 * Exported for tests.
 */
export async function buildProgressViewReply(
  result: IvrmGameAccountsResult,
  renderCard: typeof renderGenshinProgressCard = renderGenshinProgressCard,
  renderStarRailCard: typeof renderStarRailProgressCard = renderStarRailProgressCard,
): Promise<ProgressViewReply> {
  if (result.status !== 'ok') {
    return { embeds: [buildGameAccountsErrorEmbed(result)] };
  }
  if (result.action !== 'progress') {
    return {
      embeds: [buildNoticeEmbed('処理できませんでした。少し待ってからお試しください。', 'error')],
    };
  }
  if (result.gameCode === 'genshin' && result.hasProgress && result.progress) {
    try {
      const png = await renderCard({
        snapshot: result.progress,
        uid: result.uid,
        fetchedAtLabel: formatJstDateTime(result.succeededAt ?? result.fetchedAt),
      });
      return {
        content: `🗺️ ${gameName(result.gameCode)}の探索度`,
        embeds: [],
        files: [new AttachmentBuilder(png, { name: GENSHIN_PROGRESS_CARD_FILE_NAME })],
      };
    } catch {
      // A failed render is just the text view; never fail the progress reply.
    }
  }
  if (result.gameCode === 'starrail' && result.hasProgress && result.progress) {
    try {
      const png = await renderStarRailCard({
        snapshot: result.progress,
        uid: result.uid,
        fetchedAtLabel: formatJstDateTime(result.succeededAt ?? result.fetchedAt),
      });
      return {
        content: `🗺️ ${gameName(result.gameCode)}の戦績`,
        embeds: [],
        files: [new AttachmentBuilder(png, { name: STARRAIL_PROGRESS_CARD_FILE_NAME })],
      };
    } catch {
      // A failed render is just the text view; never fail the progress reply.
    }
  }
  return { embeds: [buildProgressEmbed(result)] };
}

function nextRankingSelection(
  parsed: {
    kind: RankingSelectKind;
    axis: GameRankingAxis;
    formula: GameRankingFormula;
  },
  rawValue: string | undefined,
): RankingSelection | null {
  const value = rawValue === '__all__' ? '' : rawValue;
  if (value === undefined) return null;
  switch (parsed.kind) {
    case 'axis':
      if (!RANKING_AXES.includes(value)) return null;
      return {
        axis: value as GameRankingAxis,
        characterId: null,
        slot: null,
        // The formula only has meaning under the formula axis, so an
        // axis switch resets it together with the filter.
        formula: RANKING_DEFAULT_SELECTION.formula,
      };
    case 'char':
      if (value !== '' && !/^[A-Za-z0-9_-]{1,64}$/.test(value)) return null;
      return {
        axis: 'character',
        characterId: value === '' ? null : value,
        slot: null,
        formula: parsed.formula,
      };
    case 'formula':
      if (!RANKING_FORMULAS.includes(value)) return null;
      return {
        axis: 'formula',
        characterId: null,
        slot: null,
        formula: value as GameRankingFormula,
      };
    case 'slot':
      if (value !== '' && !/^[A-Za-z0-9_-]{1,64}$/.test(value)) return null;
      return {
        axis: 'piece',
        characterId: null,
        slot: value === '' ? null : value,
        formula: parsed.formula,
      };
  }
}

/**
 * Handles the ranking dropdowns. Exported for tests; the plugin wires
 * it through `interactionCreate` next to the button handlers.
 *
 * The ranking reply is public (#923), so anyone in the channel may
 * switch the view — the same rule as the score switcher buttons. The
 * custom id names the member who opened the ranking; the re-read
 * always uses THAT member as the viewer (their selfEntries are what
 * the message shows), so a presser can never surface their own data
 * through someone else's message.
 */
export async function handleGameAccountsRankingSelect(
  context: PluginRuntimeContext<GameAccountsConfig, unknown, PrismaClient>,
  interaction: GameSelectInteraction | undefined,
  callApi: typeof callIvrmGameAccounts = callIvrmGameAccounts,
): Promise<void> {
  if (
    !interaction?.isStringSelectMenu?.() ||
    !interaction.customId?.startsWith(RANKING_CUSTOM_ID_PREFIX)
  )
    return;
  if (!interaction.guildId || interaction.guildId !== context.guildId) return;
  const parsed = parseRankingCustomId(interaction.customId);
  if (!parsed) return;
  if (context.config.enabled === false) {
    await interaction.reply({
      content: 'ゲームアカウント連携Pluginは現在無効です。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const selection = nextRankingSelection(parsed, interaction.values?.[0]);
  if (!selection) return;
  const pendingKey = `${interaction.guildId}:${parsed.userId}`;
  if (pendingRankingSwitch.has(pendingKey)) {
    await interaction.reply({
      content: '表示を切り替え中です。完了するまでお待ちください。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  pendingRankingSwitch.add(pendingKey);
  try {
    await interaction.deferUpdate();
  } catch (error) {
    // The acknowledgement itself failed: there is no safe surface left
    // to report on, and the shared message must stay untouched.
    context.logger.error(
      { error: error instanceof Error ? error.name : 'UnknownError' },
      'Game accounts ranking switch acknowledgement failed',
    );
    pendingRankingSwitch.delete(pendingKey);
    return;
  }
  try {
    const result = await callApi(
      interaction.guildId,
      parsed.userId,
      rankingRequestInput(parsed.gameCode, selection),
    );
    if (result.status !== 'ok' || result.action !== 'ranking') {
      // A failed switch must not destroy the public view everyone is
      // looking at: leave the message as-is and tell only the presser.
      await interaction
        .followUp({
          content:
            result.status !== 'ok'
              ? 'ランキングを取得できませんでした。少し待ってから再度お試しください。'
              : '処理できませんでした。少し待ってから再度お試しください。',
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => undefined);
      return;
    }
    const view = await buildRankingViewReply(
      interaction.guildId,
      parsed.userId,
      result,
      selection,
      callApi,
    );
    // When the new view has no PNG, `attachments: []` clears the
    // previous card (same pattern as the score switcher).
    await interaction.editReply(
      view.files
        ? { embeds: view.embeds, components: view.components, files: view.files }
        : { embeds: view.embeds, components: view.components, attachments: [] },
    );
  } catch (error) {
    context.logger.error(
      { error: error instanceof Error ? error.name : 'UnknownError' },
      'Game accounts ranking switch failed',
    );
    await interaction
      .followUp({
        content: '表示を切り替えられませんでした。少し待ってから再度お試しください。',
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => undefined);
  } finally {
    pendingRankingSwitch.delete(pendingKey);
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
              // no character carries a score. The formula starts at
              // the default; the dropdown in the view switches it
              // (#1366 S3).
              const view = await buildScoreViewReply(
                guildId,
                userId,
                result,
                undefined,
                SCORE_DEFAULT_FORMULA,
                callIvrmGameAccounts,
              );
              await interaction.editReply(view);
              return;
            }
            if (subcommand === 'ranking') {
              const gameCode = interaction.options.getString('game', true);
              const axisOption = interaction.options.getString('axis');
              const selection: RankingSelection = {
                ...RANKING_DEFAULT_SELECTION,
                axis: axisOption === 'piece' || axisOption === 'formula' ? axisOption : 'character',
              };
              const result = await callIvrmGameAccounts(
                guildId,
                userId,
                rankingRequestInput(gameCode, selection),
              );
              if (result.status !== 'ok') {
                await interaction.editReply({ embeds: [buildGameAccountsErrorEmbed(result)] });
                return;
              }
              if (result.action !== 'ranking') {
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
              // Ranking as an image card (#1402 S3): the PNG when
              // available, the text embed and the dropdowns in both
              // cases. Falls back to the text view when the card
              // cannot be rendered.
              const view = await buildRankingViewReply(
                guildId,
                userId,
                result,
                selection,
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
              const view = await buildProgressViewReply(result);
              await interaction.editReply(
                view.files
                  ? { content: view.content, embeds: view.embeds, files: view.files }
                  : { embeds: view.embeds },
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
          await handleGameAccountsUnlinkButton(context, interaction);
          await handleGameAccountsScoreButton(context, interaction);
          await handleGameAccountsScoreFormulaSelect(
            context,
            args[0] as GameScoreSelectInteraction | undefined,
          );
          await handleGameAccountsRankingSelect(
            context,
            args[0] as GameSelectInteraction | undefined,
          );
        },
      },
    ] as PluginEventHandler<GameAccountsConfig, unknown, PrismaClient>[];
  },
});
