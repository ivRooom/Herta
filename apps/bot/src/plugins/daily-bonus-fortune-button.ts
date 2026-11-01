import { MessageFlags, type ButtonInteraction, type Client } from 'discord.js';
import { getDailyAnnouncement, type PrismaClient } from '@herta/db';
import { rejectDailyBonus } from './daily-bonus-policy.js';
import { participationFortune } from './daily-participation-fortune.js';

const fortuneButtonPattern = /^daily-bonus:fortune:(\d{4}-\d{2}-\d{2})$/;

export function isDailyBonusFortuneButton(customId: string): boolean {
  return fortuneButtonPattern.test(customId);
}

export async function handleDailyBonusFortune(
  ctx: {
    guildId: string;
    prisma: PrismaClient;
    client: Client;
    config: { enabled: boolean; notificationRoleId: string; fortuneEnabled: boolean };
  },
  interaction: ButtonInteraction,
  isCurrent: () => boolean = () => true,
) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const date = fortuneButtonPattern.exec(interaction.customId)?.[1];
    if (
      !date ||
      !ctx.config.fortuneEnabled ||
      !ctx.config.enabled ||
      process.env.DAILY_BONUS_ENABLED !== 'true' ||
      !isCurrent()
    ) {
      await interaction.editReply('今日の運勢は現在利用できません。');
      return;
    }

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
      interactionMessageId: interaction.message.id,
      announcementDate: date,
      announcementStatus: announcement?.status === 'sent' ? 'sent' : 'disabled',
      now: new Date(),
    });
    if (
      rejection ||
      announcement?.channel_id !== interaction.channelId ||
      announcement?.role_id !== ctx.config.notificationRoleId
    ) {
      await interaction.editReply('当日の通知・対象ロール・有効期限を確認してください。');
      return;
    }

    // Prevent a foreign/deleted message from triggering a private result.
    const channel = await interaction.guild!.channels.fetch(announcement.channel_id);
    if (!channel?.isTextBased() || !('messages' in channel))
      throw new Error('Missing daily announcement channel');
    const original = await channel.messages.fetch(interaction.message.id);
    if (original.author.id !== ctx.client.user?.id) throw new Error('Foreign daily announcement');

    if (
      !isCurrent() ||
      !ctx.config.fortuneEnabled ||
      process.env.DAILY_BONUS_ENABLED !== 'true'
    ) {
      await interaction.editReply('今日の運勢は現在利用できません。');
      return;
    }
    await interaction.editReply({
      content: '🔮 今日の運勢を表示します。',
      allowedMentions: { parse: [] },
    });
    // Read-only fortune flow: never invoke the daily claim/wallet mutation.
    await participationFortune(ctx, interaction, date);
  } catch {
    await interaction.editReply(
      '今日の運勢を確認できませんでした。/fortune today から再試行してください。',
    );
  }
}
