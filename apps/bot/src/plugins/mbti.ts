import { randomUUID } from 'node:crypto';
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type GuildMember,
} from 'discord.js';
import type { PrismaClient } from '@herta/db';
import { createMbtiWebQuizSession, recordMbtiQuizCompletion } from '@herta/db';
import type { Logger } from '@herta/logger';
import { MBTI_TYPE_KEYS, mbtiManifest, mbtiRoleConfigKey } from '@herta/plugin-catalog';
import { definePlugin, type CommandHandler } from '@herta/plugin-sdk';
import {
  MBTI_AXES,
  MBTI_IDENTITY_INFO,
  MBTI_LIKERT_ANSWERS,
  MBTI_TYPES,
  computeMbtiAxisPercent,
  computeMbtiIdentity,
  computeMbtiType,
  createEmptyMbtiScores,
  isMbtiLikertAnswer,
  mbtiLikertLabel,
  scoreMbtiAnswer,
  selectMbtiQuestions,
  toLegacyMbtiAnswers,
  type MbtiQuestion,
  type MbtiScores,
  type MbtiSessionAnswer,
} from '@herta/shared/mbti-core';
import { pushMbtiResultToIvrmWeb, resolveMbtiIvrmSyncConfig } from '@herta/shared/mbti-ivrm-sync';
import { syncAchievementUnlocks } from './achievements-repository.js';
import {
  renderMbtiQuestionCard,
  renderMbtiResultCard,
  type MbtiQuestionCardInput,
} from './mbti-card.js';
import { reconcileMbtiRole } from './mbti-roles.js';

const PREFIX = 'herta:mbti:v1:';
// 62問を5段階で回答するため、以前の12問2択より長時間を要する。1問あたりidleで
// タイムアウトをリセットしつつ、全体には上限(absolute time)を設ける。
const QUESTION_IDLE_MS = 3 * 60 * 1000;
const SESSION_ABSOLUTE_TIMEOUT_MS = 30 * 60 * 1000;

export interface MbtiPluginConfig {
  enabled: boolean;
  /** MBTIタイプ(例: 'INTJ')ごとに付与するRole ID。未設定タイプはnull。 */
  mbtiRoles: Record<string, string | null>;
}

const DISCORD_ID_PATTERN = /^\d{17,20}$/;

function nullableDiscordId(value: unknown): string | null {
  return typeof value === 'string' && DISCORD_ID_PATTERN.test(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readMbtiRoleMap(source: Record<string, unknown>): Record<string, string | null> {
  return Object.fromEntries(
    MBTI_TYPE_KEYS.map((type) => [type, nullableDiscordId(source[mbtiRoleConfigKey(type)])]),
  );
}

export function normalizeMbtiConfig(value: unknown): MbtiPluginConfig {
  const source = isRecord(value) ? value : {};
  return {
    enabled: source.enabled === undefined ? true : source.enabled === true,
    mbtiRoles: readMbtiRoleMap(source),
  };
}

export const mbtiPlugin = definePlugin<MbtiPluginConfig, unknown, PrismaClient>({
  manifest: mbtiManifest,
  async onDisable(context) {
    clearMbtiGuildSessions(context.guildId);
  },
  provideCommands(context) {
    return [
      createMbtiCommandHandler(mbtiManifest.commands[0]!, {
        logger: context.logger,
        prisma: context.prisma,
        getRoleMap: () => normalizeMbtiConfig(context.config).mbtiRoles,
        isEnabled: () => normalizeMbtiConfig(context.config).enabled,
        unlockCompletionAchievement: (userId: string) =>
          syncAchievementUnlocks(context.prisma, context.guildId, userId, [
            MBTI_COMPLETION_ACHIEVEMENT_ID,
          ]),
      }),
    ];
  },
});

/** Achievementカタログ(packages/shared/src/achievement-catalog.ts)のID。metric/targetを持たない手動解除。 */
const MBTI_COMPLETION_ACHIEVEMENT_ID = 'personality-explorer';

export interface MbtiCommandOptions {
  logger: Logger;
  prisma: PrismaClient;
  getRoleMap: () => Record<string, string | null>;
  isEnabled: () => boolean;
  /** 診断完了時に一回限りのAchievementを解除する(Community Pointsの加点要素)。再診断時は既存解除のため無視される。 */
  unlockCompletionAchievement: (userId: string) => Promise<string[]>;
}

interface MbtiSession {
  id: string;
  guildId: string;
  userId: string;
  /** 人ごとにselectMbtiQuestions()で抽出・シャッフルした、この診断で出題する設問一覧。 */
  questions: MbtiQuestion[];
  questionIndex: number;
  scores: MbtiScores;
  answers: MbtiSessionAnswer[];
  /**
   * questionsと同じ並びで、セッション開始時に全問分まとめて起動しておくSVG→PNG生成Promise。
   * 1問ずつボタン操作のたびに同期的にrenderしていると、回答から次の質問表示までの体感遅延の
   * 主因になる(sharpでのPNG生成+添付ファイル構築がinteraction.update()をブロックする)ため、
   * ユーザーが前の質問を読んで回答している間にバックグラウンドで次の画像を用意しておく。
   * 最初の1問目だけはこの配列の完成を待つ(以前と同じ体感速度)。
   */
  cardRenders: Promise<Buffer>[];
}

const sessions = new Map<string, MbtiSession>();

export function clearMbtiGuildSessions(guildId: string): void {
  for (const session of sessions.values()) {
    if (session.guildId === guildId) sessions.delete(session.id);
  }
}

export function createMbtiCommandHandler(
  definition: CommandHandler<ChatInputCommandInteraction>['definition'],
  options: MbtiCommandOptions,
): CommandHandler<ChatInputCommandInteraction> {
  return {
    definition,
    async execute(interaction) {
      await startMbtiQuiz(interaction, options);
    },
  };
}

async function startMbtiQuiz(
  interaction: ChatInputCommandInteraction,
  options: MbtiCommandOptions,
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({
      content: 'サーバー内でのみ利用できます。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (!options.isEnabled()) {
    await interaction.reply({
      content: 'MBTI Pluginは現在無効です。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (interaction.options.getString('method') === 'web') {
    await startMbtiWebQuiz(interaction, options);
    return;
  }

  const questions = selectMbtiQuestions();
  const session: MbtiSession = {
    id: randomUUID().replaceAll('-', ''),
    guildId: interaction.guildId,
    userId: interaction.user.id,
    questions,
    questionIndex: 0,
    scores: createEmptyMbtiScores(),
    answers: [],
    cardRenders: questions.map((question, index) =>
      startMbtiCardRender({
        questionIndex: index,
        totalQuestions: questions.length,
        prompt: question.prompt,
        axis: question.axis,
      }),
    ),
  };
  sessions.set(session.id, session);

  await interaction.reply({
    ...(await buildQuestionPayload(session)),
    components: [buildAnswerRow(session)],
    flags: MessageFlags.Ephemeral,
  });

  const message = await interaction.fetchReply();
  const collector = message.createMessageComponentCollector({
    componentType: ComponentType.Button,
    idle: QUESTION_IDLE_MS,
    time: SESSION_ABSOLUTE_TIMEOUT_MS,
  });

  collector.on('collect', (button) => {
    void handleMbtiButton(button, session, options).then((completed) => {
      if (completed) collector.stop('completed');
    });
  });

  collector.on('end', (_collected, reason) => {
    if (reason === 'completed' || sessions.get(session.id) !== session) return;
    sessions.delete(session.id);
    void interaction
      .editReply({
        content: '⌛ 時間切れのため診断を終了しました。もう一度 `/mbti` を実行してください。',
        embeds: [],
        components: [],
        files: [],
        attachments: [],
      })
      .catch(() => undefined);
  });
}

/**
 * Discordのボタン操作の代わりに、ブラウザで回答できる専用URLを発行する。
 * インメモリのMbtiSession・Collectorは作らず、DB上のMbtiWebQuizSessionへ委ねる
 * (回答・結果計算・Role付与はapps/studio側のAPI routeとBotの内部APIが担う)。
 */
async function startMbtiWebQuiz(
  interaction: ChatInputCommandInteraction,
  options: MbtiCommandOptions,
): Promise<void> {
  const baseUrl = process.env['STUDIO_PUBLIC_BASE_URL']?.trim();
  if (!baseUrl) {
    await interaction.reply({
      content:
        'Webブラウザでの回答機能は現在利用できません。`/mbti` をオプション無しで実行し、Discord上で回答してください。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const questions = selectMbtiQuestions();
  const { id, expiresAt } = await createMbtiWebQuizSession(options.prisma, {
    guildId: interaction.guildId!,
    discordUserId: interaction.user.id,
    questions,
  });

  const url = `${baseUrl.replace(/\/+$/, '')}/mbti/${id}`;
  const expiresInMinutes = Math.max(1, Math.round((expiresAt.getTime() - Date.now()) / 60_000));
  await interaction.reply({
    content: [
      'こちらのリンクからブラウザでMBTI診断に回答できます。',
      url,
      `(有効期限: 約${expiresInMinutes}分、1回のみ使用できます)`,
    ].join('\n'),
    flags: MessageFlags.Ephemeral,
  });
}

async function handleMbtiButton(
  interaction: ButtonInteraction,
  session: MbtiSession,
  options: MbtiCommandOptions,
): Promise<boolean> {
  const parsed = parseCustomId(interaction.customId);
  if (!parsed || parsed.sessionId !== session.id) return false;

  if (interaction.user.id !== session.userId) {
    await interaction.reply({
      content: 'この診断は開始した本人だけ操作できます。',
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }
  if (sessions.get(session.id) !== session) return false;

  if (!options.isEnabled()) {
    sessions.delete(session.id);
    await interaction.update({
      content: 'MBTI Pluginが無効になったため診断を終了しました。',
      embeds: [],
      components: [],
      files: [],
      attachments: [],
    });
    return true;
  }

  const question = session.questions[session.questionIndex];
  if (!question) return false;

  session.scores[question.axis] += scoreMbtiAnswer(question, parsed.answer);
  session.answers.push({
    // question.idは出題プール内の固定IDで、人によって選ばれる設問・順序が変わっても
    // 集計側(question_index列)で同一設問だと判別できるようにする。
    questionIndex: question.id,
    axis: question.axis,
    answer: parsed.answer,
  });
  session.questionIndex += 1;

  if (session.questionIndex >= session.questions.length) {
    const type = computeMbtiType(session.scores);
    const identity = computeMbtiIdentity(session.scores);
    sessions.delete(session.id);

    void recordMbtiStats(options.prisma, options.logger, session, type);
    void syncMbtiResultToIvrmWeb(session, type, identity, options.logger);
    options.unlockCompletionAchievement(session.userId).catch((error: unknown) => {
      options.logger.warn(
        { err: error, guildId: session.guildId, userId: session.userId },
        'MBTI診断完了Achievementの解除に失敗しました',
      );
    });
    const roleNote = await tryAssignMbtiRole(interaction, type, options);
    try {
      const png = await renderMbtiResultCard({
        type,
        identity,
        scores: session.scores,
        roleNote: roleNote?.roleName ?? null,
      });
      const attachment = new AttachmentBuilder(png, {
        name: `mbti-result-${session.id}.png`,
      }).setDescription(buildMbtiResultSummaryText(type, identity, session.scores, roleNote));
      await interaction.update({
        content: null,
        embeds: [],
        components: [],
        files: [attachment],
        attachments: [],
      });
    } catch (error) {
      options.logger.warn(
        { err: error, guildId: session.guildId, userId: session.userId, type },
        'MBTI結果カードの生成に失敗したため、テキスト表示へフォールバックしました',
      );
      await interaction.update({
        content: null,
        embeds: [buildResultEmbed(type, identity, session.scores, roleNote)],
        components: [],
        files: [],
        attachments: [],
      });
    }
    return true;
  }

  try {
    await interaction.update({
      ...(await buildQuestionPayload(session)),
      components: [buildAnswerRow(session)],
    });
  } catch (error) {
    options.logger.warn(
      { err: error, guildId: session.guildId, userId: session.userId },
      'MBTI質問カードの生成・送信に失敗しました',
    );
    sessions.delete(session.id);
    await interaction
      .update({
        content: '⚠️ 質問の表示に失敗しました。もう一度 `/mbti` を実行してください。',
        embeds: [],
        components: [],
        files: [],
        attachments: [],
      })
      .catch(() => undefined);
    return true;
  }
  return false;
}

/**
 * 診断結果と全回答を匿名集計テーブルへ記録する（LLMの学習・分析用途）。
 * Discordユーザーへの応答をブロックしないよう、失敗はwarnログのみで握りつぶす。
 */
async function recordMbtiStats(
  prisma: PrismaClient,
  logger: Logger,
  session: MbtiSession,
  type: string,
): Promise<void> {
  try {
    await recordMbtiQuizCompletion(prisma, {
      guildId: session.guildId,
      resultType: type,
      eiScore: session.scores.EI,
      snScore: session.scores.SN,
      tfScore: session.scores.TF,
      jpScore: session.scores.JP,
      answers: toLegacyMbtiAnswers(session.answers),
    });
  } catch (error) {
    logger.warn({ err: error, guildId: session.guildId, type }, 'MBTI統計の記録に失敗しました');
  }
}

/**
 * member.ivrm.jp側でDiscordアカウントを連携しているmemberの公開プロフィールへ
 * MBTI診断結果を反映するため、ivrm-webへfire-and-forgetでpushする。
 * Hertaは自身でDiscordユーザーID⇔診断結果のペアを永続化しない設計方針のため、
 * ここで送信した後はこのプロセス内のメモリ(session)からも破棄される。
 * `IVRM_WEB_API_BASE_URL` / `HERTA_MBTI_SYNC_SECRET` が未設定の場合は何もしない。
 */
async function syncMbtiResultToIvrmWeb(
  session: MbtiSession,
  type: string,
  identity: 'A' | 'T',
  logger: Logger,
): Promise<void> {
  const config = resolveMbtiIvrmSyncConfig(process.env);
  if (!config) return;

  await pushMbtiResultToIvrmWeb(
    config,
    {
      eventId: randomUUID(),
      discordUserId: session.userId,
      mbtiType: type,
      mbtiIdentity: identity,
      occurredAt: new Date().toISOString(),
    },
    logger,
  );
}

interface MbtiRoleAssignmentNote {
  /** Discordのメッセージ/Embed本文用。Discordクライアントがこの構文を自動でRole名へ解決する。 */
  mentionText: string;
  /** PNG画像カード用。<＠&id>構文はPNG内では解決されずそのまま文字として描画されてしまうため、
   * 画像カードには代わりにこちらのRole表示名を渡す(CodeRabbit指摘)。 */
  roleName: string;
}

async function tryAssignMbtiRole(
  interaction: ButtonInteraction,
  type: string,
  options: MbtiCommandOptions,
): Promise<MbtiRoleAssignmentNote | null> {
  const member = interaction.member;
  if (!member || !isGuildMember(member)) return null;

  const roleMap = options.getRoleMap();
  if (Object.values(roleMap).every((roleId) => !roleId)) return null;

  try {
    const result = await reconcileMbtiRole({
      member,
      roleMap,
      resultType: type,
      logger: options.logger,
    });
    if (result.addedRoleId && result.addedRoleName) {
      return {
        mentionText: `<@&${result.addedRoleId}> を付与しました`,
        roleName: `${result.addedRoleName} を付与しました`,
      };
    }
    return null;
  } catch (error) {
    options.logger.warn(
      { err: error, guildId: interaction.guildId, userId: interaction.user.id, type },
      'MBTI Roleの同期に失敗しました',
    );
    return null;
  }
}

/**
 * ButtonInteraction.memberはGuildMember(client cache済み)か、rolesがstring[]の
 * 生APIオブジェクト(APIInteractionGuildMember)のいずれかになりうる。後者は
 * `.roles.cache`を持たないため、typeof roles === 'object'だけでは判定できない
 * (配列もtypeof 'object'を返す)。cacheの有無で厳密に判定する。
 */
function isGuildMember(member: unknown): member is GuildMember {
  if (!member || typeof member !== 'object') return false;
  const roles = (member as { roles?: unknown }).roles;
  if (!roles || typeof roles !== 'object' || Array.isArray(roles)) return false;
  return 'cache' in roles;
}

/**
 * renderMbtiQuestionCard()を起動するが、まだ出番が来ていない先読み分のrejectionが
 * Node.jsのunhandledRejectionとして扱われる(最悪プロセスがクラッシュしうる)のを防ぐため、
 * 返すpromise本体とは別に即座にno-opのcatchを登録しておく。`.catch()`は新しいpromiseを
 * 生成するだけで元のpromiseには影響しないため、呼び出し側(buildQuestionPayload)は返り値を
 * 通常通りawaitでき、実際に失敗していればそこで同じエラーを観測できる。
 */
function startMbtiCardRender(input: MbtiQuestionCardInput): Promise<Buffer> {
  const render = renderMbtiQuestionCard(input);
  render.catch(() => undefined);
  return render;
}

async function buildQuestionPayload(
  session: MbtiSession,
): Promise<{ content: string; files: AttachmentBuilder[]; attachments: []; embeds: [] }> {
  const question = session.questions[session.questionIndex]!;
  const png = await session.cardRenders[session.questionIndex]!;
  const attachment = new AttachmentBuilder(png, {
    name: `mbti-${session.id}-${session.questionIndex}.png`,
  }).setDescription(question.prompt);
  return {
    content: '当てはまる度合いに近いボタンを選んでください（簡易診断です）',
    files: [attachment],
    attachments: [],
    embeds: [],
  };
}

function buildAnswerRow(session: MbtiSession): ActionRowBuilder<ButtonBuilder> {
  const styles: Record<(typeof MBTI_LIKERT_ANSWERS)[number], ButtonStyle> = {
    agree: ButtonStyle.Success,
    slightly_agree: ButtonStyle.Success,
    neutral: ButtonStyle.Secondary,
    slightly_disagree: ButtonStyle.Danger,
    disagree: ButtonStyle.Danger,
  };
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    MBTI_LIKERT_ANSWERS.map((answer) =>
      new ButtonBuilder()
        .setCustomId(`${PREFIX}${session.id}:${answer}`)
        .setLabel(mbtiLikertLabel(answer))
        .setStyle(styles[answer]),
    ),
  );
}

const MBTI_AXIS_LETTER_PAIRS: Record<(typeof MBTI_AXES)[number], [string, string]> = {
  EI: ['E', 'I'],
  SN: ['S', 'N'],
  TF: ['T', 'F'],
  JP: ['J', 'P'],
  AT: ['A', 'T'],
};

function buildMbtiAxisBreakdownText(scores: MbtiScores, separator = '\n'): string {
  return MBTI_AXES.map((axis) => {
    const [positive, negative] = MBTI_AXIS_LETTER_PAIRS[axis];
    const percent = computeMbtiAxisPercent(scores, axis);
    return `${positive} ${percent}% / ${negative} ${100 - percent}%`;
  }).join(separator);
}

/**
 * 結果カードPNGのalt text(添付ファイルのdescription)用に、Embed表示と同じ情報を
 * プレーンテキストへまとめる。画像の内容を読み上げソフト等でも把握できるようにする
 * (CodeRabbit指摘)。
 */
function buildMbtiResultSummaryText(
  type: string,
  identity: 'A' | 'T',
  scores: MbtiScores,
  roleNote: MbtiRoleAssignmentNote | null,
): string {
  const info = MBTI_TYPES[type];
  const identityInfo = MBTI_IDENTITY_INFO[identity];
  const parts = [
    `診断結果: ${type}-${identity}${info ? ` — ${info.title}（${identityInfo.label}）` : ''}`,
    info?.description ?? '診断結果を計算できませんでした。',
    identityInfo.description,
    buildMbtiAxisBreakdownText(scores, ' / '),
  ];
  if (roleNote) parts.push(roleNote.roleName);
  return parts.join(' / ');
}

function buildResultEmbed(
  type: string,
  identity: 'A' | 'T',
  scores: MbtiScores,
  roleNote: MbtiRoleAssignmentNote | null,
): EmbedBuilder {
  const info = MBTI_TYPES[type];
  const identityInfo = MBTI_IDENTITY_INFO[identity];
  const breakdown = buildMbtiAxisBreakdownText(scores);

  const embed = new EmbedBuilder()
    .setTitle(
      `🎉 診断結果: ${type}-${identity}${info ? ` — ${info.title}（${identityInfo.label}）` : ''}`,
    )
    .setDescription(
      `${info?.description ?? '診断結果を計算できませんでした。'}\n\n${identityInfo.description}`,
    )
    .addFields({ name: '各軸の傾向', value: breakdown })
    .setColor(0x2ecc71)
    .setFooter({ text: '簡易診断のため参考程度にご覧ください' });

  if (roleNote) embed.addFields({ name: 'Role', value: roleNote.mentionText });
  return embed;
}

function parseCustomId(
  customId: string,
): { sessionId: string; answer: (typeof MBTI_LIKERT_ANSWERS)[number] } | null {
  if (!customId.startsWith(PREFIX)) return null;
  const [sessionId, answer] = customId.slice(PREFIX.length).split(':');
  if (!sessionId || !answer || !isMbtiLikertAnswer(answer)) return null;
  return { sessionId, answer };
}
