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
import { participationFortune } from './daily-participation-fortune.js';
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
  type ParticipationStatus,
} from './daily-participation-client.js';

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
    /^daily-bonus:\d{4}-\d\d-\d\d$/.test(interaction.customId)
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

export async function showParticipationQuestions(
  ctx: Context,
  interaction: Interaction,
  state: ParticipationStatus,
  messageId: string,
) {
  const date = dailyBonusDate(new Date());
  for (const question of state.questions) {
    if (question.dateJst !== date || Date.parse(question.closesAt) <= Date.now()) continue;
    const response = state.responses.find((r) => r.questionId === question.id);
    if (response) {
      await interaction.followUp({
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
        content:
          response.state === 'pending'
            ? '回答済みです。結果確定をお待ちください。'
            : `回答済み / 獲得 ${response.rewardPoints}pt`,
        embeds: [new EmbedBuilder().setColor(0xb9a2ff).setDescription(question.prompt)],
      });
      continue;
    }
    if (question.requiresClaim && !state.bonusClaimed) continue;
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
    for (const media of question.media) {
      try {
        const response = await dailyServiceFetch(
          ctx.guildId,
          interaction.user.id,
          '/v2/participation/herta/media',
          { mediaId: media.id },
        );
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
        await interaction.followUp({
          flags: MessageFlags.Ephemeral,
          allowedMentions: { parse: [] },
          content:
            question.options
              .filter((o) => o.mediaId === media.id)
              .map((o) => o.label)
              .join(' / ') || '問題の素材',
          files: [
            new AttachmentBuilder(Buffer.concat(chunks), {
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
        return;
      }
    }
    await interaction.followUp({
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
      content: `${question.slot === 'bonus' ? '🎭 ボーナス問題' : '🧠 今日の問題'}\n締切：<t:${Math.floor(Date.parse(question.closesAt) / 1000)}:f>\n最初の回答で確定します。${question.format === 'free_text' ? `最大${question.maxTextLength}文字。` : ''}${question.scoring === 'instant' ? '即時採点します。' : '確定後に結果を確認できます。'}`,
      embeds: [
        new EmbedBuilder()
          .setColor(0xb9a2ff)
          .setDescription(question.prompt)
          .addFields(question.options.map((o, i) => ({ name: `選択肢 ${i + 1}`, value: o.label }))),
      ],
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(buttons)],
    });
  }
  if (!state.questions.length)
    await interaction.followUp({
      flags: MessageFlags.Ephemeral,
      content: '本日の問題は準備中です。ボーナスはそのまま受け取れます。',
    });
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
      await interaction.editReply({
        content: `${answer.mode === 'already_answered' ? 'この問題は回答済みです。' : answer.response.state === 'pending' ? '回答を受け付けました。結果の確定をお待ちください。' : answer.response.isCorrect === true ? '正解です！' : answer.response.isCorrect === false ? '今回は不正解です。' : '回答を受け付けました。'}\n獲得：${answer.response.rewardPoints}pt / 保有：${answer.balance}pt\nhttps://member.ivrm.jp/login-bonus`,
        allowedMentions: { parse: [] },
        components: [],
      });
      return;
    }
    let state: ParticipationStatus;
    let claimConfirmed = false;
    const wantsClaim = interaction.customId.startsWith('daily-bonus:');
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
      claimConfirmed = true;
      try {
        state = await participationStatus(ctx.guildId, interaction.user.id);
      } catch {
        await interaction.followUp({
          flags: MessageFlags.Ephemeral,
          allowedMentions: { parse: [] },
          content:
            'ボーナスの受取は確定しています。今日の問題を取得できませんでした。時間をおいて「今日の問題に挑戦」から再試行してください。',
        });
        return;
      }
    } else {
      state = await participationStatus(ctx.guildId, interaction.user.id);
      ensureCurrent();
      await interaction.editReply({
        content: state.bonusClaimed
          ? '今日の回答状態を確認しました。'
          : '先に「ボーナスを受け取る」から受け取ってください。',
        allowedMentions: { parse: [] },
      });
    }
    try {
      await showParticipationQuestions(ctx, interaction, state, messageId);
      if (wantsClaim && ctx.config.fortuneEnabled)
        await participationFortune(ctx, interaction, date);
    } catch (error) {
      if (!claimConfirmed) throw error;
      await interaction.followUp({
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
        content:
          'ボーナスの受取は確定しています。問題・運勢の表示を完了できませんでした。時間をおいて再試行してください。',
      });
    }
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
