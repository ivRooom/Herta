import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
  type Client,
} from 'discord.js';
import { request } from './daily-bonus-wallet.js';
import { dailyBonusAllowedMentions } from './daily-bonus-policy.js';
import {
  dailyQuizParticipationEnabled,
  loadDailyQuizStudioSettings,
} from './daily-quiz-settings.js';
const idPattern = /^[A-Za-z0-9_-]{1,64}$/;
export const rescueDelivery = z
  .object({
    questionId: z.string().regex(idPattern),
    deliveryToken: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
    status: z.enum(['sending', 'uncertain']),
    question: z
      .object({
        dateJst: z.string().regex(/^\d{4}-\d\d-\d\d$/),
        prompt: z.string().max(2000),
        options: z
          .array(
            z
              .object({
                id: z.string(),
                label: z.string().max(160),
              })
              .strict(),
          )
          .max(8),
        scoring: z.enum(['instant', 'poll', 'majority', 'minority', 'human_review']),
        closesAt: z.string().datetime(),
      })
      .strict(),
  })
  .strict();
type RescueDelivery = z.infer<typeof rescueDelivery>;
const running = new Set<string>();
const failures = new Map<string, { count: number; lastAlert: number }>();
interface Context {
  guildId: string;
  client: Client;
  config: { enabled: boolean; channelId: string; notificationRoleId: string };
  logger: { warn: (message: string) => void };
  /** Studio の daily-quiz 設定を読むために使う (未配線なら env のみで判定する)。 */
  prisma?: unknown;
}
export function dailyRescueEmbed(delivery: RescueDelivery) {
  const { question } = delivery;
  const closesAtUnix = Math.floor(Date.parse(question.closesAt) / 1000);
  const lines = [`問題：${question.prompt}`];
  if (question.options.length) lines.push(question.options.map((o) => `・${o.label}`).join('\n'));
  lines.push(`締切：<t:${closesAtUnix}:F> まで`);
  lines.push(
    '回答は今朝のログインボーナス通知の『今日の問題に挑戦』ボタン、または Member ページからできます',
  );
  return new EmbedBuilder()
    .setColor(0xb9a2ff)
    .setTitle('🆘 追加問題のお知らせ')
    .setDescription(lines.join('\n'))
    .setFooter({ text: `daily-rescue:${delivery.questionId}` });
}
export function dailyRescueActionRow() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setURL('https://member.ivrm.jp/participation')
      .setLabel('Member ページで回答する')
      .setStyle(ButtonStyle.Link),
  );
}
export async function scanRescueAnnouncements(ctx: Context, isCurrent: () => boolean = () => true) {
  if (
    !dailyQuizParticipationEnabled(await loadDailyQuizStudioSettings(ctx.prisma, ctx.guildId)) ||
    process.env.DAILY_BONUS_ENABLED !== 'true' ||
    process.env.IVRM_INTEGRATION_GUILD_ID !== ctx.guildId ||
    !ctx.config.enabled ||
    !ctx.client.user ||
    running.has(ctx.guildId)
  )
    return;
  running.add(ctx.guildId);
  let sendAlert: (() => Promise<unknown>) | undefined;
  try {
    const guild = await ctx.client.guilds.fetch(ctx.guildId),
      channel = await guild.channels.fetch(ctx.config.channelId);
    const me = await guild.members.fetchMe();
    if (
      !channel?.isTextBased() ||
      channel.isThread() ||
      !('send' in channel) ||
      !channel
        .permissionsFor(me)
        ?.has([
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.EmbedLinks,
          PermissionFlagsBits.ReadMessageHistory,
        ])
    )
      return;
    if (!isCurrent()) return;
    sendAlert = () =>
      channel.send({
        content:
          '⚠️ 追加問題の告知配信が遅延しています。管理者は管理画面の集計状態を確認してください。確定済みの受取・回答は保持されています。',
        allowedMentions: { parse: [] },
      });
    const raw = await request(ctx.guildId, ctx.client.user.id, '/v2/participation/herta/rescue');
    const response = z
      .object({
        status: z.literal('ok'),
        guildId: z.string(),
        discordUserId: z.string(),
        deliveries: z.array(rescueDelivery).max(20),
      })
      .strict()
      .parse(raw);
    let incomplete = false;
    for (const delivery of response.deliveries) {
      if (
        !isCurrent() ||
        !dailyQuizParticipationEnabled(await loadDailyQuizStudioSettings(ctx.prisma, ctx.guildId))
      )
        return;
      let messageId: string | undefined;
      if (delivery.status === 'uncertain') {
        const history = await channel.messages.fetch({ limit: 100 });
        const matches = history.filter(
          (m) =>
            m.author.id === ctx.client.user!.id &&
            m.embeds.some((e) => e.footer?.text === `daily-rescue:${delivery.questionId}`),
        );
        if (matches.size !== 1) {
          ctx.logger.warn('Daily rescue announcement requires reconciliation');
          incomplete = true;
          continue;
        }
        messageId = matches.first()!.id;
      } else {
        const message = await channel.send({
          content: `<@&${ctx.config.notificationRoleId}>`,
          embeds: [dailyRescueEmbed(delivery)],
          components: [dailyRescueActionRow()],
          allowedMentions: dailyBonusAllowedMentions(ctx.config.notificationRoleId),
          nonce: createHash('sha256')
            .update(`daily-rescue:${ctx.guildId}:${delivery.questionId}`)
            .digest('hex')
            .slice(0, 25),
          enforceNonce: true,
        });
        messageId = message.id;
      }
      const ack = await request(
        ctx.guildId,
        ctx.client.user.id,
        '/v2/participation/herta/rescue/ack',
        {
          questionId: delivery.questionId,
          deliveryToken: delivery.deliveryToken,
          messageId,
        },
      );
      if (ack?.questionId !== delivery.questionId || ack?.messageId !== messageId) {
        ctx.logger.warn('Daily rescue acknowledgement unconfirmed');
        incomplete = true;
      }
    }
    if (incomplete) throw Error('Daily rescue reconciliation pending');
    const priorFailure = failures.get(ctx.guildId);
    if (priorFailure) failures.set(ctx.guildId, { count: 0, lastAlert: priorFailure.lastAlert });
  } catch {
    ctx.logger.warn('Daily rescue delivery deferred; durable state retained');
    const state = failures.get(ctx.guildId) ?? { count: 0, lastAlert: 0 };
    state.count++;
    if (state.count >= 3 && Date.now() - state.lastAlert > 900000 && sendAlert && isCurrent()) {
      try {
        await sendAlert();
        state.lastAlert = Date.now();
      } catch {
        /* Discord outage: keep retryable state and operational log. */
      }
    }
    failures.set(ctx.guildId, state);
  } finally {
    running.delete(ctx.guildId);
  }
}
