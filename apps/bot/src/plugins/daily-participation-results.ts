import { createHash } from 'node:crypto';
import { z } from 'zod';
import { EmbedBuilder, PermissionFlagsBits, type Client } from 'discord.js';
import { request } from './daily-bonus-wallet.js';
const bounded = z.number().int().min(0).max(1000000);
export const anonymousDailyResult = z
  .object({
    questionId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    dateJst: z.string().regex(/^\d{4}-\d\d-\d\d$/),
    prompt: z.string().max(2000),
    scoring: z.enum(['poll', 'majority', 'minority']),
    state: z.enum(['finalized', 'void']),
    participantCount: bounded,
    finalizedAt: z.string().datetime(),
    options: z
      .array(
        z
          .object({
            optionId: z.string(),
            label: z.string().max(160),
            votes: bounded,
            percentage: z.number().min(0).max(100),
            winner: z.boolean(),
          })
          .strict(),
      )
      .min(2)
      .max(4),
  })
  .strict()
  .refine((r) => r.options.reduce((sum, o) => sum + o.votes, 0) === r.participantCount);
const deliverySchema = z
  .object({
    questionId: z.string(),
    result: anonymousDailyResult,
    deliveryToken: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
    status: z.enum(['sending', 'uncertain']),
  })
  .strict();
const running = new Set<string>();
const failures = new Map<string, { count: number; lastAlert: number }>();
interface Context {
  guildId: string;
  client: Client;
  config: { enabled: boolean; channelId: string };
  logger: { warn: (message: string) => void };
}
export function dailyResultEmbed(result: z.infer<typeof anonymousDailyResult>) {
  return new EmbedBuilder()
    .setColor(0xb9a2ff)
    .setTitle('📊 昨日の問題の結果')
    .setDescription(
      `問題：${result.prompt}\n\n${result.options.map((o) => `${o.label}：${o.percentage.toFixed(1)}%（${o.votes}票）`).join('\n')}\n\n参加者：${result.participantCount}人${result.state === 'void' ? '\n最低参加条件などにより報酬対象外です。' : ''}`,
    )
    .setFooter({ text: `daily-result:${result.questionId}` });
}
export async function scanParticipationResults(
  ctx: Context,
  isCurrent: () => boolean = () => true,
) {
  if (
    process.env.DAILY_PARTICIPATION_ENABLED !== 'true' ||
    process.env.DAILY_BONUS_ENABLED !== 'true' ||
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
          '⚠️ 日次問題の集計・結果配信が遅延しています。管理者は管理画面の集計状態を確認してください。確定済みの受取・回答は保持されています。',
        allowedMentions: { parse: [] },
      });
    const raw = await request(ctx.guildId, ctx.client.user.id, '/v2/participation/herta/results');
    const response = z
      .object({
        status: z.literal('ok'),
        guildId: z.string(),
        discordUserId: z.string(),
        deliveries: z.array(deliverySchema).max(20),
      })
      .strict()
      .parse(raw);
    for (const delivery of response.deliveries) {
      if (
        delivery.questionId !== delivery.result.questionId ||
        !isCurrent() ||
        process.env.DAILY_PARTICIPATION_ENABLED !== 'true'
      )
        return;
      let messageId: string | undefined;
      if (delivery.status === 'uncertain') {
        const history = await channel.messages.fetch({ limit: 100 });
        const matches = history.filter(
          (m) =>
            m.author.id === ctx.client.user!.id &&
            m.embeds.some((e) => e.footer?.text === `daily-result:${delivery.questionId}`),
        );
        if (matches.size !== 1) {
          ctx.logger.warn('Daily result notification requires reconciliation');
          continue;
        }
        messageId = matches.first()!.id;
      } else {
        const message = await channel.send({
          embeds: [dailyResultEmbed(delivery.result)],
          allowedMentions: { parse: [] },
          nonce: createHash('sha256')
            .update(`daily-result:${ctx.guildId}:${delivery.questionId}`)
            .digest('hex')
            .slice(0, 25),
          enforceNonce: true,
        });
        messageId = message.id;
      }
      const ack = await request(
        ctx.guildId,
        ctx.client.user.id,
        '/v2/participation/herta/results/ack',
        {
          questionId: delivery.questionId,
          deliveryToken: delivery.deliveryToken,
          messageId,
        },
      );
      if (ack?.questionId !== delivery.questionId || ack?.messageId !== messageId)
        ctx.logger.warn('Daily result acknowledgement unconfirmed');
    }
    failures.delete(ctx.guildId);
  } catch {
    ctx.logger.warn('Daily result delivery deferred; durable state retained');
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
