import { createHash } from 'node:crypto';
import {
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  type Client,
  type ButtonInteraction,
} from 'discord.js';
import {
  getDailyAnnouncement,
  reserveDailyAnnouncement,
  captureDailyAnnouncementPopulation,
  setDailyAnnouncement,
  listAnniversaries,
  recordDailyClaim,
  createDailyQuizSession,
  getDailyQuizSession,
  type PrismaClient,
} from '@herta/db';
import { dailyBonusManifest } from '@herta/plugin-catalog';
import { definePlugin, type PluginRuntimeContext } from '@herta/plugin-sdk';
import {
  dailyBonusDate,
  dailyBonusAllowedMentions,
  rejectDailyBonus,
} from './daily-bonus-policy.js';
import { captureDailyBonusPopulation } from './daily-bonus-population.js';
import { selectAnniversaries } from './daily-bonus-content.js';
import { EMPTY_FORTUNE_PROFILE } from './fortune-core.js';
import { fetchIvrmFortuneProfile } from './fortune-ivrm-profile.js';
import { claimDailyBonus, dailyBonusStatus } from './daily-bonus-wallet.js';
import { savedDailyFortune } from './daily-fortune.js';
import { renderFortuneCard } from './fortune-card.js';
import { replyDailyBonusResult } from './daily-bonus-reply.js';
import { dailyAnniversaryHeading, dailyBonusFailureMessage } from './daily-bonus-presentation.js';

interface Config {
  enabled: boolean;
  channelId: string;
  notificationRoleId: string;
  fortuneEnabled: boolean;
  anniversaryLimit: number;
  anniversaryCategories: string[];
  messageTemplate: string;
}
type Context = PluginRuntimeContext<Config, Client, PrismaClient>;
const timers = new Map<string, NodeJS.Timeout>();
const running = new Set<string>();
const generations = new Map<string, number>();
export const dailyBonusPlugin = definePlugin<Config, Client, PrismaClient>({
  manifest: dailyBonusManifest,
  async onEnable(ctx) {
    stop(ctx.guildId);
    if (!ctx.config.enabled) return;
    const run = () => {
      void scanDailyBonus(ctx).catch(() => ctx.logger.warn('Daily bonus scan failed'));
    };
    const timer = setInterval(run, 30_000);
    timer.unref();
    timers.set(ctx.guildId, timer);
    run();
  },
  async onDisable(ctx) {
    stop(ctx.guildId);
  },
  provideEvents() {
    return [
      {
        event: 'interactionCreate',
        async handler(ctx, ...args) {
          const interaction = args[0] as ButtonInteraction | undefined;
          if (!interaction?.isButton() || !interaction.customId.startsWith('daily-bonus:')) return;
          await handleDailyBonus(ctx, interaction);
        },
      },
    ];
  },
});
function stop(guild: string) {
  const timer = timers.get(guild);
  if (timer) clearInterval(timer);
  timers.delete(guild);
  generations.set(guild, (generations.get(guild) ?? 0) + 1);
}
export async function scanDailyBonus(ctx: Context, now = new Date()) {
  if (
    process.env.DAILY_BONUS_ENABLED !== 'true' ||
    !ctx.config.enabled ||
    running.has(ctx.guildId) ||
    !ctx.config.channelId
  )
    return;
  const date = dailyBonusDate(now);
  if (now.getTime() < Date.parse(`${date}T09:00:00+09:00`)) return;
  // A late restart may deliver today's message; never creates a past-day occurrence.
  running.add(ctx.guildId);
  const generation = generations.get(ctx.guildId) ?? 0;
  try {
    const prior = await getDailyAnnouncement(ctx.prisma, ctx.guildId, date);
    if (prior?.status === 'sending' && new Date(prior.updated_at).getTime() < Date.now() - 120000) {
      await ctx.prisma
        .$executeRaw`UPDATE daily_bonus_announcements SET status='uncertain',error_code='InterruptedSendRequiresReview',updated_at=NOW() WHERE guild_id=${ctx.guildId} AND target_date=${date} AND status='sending' AND updated_at<NOW()-INTERVAL '2 minutes'`;
      return;
    }
    if (prior?.status === 'uncertain' && prior.error_code === 'ReconcileRequested') {
      const guild = await ctx.client.guilds.fetch(ctx.guildId),
        channel = await guild.channels.fetch(prior.channel_id);
      if (!channel?.isTextBased() || !('messages' in channel)) return;
      const messages = await channel.messages.fetch({ limit: 100 });
      const matches = messages.filter(
        (message) =>
          message.author.id === ctx.client.user?.id &&
          message.createdTimestamp >= Date.parse(`${date}T09:00:00+09:00`) &&
          message.content === `<@&${prior.role_id}>` &&
          message.components.some(
            (row) =>
              'components' in row &&
              row.components.some(
                (component) =>
                  'customId' in component && component.customId === `daily-bonus:${date}`,
              ),
          ),
      );
      if (matches.size === 1)
        await setDailyAnnouncement(
          ctx.prisma,
          ctx.guildId,
          date,
          'sent',
          matches.first()!.id,
          null,
        );
      else
        await setDailyAnnouncement(
          ctx.prisma,
          ctx.guildId,
          date,
          'uncertain',
          null,
          matches.size ? 'MultipleMessagesRequireReview' : 'MessageNotFoundRequiresReview',
        );
      return;
    }
    if (prior && prior.status !== 'pending') return; // uncertain never blindly resent.
    const reservation = await reserveDailyAnnouncement(
      ctx.prisma,
      ctx.guildId,
      date,
      ctx.config.channelId,
      ctx.config.notificationRoleId,
    );
    if (!reservation) return;
    try {
      const guild = await ctx.client.guilds.fetch(ctx.guildId);
      const role = await guild.roles.fetch(ctx.config.notificationRoleId);
      const channel = await guild.channels.fetch(ctx.config.channelId);
      const me = await guild.members.fetchMe();
      if (
        !role ||
        role.id === guild.id ||
        !channel?.isTextBased() ||
        channel.isThread() ||
        !('send' in channel)
      )
        throw new Error('InvalidDailyBonusTarget');
      const permissions = channel.permissionsFor(me);
      if (
        !permissions?.has([
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.EmbedLinks,
          PermissionFlagsBits.ReadMessageHistory,
        ]) ||
        (!role.mentionable && !permissions.has(PermissionFlagsBits.MentionEveryone))
      )
        throw new Error('DailyBonusPermissions');
      const population = await captureDailyBonusPopulation(guild, role.id);
      await captureDailyAnnouncementPopulation(ctx.prisma, ctx.guildId, date, role.id, population);
      const events = selectAnniversaries(
        await listAnniversaries(ctx.prisma, ctx.guildId),
        date,
        ctx.config.anniversaryCategories,
        ctx.config.anniversaryLimit,
      );
      const embed = new EmbedBuilder()
        .setColor(0xb9a2ff)
        .setTitle(`🎁 ${date} 本日のログインボーナス`)
        .setDescription(
          `${ctx.config.messageTemplate}\n\n下のボタンで共通ログインボーナスを受け取れます。\n付与額・連続日数はメンバーポータルと共通です。\n受取期限：本日23:59 JST`,
        )
        .setFooter({ text: '受取と今日の運勢は本人にだけ表示します' });
      if (events.length)
        embed.addFields({
          name: dailyAnniversaryHeading(events.length),
          value: '公式情報を確認した本日の記念日です。',
        });
      for (const event of events)
        embed.addFields({
          name: `🎮 ${event.title}${event.anniversary === null ? '' : `（${event.anniversary}周年）`}`,
          value: `${event.summary || '記念日をお祝いしましょう'}\n[出典](${event.sourceUrl})`,
        });
      if (
        generation !== (generations.get(ctx.guildId) ?? 0) ||
        process.env.DAILY_BONUS_ENABLED !== 'true' ||
        dailyBonusDate(new Date()) !== date
      ) {
        await setDailyAnnouncement(
          ctx.prisma,
          ctx.guildId,
          date,
          'failed',
          null,
          'ConfigurationChanged',
        );
        return;
      }
      try {
        const message = await channel.send({
          content: `<@&${role.id}>`,
          embeds: [embed],
          components: [
            new ActionRowBuilder<ButtonBuilder>().addComponents(
              new ButtonBuilder()
                .setCustomId(`daily-bonus:${date}`)
                .setLabel('🎁 ボーナスを受け取る')
                .setStyle(ButtonStyle.Primary),
            ),
          ],
          allowedMentions: dailyBonusAllowedMentions(role.id),
          nonce: createHash('sha256').update(`${ctx.guildId}:${date}`).digest('hex').slice(0, 25),
          enforceNonce: true,
        });
        await setDailyAnnouncement(ctx.prisma, ctx.guildId, date, 'sent', message.id, null);
      } catch {
        await setDailyAnnouncement(
          ctx.prisma,
          ctx.guildId,
          date,
          'uncertain',
          null,
          'DiscordSendUnconfirmed',
        );
      }
    } catch {
      await setDailyAnnouncement(
        ctx.prisma,
        ctx.guildId,
        date,
        'failed',
        null,
        'TargetOrPermissionInvalid',
      );
    }
  } finally {
    running.delete(ctx.guildId);
  }
}
async function handleDailyBonus(ctx: Context, interaction: ButtonInteraction) {
  const generation = generations.get(ctx.guildId) ?? 0;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    if (process.env.DAILY_BONUS_ENABLED !== 'true') {
      await interaction.editReply('デイリーボーナスは現在準備中です。');
      return;
    }
    const answer = /^daily-bonus:answer:([0-9a-f-]{36}):([0-3])$/.exec(interaction.customId);
    const quizSession = answer
      ? await getDailyQuizSession(ctx.prisma, answer[1]!, ctx.guildId, interaction.user.id)
      : null;
    if (answer && !quizSession) {
      await interaction.editReply('この回答ボタンは期限切れ、または本人のものではありません。');
      return;
    }
    const date = quizSession?.target_date ?? interaction.customId.slice('daily-bonus:'.length);
    const originalMessage = quizSession?.announcement_message_id ?? interaction.message.id;
    const announcement = await getDailyAnnouncement(ctx.prisma, ctx.guildId, date);
    const member =
      interaction.guildId === ctx.guildId
        ? await interaction.guild?.members.fetch({ user: interaction.user.id, force: true })
        : null;
    const rejection = rejectDailyBonus({
      enabled: ctx.config.enabled,
      configuredGuildId: ctx.guildId,
      interactionGuildId: interaction.guildId,
      configuredRoleId: ctx.config.notificationRoleId,
      memberRoleIds: member ? [...member.roles.cache.keys()] : [],
      announcementMessageId: announcement?.message_id ?? '',
      interactionMessageId: originalMessage,
      announcementDate: date,
      announcementStatus: announcement?.status === 'sent' ? 'sent' : 'disabled',
      now: new Date(),
    });
    if (
      rejection ||
      announcement?.channel_id !== interaction.channelId ||
      announcement.role_id !== ctx.config.notificationRoleId
    ) {
      await interaction.editReply(
        'このボーナスは受け取れません。対象ロール・当日の通知・受取期限を確認してください。',
      );
      return;
    }
    // Deleted/foreign original announcements never authorize a private quiz response.
    const originalChannel = await interaction.guild!.channels.fetch(announcement.channel_id);
    if (
      !originalChannel?.isTextBased() ||
      !('messages' in originalChannel) ||
      !(await originalChannel.messages.fetch(originalMessage))
    ) {
      await interaction.editReply('元の通知を確認できません。');
      return;
    }
    if (!answer) {
      const status = await dailyBonusStatus(ctx.guildId, interaction.user.id);
      if (status.status === 'quiz') {
        const id = await createDailyQuizSession(
          ctx.prisma,
          ctx.guildId,
          interaction.user.id,
          date,
          originalMessage,
          status.quiz.quizId,
        );
        await interaction.editReply({
          content: `${status.quiz.question}\n最初の回答で受取が確定します。不正解でも基本報酬を受け取れます。`,
          allowedMentions: { parse: [] },
          components: [
            new ActionRowBuilder<ButtonBuilder>().addComponents(
              status.quiz.choices.map((choice, index) =>
                new ButtonBuilder()
                  .setCustomId(`daily-bonus:answer:${id}:${index}`)
                  .setLabel(choice)
                  .setStyle(ButtonStyle.Primary),
              ),
            ),
          ],
        });
        return;
      }
      if (status.status !== 'ready' && status.status !== 'confirmed') {
        await interaction.editReply(dailyBonusFailureMessage(status.status));
        return;
      }
    }
    await recordDailyClaim(ctx.prisma, ctx.guildId, interaction.user.id, date, 'pending');
    if (
      generation !== (generations.get(ctx.guildId) ?? 0) ||
      process.env.DAILY_BONUS_ENABLED !== 'true' ||
      dailyBonusDate(new Date()) !== date
    ) {
      await interaction.editReply(
        '設定または日付が変更されました。当日の通知から再確認してください。',
      );
      return;
    }
    const result = await claimDailyBonus(
      ctx.guildId,
      interaction.user.id,
      date,
      originalMessage,
      quizSession?.quiz_id ?? null,
      answer ? Number(answer[2]) : null,
    );
    if (result.status !== 'confirmed') {
      await recordDailyClaim(
        ctx.prisma,
        ctx.guildId,
        interaction.user.id,
        date,
        ['unlinked', 'profile_required', 'account_initialization_required'].includes(result.status)
          ? 'unlinked'
          : 'unavailable',
      );
      await interaction.editReply(dailyBonusFailureMessage(result.status));
      return;
    }
    await recordDailyClaim(
      ctx.prisma,
      ctx.guildId,
      interaction.user.id,
      date,
      'confirmed',
      result.receipt,
    );
    await replyDailyBonusResult(interaction, result);
    if (ctx.config.fortuneEnabled) {
      try {
        const source = await fetchIvrmFortuneProfile(ctx.guildId, interaction.user.id, date);
        const fortune = await savedDailyFortune(
          ctx.prisma,
          ctx.guildId,
          interaction.user.id,
          date,
          source.status === 'linked' ? source.profile : EMPTY_FORTUNE_PROFILE,
        );
        const card = await renderFortuneCard(fortune, interaction.user.displayName, null);
        await interaction.followUp({
          flags: MessageFlags.Ephemeral,
          allowedMentions: { parse: [] },
          files: [new AttachmentBuilder(card, { name: 'herta-fortune.png' })],
          embeds: [
            new EmbedBuilder()
              .setImage('attachment://herta-fortune.png')
              .setTitle(`🔮 ${fortune.title}`)
              .setColor(fortune.hex as `#${string}`)
              .setDescription(
                `${fortune.message}\n総合運 ${'★'.repeat(fortune.stars)}\n${fortune.action}`,
              )
              .addFields({ name: '今日のラッキー', value: `${fortune.color} / ${fortune.item}` })
              .setFooter({ text: fortune.disclaimer }),
          ],
        });
      } catch {
        await interaction.followUp({
          flags: MessageFlags.Ephemeral,
          content: 'ポイント受取は完了しています。運勢は /fortune today でもう一度確認できます。',
        });
      }
    }
  } catch {
    await interaction.editReply(
      '処理結果を確認できませんでした。同じボタンから再確認してください。重複付与はされません。',
    );
  }
}
