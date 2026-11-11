import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  AttachmentBuilder,
  EmbedBuilder,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type Client,
} from 'discord.js';
import { dailyServiceFetch } from './daily-bonus-wallet.js';
import {
  createDailyQuizSession,
  getDailyQuizSession,
  getDailyAnnouncement,
  recordDailyClaim,
  type PrismaClient,
} from '@herta/db';
import { dailyBonusDate, rejectDailyBonus } from './daily-bonus-policy.js';
import { dailyBonusFailureMessage } from './daily-bonus-presentation.js';
import { replyDailyBonusResult } from './daily-bonus-reply.js';
import {
  participationStatus,
  participationClaim,
  participationAnswer,
  yesterdayReview,
  type ParticipationStatus,
  type ParticipationQuestion,
  type YesterdayReview,
} from './daily-participation-client.js';
import { renderDailyQuestionCard, type DailyQuestionCardResult } from './daily-question-card.js';
import { replyDailyParticipationAnswer } from './daily-result-card-reply.js';

interface Context {
  guildId: string;
  prisma: PrismaClient;
  client: Client;
  config: { enabled: boolean; notificationRoleId: string; fortuneEnabled?: boolean };
}
type Interaction = ButtonInteraction | ModalSubmitInteraction;
const sessionPattern = /^daily-participation:(answer|text|submit):([0-9a-f-]{36})(?::([0-3]))?$/;

export function isParticipationInteraction(interaction: { customId: string }) {
  return (
    interaction.customId.startsWith('daily-participation:') ||
    /^daily-bonus:(?:questions:)?\d{4}-\d\d-\d\d$/.test(interaction.customId)
  );
}
async function admission(ctx: Context, interaction: Interaction) {
  const sessionMatch = sessionPattern.exec(interaction.customId);
  const session = sessionMatch
    ? await getDailyQuizSession(ctx.prisma, sessionMatch[2]!, ctx.guildId, interaction.user.id)
    : null;
  if (sessionMatch && !session) throw new Error('expired');
  const date = session?.target_date ?? interaction.customId.split(':').at(-1)!;
  const messageId =
    session?.announcement_message_id ?? (interaction.isButton() ? interaction.message.id : '');
  const announcement = await getDailyAnnouncement(ctx.prisma, ctx.guildId, date);
  const member =
    interaction.guildId === ctx.guildId
      ? await interaction.guild?.members.fetch({ user: interaction.user.id, force: true })
      : null;
  const rejected = rejectDailyBonus({
    enabled: ctx.config.enabled,
    configuredGuildId: ctx.guildId,
    interactionGuildId: interaction.guildId,
    configuredRoleId: ctx.config.notificationRoleId,
    memberRoleIds: member ? [...member.roles.cache.keys()] : [],
    announcementMessageId: announcement?.message_id ?? '',
    interactionMessageId: messageId,
    announcementDate: date,
    announcementStatus: announcement?.status === 'sent' ? 'sent' : 'disabled',
    now: new Date(),
  });
  if (
    rejected ||
    announcement?.channel_id !== interaction.channelId ||
    announcement?.role_id !== ctx.config.notificationRoleId
  )
    throw new Error('expired');
  const channel = await interaction.guild!.channels.fetch(announcement.channel_id);
  if (!channel?.isTextBased() || !('messages' in channel)) throw new Error('expired');
  const original = await channel.messages.fetch(messageId);
  if (original.author.id !== ctx.client.user?.id) throw new Error('expired');
  return { date, messageId, session, sessionMatch };
}

type QuestionMedia = ParticipationQuestion['media'][number];

async function fetchQuestionMedia(
  ctx: Context,
  userId: string,
  media: QuestionMedia,
): Promise<Buffer> {
  const response = await dailyServiceFetch(ctx.guildId, userId, '/v2/participation/herta/media', {
    mediaId: media.id,
  });
  if (
    !response?.ok ||
    response.headers.get('X-IVRM-Media-Id') !== media.id ||
    response.headers.get('Content-Type') !== media.mimeType ||
    !['image/webp', 'audio/wav'].includes(media.mimeType) ||
    Number(response.headers.get('Content-Length')) !== media.byteSize ||
    !response.headers.get('Cache-Control')?.includes('private') ||
    !response.headers.get('Cache-Control')?.includes('no-store') ||
    !response.body
  )
    throw Error('Invalid media response');
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    total += part.value.length;
    if (total > 10485760) {
      await reader.cancel();
      throw Error('Media too large');
    }
    chunks.push(part.value);
  }
  if (total !== media.byteSize) throw Error('Media size mismatch');
  return Buffer.concat(chunks);
}

/**
 * An image attached to the question itself (not to one of its options) is the
 * author-provided visual for the question and overrides the default card (#851).
 */
export function questionHeroImage(question: ParticipationQuestion): QuestionMedia | null {
  const referenced = new Set(
    question.options.map((o) => o.mediaId).filter((id): id is string => id !== null),
  );
  return question.media.find((m) => m.kind === 'image' && !referenced.has(m.id)) ?? null;
}

export async function showParticipationQuestions(
  ctx: Context,
  interaction: Interaction,
  state: ParticipationStatus,
  messageId: string,
) {
  const date = dailyBonusDate(new Date());
  let shown = false;
  let claimRequired = false;
  for (const question of state.questions) {
    if (question.dateJst !== date || Date.parse(question.closesAt) <= Date.now()) continue;
    const response = state.responses.find((r) => r.questionId === question.id);
    if (response) {
      shown = true;
      const content =
        response.state === 'pending'
          ? '回答済みです。結果確定をお待ちください。'
          : `回答済み / 獲得 ${response.rewardPoints}pt`;
      if (process.env.DAILY_QUESTION_CARD_ENABLED === 'true') {
        try {
          const selectedIndex = question.options.findIndex((o) => o.id === response.optionId);
          const card = await renderDailyQuestionCard({
            slot: question.slot,
            prompt: question.prompt,
            options: question.options,
            format: question.format,
            maxTextLength: question.maxTextLength,
            result: {
              state: response.state,
              isCorrect: response.isCorrect,
              selectedOptionIndex: selectedIndex >= 0 ? selectedIndex : null,
              selectedText: response.text,
              rewardPoints: response.rewardPoints,
            },
          });
          await interaction.followUp({
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
            content,
            embeds: [
              new EmbedBuilder()
                .setColor(0xb9a2ff)
                .setImage('attachment://daily-question-answered.png'),
            ],
            files: [new AttachmentBuilder(card, { name: 'daily-question-answered.png' })],
          });
          continue;
        } catch {
          // Card rendering is presentation only; fall back to the Embed below.
        }
      }
      await interaction.followUp({
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
        content,
        embeds: [new EmbedBuilder().setColor(0xb9a2ff).setDescription(question.prompt)],
      });
      continue;
    }
    if (question.requiresClaim && !state.bonusClaimed) {
      claimRequired = true;
      continue;
    }
    const session = await createDailyQuizSession(
      ctx.prisma,
      ctx.guildId,
      interaction.user.id,
      date,
      messageId,
      question.id,
    );
    const buttons =
      question.format === 'free_text'
        ? [
            new ButtonBuilder()
              .setCustomId(`daily-participation:text:${session}`)
              .setLabel('回答を投稿する')
              .setStyle(ButtonStyle.Primary),
          ]
        : question.options.map((option, index) =>
            new ButtonBuilder()
              .setCustomId(`daily-participation:answer:${session}:${index}`)
              .setLabel(option.label.slice(0, 80))
              .setStyle(ButtonStyle.Primary),
          );
    if (!buttons.length) continue;
    shown = true;
    const header = `${question.slot === 'bonus' ? '🎭 ボーナス問題' : '🧠 今日の問題'}
締切：<t:${Math.floor(Date.parse(question.closesAt) / 1000)}:f>
最初の回答で確定します。${question.format === 'free_text' ? `最大${question.maxTextLength}文字。` : ''}${question.scoring === 'instant' ? '即時採点します。' : '確定後に結果を確認できます。'}`;
    const components = [new ActionRowBuilder<ButtonBuilder>().addComponents(buttons)];
    const hero = questionHeroImage(question);
    // Option media (image_choice artwork, audio) stays attached to its option.
    // A fetch failure must no longer hide the whole question (#851).
    for (const media of question.media.filter((m) => m !== hero)) {
      try {
        const buffer = await fetchQuestionMedia(ctx, interaction.user.id, media);
        await interaction.followUp({
          flags: MessageFlags.Ephemeral,
          allowedMentions: { parse: [] },
          content:
            question.options
              .filter((o) => o.mediaId === media.id)
              .map((o) => o.label)
              .join(' / ') || '問題の素材',
          files: [
            new AttachmentBuilder(buffer, {
              name: `${media.id}.${media.kind === 'audio' ? 'wav' : 'webp'}`,
            }),
          ],
        });
      } catch {
        await interaction.followUp({
          flags: MessageFlags.Ephemeral,
          content:
            '問題の素材を取得できませんでした。Memberページで確認するか、時間をおいて再試行してください。\nhttps://member.ivrm.jp/participation',
        });
      }
    }
    // An author-provided question image replaces the default card image (#851).
    if (hero) {
      try {
        const buffer = await fetchQuestionMedia(ctx, interaction.user.id, hero);
        const name = `${hero.id}.webp`;
        await interaction.followUp({
          flags: MessageFlags.Ephemeral,
          allowedMentions: { parse: [] },
          content: header,
          embeds: [
            new EmbedBuilder()
              .setColor(0xb9a2ff)
              .setImage(`attachment://${name}`)
              .addFields(
                { name: '❓ 問題', value: question.prompt.slice(0, 1024) },
                ...(question.format === 'free_text'
                  ? [
                      {
                        name: '✍ 回答方法',
                        value: `下のボタンから最大${question.maxTextLength}文字で回答してください`,
                      },
                    ]
                  : question.options.map((o, i) => ({
                      name: `選択肢 ${i + 1}`,
                      value: o.label,
                    }))),
              ),
          ],
          files: [new AttachmentBuilder(buffer, { name })],
          components,
        });
        continue;
      } catch {
        // Fall through to the default presentation; never block answering on media.
      }
    }
    if (process.env.DAILY_QUESTION_CARD_ENABLED === 'true') {
      try {
        const card = await renderDailyQuestionCard({
          slot: question.slot,
          prompt: question.prompt,
          options: question.options,
          format: question.format,
          maxTextLength: question.maxTextLength,
        });
        await interaction.followUp({
          flags: MessageFlags.Ephemeral,
          allowedMentions: { parse: [] },
          content: header,
          files: [new AttachmentBuilder(card, { name: 'herta-daily-question.png' })],
          components,
        });
        continue;
      } catch {
        // Card rendering is presentation only; fall back to the Embed below.
      }
    }
    await interaction.followUp({
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
      content: header,
      embeds: [
        new EmbedBuilder()
          .setColor(0xb9a2ff)
          .setDescription(question.prompt)
          .addFields(question.options.map((o, i) => ({ name: `選択肢 ${i + 1}`, value: o.label }))),
      ],
      components,
    });
  }
  if (!shown && (claimRequired || !state.questions.length)) {
    await interaction.followUp({
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
      content: claimRequired
        ? 'この問題への回答にはログインボーナスの受取が必要です。🎁 ボーナスを受け取るボタンで受取後、もう一度「今日の問題に挑戦」を押してください。'
        : '本日の問題は準備中です。ボーナスはそのまま受け取れます。',
    });
  }
}

/**
 * Yesterday review (#820): a read-only look back at the previous day's
 * questions with the member's own answer, the correct answer and the
 * explanation. It never claims, answers or opens a session, and answers
 * stay hidden until the API reports them revealed (09:00 JST).
 */
export async function showYesterdayReview(ctx: Context, interaction: Interaction) {
  let review: YesterdayReview;
  try {
    review = await yesterdayReview(ctx.guildId, interaction.user.id);
  } catch {
    await interaction.editReply({
      content: '昨日の問題を取得できませんでした。時間をおいて再試行してください。',
      allowedMentions: { parse: [] },
      components: [],
    });
    return;
  }
  if (!review.entries.length) {
    await interaction.editReply({
      content: '昨日の問題はありませんでした。',
      allowedMentions: { parse: [] },
      components: [],
    });
    return;
  }
  if (!review.revealed) {
    await interaction.editReply({
      content: '答え合わせは 9:00 以降に確認できます。',
      allowedMentions: { parse: [] },
      components: [],
    });
    return;
  }
  await interaction.editReply({
    content: '昨日の答え合わせです。',
    allowedMentions: { parse: [] },
  });
  for (const entry of review.entries) {
    const { question, userResponse } = entry;
    const heading = question.slot === 'bonus' ? '昨日のボーナス問題' : '昨日の問題';
    const selectedIndex = userResponse
      ? question.options.findIndex((o) => o.id === userResponse.optionId)
      : -1;
    const correctIndex = question.options.findIndex((o) => o.id === entry.correctOptionId);
    const result: DailyQuestionCardResult = userResponse
      ? {
          state: userResponse.state,
          isCorrect: userResponse.isCorrect,
          selectedOptionIndex: selectedIndex >= 0 ? selectedIndex : null,
          selectedText: userResponse.text,
          rewardPoints: userResponse.rewardPoints,
          correctOptionIndex: correctIndex >= 0 ? correctIndex : null,
        }
      : {
          state: 'graded',
          isCorrect: null,
          selectedOptionIndex: null,
          selectedText: null,
          rewardPoints: 0,
          correctOptionIndex: correctIndex >= 0 ? correctIndex : null,
          unanswered: true,
        };
    const verdict = !userResponse
      ? '昨日は未回答でした。'
      : userResponse.state === 'pending'
        ? '昨日の問題は結果確定待ちです。'
        : userResponse.isCorrect === true
          ? `正解でした！ / 獲得 ${userResponse.rewardPoints}pt`
          : userResponse.isCorrect === false
            ? `不正解でした。 / 獲得 ${userResponse.rewardPoints}pt`
            : `回答済み / 獲得 ${userResponse.rewardPoints}pt`;
    const explanation = entry.explanation
      ? `\n💡 解説：${Array.from(entry.explanation).slice(0, 500).join('')}`
      : '';
    const content = verdict + explanation;
    if (process.env.DAILY_QUESTION_CARD_ENABLED === 'true') {
      try {
        const card = await renderDailyQuestionCard({
          slot: question.slot,
          heading,
          prompt: question.prompt,
          options: question.options,
          format: question.format,
          maxTextLength: question.maxTextLength,
          result,
        });
        await interaction.followUp({
          flags: MessageFlags.Ephemeral,
          allowedMentions: { parse: [] },
          content,
          embeds: [
            new EmbedBuilder()
              .setColor(0xb9a2ff)
              .setImage('attachment://daily-question-yesterday.png'),
          ],
          files: [new AttachmentBuilder(card, { name: 'daily-question-yesterday.png' })],
        });
        continue;
      } catch {
        // Card rendering is presentation only; fall back to the Embed below.
      }
    }
    await interaction.followUp({
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
      content,
      embeds: [
        new EmbedBuilder()
          .setColor(0xb9a2ff)
          .setTitle(heading)
          .setDescription(question.prompt)
          .addFields(
            question.format === 'free_text' || !question.options.length
              ? [
                  {
                    name: 'あなたの回答',
                    value: (userResponse?.text ?? '（未回答）').slice(0, 1024),
                  },
                ]
              : question.options.map((o, i) => ({
                  name:
                    `選択肢 ${i + 1}` +
                    (result.selectedOptionIndex === i ? '（あなたの回答）' : '') +
                    (result.correctOptionIndex === i ? '（正解）' : ''),
                  value: o.label,
                })),
          ),
      ],
    });
  }
}

export async function handleDailyParticipation(
  ctx: Context,
  interaction: Interaction,
  isCurrent: () => boolean = () => true,
) {
  const ensureCurrent = () => {
    if (
      !isCurrent() ||
      process.env.DAILY_PARTICIPATION_ENABLED !== 'true' ||
      process.env.DAILY_BONUS_ENABLED !== 'true' ||
      !ctx.config.enabled
    )
      throw new Error('disabled');
  };
  // Opening a Modal must be the initial interaction response. All authorization/scoring is rechecked at submission.
  const opening = /^daily-participation:text:([0-9a-f-]{36})$/.exec(interaction.customId);
  if (opening && interaction.isButton()) {
    if (
      process.env.DAILY_PARTICIPATION_ENABLED !== 'true' ||
      process.env.DAILY_BONUS_ENABLED !== 'true' ||
      !ctx.config.enabled
    ) {
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: '日次参加機能は現在準備中です。',
      });
      return;
    }
    const session = await getDailyQuizSession(
      ctx.prisma,
      opening[1]!,
      ctx.guildId,
      interaction.user.id,
    );
    if (!session || session.target_date !== dailyBonusDate(new Date())) {
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: '回答ボタンの期限が切れています。当日の通知から再確認してください。',
      });
      return;
    }
    await interaction.showModal(
      new ModalBuilder()
        .setCustomId(`daily-participation:submit:${session.id}`)
        .setTitle('今日のボーナス問題に回答')
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId('answer')
              .setLabel('回答（問題の文字数制限内で入力）')
              .setStyle(TextInputStyle.Paragraph)
              .setMaxLength(1000)
              .setRequired(true),
          ),
        ),
    );
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    if (
      process.env.DAILY_PARTICIPATION_ENABLED !== 'true' ||
      process.env.DAILY_BONUS_ENABLED !== 'true'
    )
      throw new Error('disabled');
    const { date, messageId, session, sessionMatch } = await admission(ctx, interaction);
    if (session) {
      const state = await participationStatus(ctx.guildId, interaction.user.id);
      ensureCurrent();
      const question = state.questions.find((q) => q.id === session.quiz_id && q.dateJst === date);
      if (
        !question ||
        Date.parse(question.closesAt) <= Date.now() ||
        (question.requiresClaim && !state.bonusClaimed)
      )
        throw new Error('expired');
      const modal = interaction.isModalSubmit();
      if (modal !== (question.format === 'free_text') || (modal && sessionMatch?.[1] !== 'submit'))
        throw new Error('expired');
      const option = modal ? null : question.options[Number(sessionMatch?.[3])];
      const text = modal ? interaction.fields.getTextInputValue('answer').trim() : null;
      if (
        (!modal && !option) ||
        (modal && (!text || Array.from(text!).length > (question.maxTextLength ?? 1000)))
      )
        throw new Error('invalid_answer');
      const answer = await participationAnswer(
        ctx.guildId,
        interaction.user.id,
        question.id,
        option?.id ?? null,
        text,
      );
      await replyDailyParticipationAnswer(interaction, {
        guildId: ctx.guildId,
        userId: interaction.user.id,
        content: `${answer.mode === 'already_answered' ? 'この問題は回答済みです。' : answer.response.state === 'pending' ? '回答を受け付けました。結果の確定をお待ちください。' : answer.response.isCorrect === true ? '正解です！' : answer.response.isCorrect === false ? '今回は不正解です。' : '回答を受け付けました。'}\n獲得：${answer.response.rewardPoints}pt / 保有：${answer.balance}pt\nhttps://member.ivrm.jp/login-bonus`,
        // The result card is presentation over the committed answer (#803).
        // Only a graded outcome is carded; the selector seed is derived from
        // server-finalized answer values so re-displays stay stable.
        result:
          answer.response.state === 'graded' && answer.response.isCorrect !== null
            ? answer.response.isCorrect
              ? 'correct'
              : 'incorrect'
            : null,
        rewardPoints: answer.response.rewardPoints,
        balance: answer.balance,
        finalizedReceiptId: `daily-participation-answer:${interaction.user.id}:${answer.response.questionId}:${answer.response.submittedAt}`,
      });
      return;
    }
    // Yesterday review is a standalone read-only action (#820). It must not
    // fall through to today's status/questions or trigger a claim.
    if (interaction.customId.startsWith('daily-participation:yesterday:')) {
      ensureCurrent();
      await showYesterdayReview(ctx, interaction);
      return;
    }

    // Claim is a standalone action. Neither question retrieval nor Fortune
    // rendering is an implicit side effect of accepting a login bonus.
    const wantsClaim = /^daily-bonus:\d{4}-\d\d-\d\d$/.test(interaction.customId);
    if (wantsClaim) {
      ensureCurrent();
      const claimed = await participationClaim(ctx.guildId, interaction.user.id, date, messageId);
      if (claimed.receipt.claimDateJst !== date) throw new Error('expired');
      const receipt = claimed.receipt;
      await recordDailyClaim(
        ctx.prisma,
        ctx.guildId,
        interaction.user.id,
        date,
        'confirmed',
        receipt,
      );
      await replyDailyBonusResult(interaction, {
        status: 'confirmed',
        alreadyClaimed: claimed.mode === 'already_claimed',
        receipt: { ...receipt, streakReward: receipt.streakReward ?? undefined },
        balance: claimed.balance,
        message: `${claimed.mode === 'already_claimed' ? '本日は受取済みです。' : 'ボーナスを受け取りました！'}\n獲得：${receipt.rewardPoints + (receipt.streakReward?.points ?? 0) + (receipt.firstClaimReward?.points ?? 0)}pt / 保有：${claimed.balance}pt / 連続：${receipt.streakDay}日`,
      });
      return;
    }

    // Independent question button: a publication may explicitly require
    // claiming, but an ordinary standalone question must not trigger it.
    const state: ParticipationStatus = await participationStatus(ctx.guildId, interaction.user.id);
    ensureCurrent();
    await interaction.editReply({
      content: '今日の問題を確認します。',
      allowedMentions: { parse: [] },
    });
    await showParticipationQuestions(ctx, interaction, state, messageId);
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    await interaction.editReply({
      content:
        code === 'expired'
          ? '対象ロール・当日の通知・回答期限を確認してください。'
          : code === 'invalid_answer'
            ? '回答の文字数や選択肢を確認してください。'
            : dailyBonusFailureMessage(
                code === 'profile_required'
                  ? 'profile_required'
                  : code === 'account_initialization_required'
                    ? 'account_initialization_required'
                    : 'unavailable',
              ),
      allowedMentions: { parse: [] },
      components: [],
    });
  }
}
