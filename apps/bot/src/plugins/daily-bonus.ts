import { createHash } from 'node:crypto';
import {
  AttachmentBuilder,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  type Client,
  type ButtonInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import {
  getDailyAnnouncement,
  reserveDailyAnnouncement,
  captureDailyAnnouncementPopulation,
  setDailyAnnouncement,
  listAnniversaries,
  recordDailyClaim,
  type PrismaClient,
} from '@herta/db';
import { dailyBonusManifest } from '@herta/plugin-catalog';
import { definePlugin, type PluginRuntimeContext } from '@herta/plugin-sdk';
import {
  dailyBonusCalendarDate,
  dailyBonusDate,
  dailyBonusAllowedMentions,
  rejectDailyBonus,
} from './daily-bonus-policy.js';
import { captureDailyBonusPopulation } from './daily-bonus-population.js';
import { selectAnniversaries } from './daily-bonus-content.js';
import { EMPTY_FORTUNE_PROFILE } from './fortune-core.js';
import { fetchIvrmFortuneProfile } from './fortune-ivrm-profile.js';
import { claimDailyBonus, dailyBonusStatus, type DailyWalletResult } from './daily-bonus-wallet.js';
import { savedDailyFortune } from './daily-fortune.js';
import { renderFortuneCard } from './fortune-card.js';
import { handleDailyParticipation, isParticipationInteraction } from './daily-participation.js';
import { scanParticipationResults } from './daily-participation-results.js';
import {
  dailyQuizParticipationEnabled,
  loadDailyQuizStudioSettings,
} from './daily-quiz-settings.js';
import { replyDailyBonusResult } from './daily-bonus-reply.js';
import { dailyAnniversaryHeading, dailyBonusFailureMessage } from './daily-bonus-presentation.js';
import { dailyBonusActionRow } from './daily-bonus-buttons.js';
import {
  dailySupportActionRow,
  dailySupportFailureClass,
  handleDailySupportNotify,
  isDailySupportInteraction,
  type DailySupportFailureClass,
} from './daily-support.js';

interface Config {
  enabled: boolean;
  channelId: string;
  notificationRoleId: string;
  supportChannelId: string;
  supportRoleId: string;
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
          const interaction = args[0] as ButtonInteraction | ModalSubmitInteraction | undefined;
          if (interaction?.isButton() && isDailySupportInteraction(interaction.customId)) {
            await handleDailySupportNotify(ctx, interaction);
            return;
          }
          if (
            interaction &&
            (interaction.isButton() || interaction.isModalSubmit()) &&
            (interaction.customId.startsWith('daily-participation:') ||
              (isParticipationInteraction(interaction) &&
                dailyQuizParticipationEnabled(
                  await loadDailyQuizStudioSettings(ctx.prisma, ctx.guildId),
                )))
          ) {
            const activeGeneration = generations.get(ctx.guildId) ?? 0;
            await handleDailyParticipation(
              ctx,
              interaction,
              () => activeGeneration === (generations.get(ctx.guildId) ?? 0),
            );
            return;
          }
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
  // Announcements are created for the calendar day whose 09:00 JST opens
  // the slot; admission (dailyBonusDate) is slot-based, creation is not.
  const date = dailyBonusCalendarDate(now);
  const resultGeneration = generations.get(ctx.guildId) ?? 0;
  await scanParticipationResults(
    ctx,
    () => resultGeneration === (generations.get(ctx.guildId) ?? 0),
  );
  if (resultGeneration !== (generations.get(ctx.guildId) ?? 0)) return;
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
          `${ctx.config.messageTemplate}\n\n下のボタンで共通ログインボーナスを受け取れます。\n付与額・連続日数はメンバーポータルと共通です。\n受取期限：翌日09:00 JST`,
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
        dailyBonusCalendarDate(new Date()) !== date
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
            dailyBonusActionRow(
              date,
              dailyQuizParticipationEnabled(
                await loadDailyQuizStudioSettings(ctx.prisma, ctx.guildId),
              ),
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
/**
 * Claim failure replies gain the support escalation row (#896) when the
 * failure is a service-side one the member cannot resolve alone. Setup
 * states keep their plain self-service guidance.
 */
async function replyClaimFailure(
  ctx: Context,
  interaction: ButtonInteraction,
  status: DailyWalletResult['status'],
  date: string,
  failureClass: DailySupportFailureClass | null = dailySupportFailureClass(status),
) {
  const content = dailyBonusFailureMessage(status);
  if (!failureClass) {
    await interaction.editReply(content);
    return;
  }
  await interaction.editReply({
    content,
    components: [dailySupportActionRow({ kind: 'claim', failureClass, target: date }, ctx.config)],
  });
}

async function handleDailyBonus(ctx: Context, interaction: ButtonInteraction) {
  const generation = generations.get(ctx.guildId) ?? 0;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    if (process.env.DAILY_BONUS_ENABLED !== 'true') {
      await interaction.editReply('デイリーボーナスは現在準備中です。');
      return;
    }
    // Legacy V1 quiz answers used to claim login points as a side effect.
    // Never revive this combined flow on old ephemeral messages.
    if (/^daily-bonus:answer:[0-9a-f-]{36}:[0-3]$/.test(interaction.customId)) {
      await interaction.editReply(
        '旧方式の回答は終了しました。新しい「今日の問題に挑戦」から回答してください。',
      );
      return;
    }
    const auxiliary = /^daily-bonus:(questions|fortune):(\d{4}-\d{2}-\d{2})$/.exec(
      interaction.customId,
    );
    const date = auxiliary?.[2] ?? interaction.customId.slice('daily-bonus:'.length);
    const originalMessage = interaction.message.id;
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
    if (auxiliary?.[1] === 'fortune') {
      if (!ctx.config.fortuneEnabled) {
        await interaction.editReply('今日の運勢は現在無効です。');
        return;
      }
      try {
        await displayDailyFortune(ctx, interaction, date);
      } catch {
        await interaction.editReply(
          '運勢を表示できませんでした。/fortune today から再確認できます。',
        );
      }
      return;
    }
    if (auxiliary?.[1] === 'questions') {
      // V1 answer calls still award a combined login+quiz transaction.
      // The independent quiz entrypoint is participation v2 only.
      await interaction.editReply(
        'この通知の旧方式クイズは利用できません。新しい日次参加が有効になるまで回答は受け付けません。',
      );
      return;
    }
    const status = await dailyBonusStatus(ctx.guildId, interaction.user.id);
    if (status.status !== 'quiz' && status.status !== 'ready' && status.status !== 'confirmed') {
      await replyClaimFailure(ctx, interaction, status.status, date);
      return;
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
    // Paired with Web #862: only a null/null claim skips the legacy quiz.
    // No daily question or fortune may be awarded by this button.
    const result = await claimDailyBonus(ctx.guildId, interaction.user.id, date, originalMessage);
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
      await replyClaimFailure(ctx, interaction, result.status, date);
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
    await replyDailyBonusResult(
      interaction,
      result,
      undefined,
      await loadDailyQuizStudioSettings(ctx.prisma, ctx.guildId),
    );
  } catch {
    const content =
      '処理結果を確認できませんでした。同じボタンから再確認してください。重複付与はされません。';
    const failedDate = /(\d{4}-\d{2}-\d{2})/.exec(interaction.customId)?.[1];
    if (!failedDate) {
      await interaction.editReply(content);
      return;
    }
    await interaction.editReply({
      content,
      components: [
        dailySupportActionRow(
          { kind: 'claim', failureClass: 'unexpected', target: failedDate },
          ctx.config,
        ),
      ],
    });
  }
}

async function displayDailyFortune(ctx: Context, interaction: ButtonInteraction, date: string) {
  const source = await fetchIvrmFortuneProfile(ctx.guildId, interaction.user.id, date);
  const fortune = await savedDailyFortune(
    ctx.prisma,
    ctx.guildId,
    interaction.user.id,
    date,
    source.status === 'linked' ? source.profile : EMPTY_FORTUNE_PROFILE,
  );
  const card = await renderFortuneCard(fortune, interaction.user.displayName, null);
  const payload = {
    allowedMentions: { parse: [] as [] },
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
  };
  await interaction.editReply(payload);
}
