import { createHash } from 'node:crypto';
import { z } from 'zod';
import { EmbedBuilder, PermissionFlagsBits, type Client } from 'discord.js';
import { request } from './daily-bonus-wallet.js';
import {
  DailyDeliveryFailureTracker,
  dailyDeliveryAlertFooter,
  dailyDeliveryAlertSender,
} from './daily-participation-alert.js';
import { anonymousDailyResult } from './daily-participation-results.js';
import {
  dailyQuizParticipationEnabled,
  loadDailyQuizStudioSettings,
} from './daily-quiz-settings.js';
const bounded = z.number().int().min(0).max(1000000);
const idPattern = /^[A-Za-z0-9_-]{1,64}$/;
const scoring = z.enum(['instant', 'poll', 'majority', 'minority', 'human_review']);
export const correctionDelivery = z
  .object({
    correctionId: z.string().regex(idPattern),
    questionId: z.string().regex(idPattern),
    deliveryToken: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
    status: z.enum(['sending', 'uncertain']),
    correction: z
      .object({
        kind: z.enum(['correct_answer', 'credit_all', 'void_all', 'explanation_only']),
        revision: z.number().int().min(1),
        reason: z.string().max(1000),
        summary: z
          .object({
            respondents: bounded,
            newlyCorrect: bounded,
            newlyIncorrect: bounded,
            grantTotal: bounded,
          })
          .strict(),
        correctOptionLabel: z.string().max(160).optional(),
        acceptedAnswers: z.array(z.string().max(500)).max(16).optional(),
        explanation: z.string().max(4000).optional(),
      })
      .strict(),
    question: z
      .object({
        dateJst: z.string().regex(/^\d{4}-\d\d-\d\d$/),
        prompt: z.string().max(2000),
        scoring,
      })
      .strict(),
    correctedResult: anonymousDailyResult.optional(),
  })
  .strict();
type CorrectionDelivery = z.infer<typeof correctionDelivery>;
const running = new Set<string>();
const failures = new Map<string, DailyDeliveryFailureTracker>();
interface Context {
  guildId: string;
  client: Client;
  config: { enabled: boolean; channelId: string; alertChannelId?: string };
  logger: { warn: (message: string) => void };
  /** Studio の daily-quiz 設定を読むために使う (未配線なら env のみで判定する)。 */
  prisma?: unknown;
}
export function dailyCorrectionEmbed(delivery: CorrectionDelivery) {
  const { correction, question } = delivery;
  const lines = [
    `${question.dateJst} の問題について、結果を訂正しました。`,
    `問題：${question.prompt}`,
  ];
  if (correction.kind === 'correct_answer') {
    lines.push(
      correction.correctOptionLabel
        ? `正解を『${correction.correctOptionLabel}』に訂正しました`
        : '正解を訂正しました',
    );
    if (correction.acceptedAnswers?.length)
      lines.push(`次の回答も正解として扱います：${correction.acceptedAnswers.join('、')}`);
  } else if (correction.kind === 'credit_all') {
    lines.push('全員正解として扱います');
  } else if (correction.kind === 'void_all') {
    lines.push('この問題は無効化されました');
  } else {
    lines.push('解説を訂正しました');
    if (correction.explanation) lines.push(correction.explanation);
  }
  lines.push(`理由：${correction.reason}`);
  if (delivery.correctedResult) {
    const result = delivery.correctedResult;
    lines.push(
      `訂正後の結果：\n${result.options.map((o) => `${o.label}：${o.percentage.toFixed(1)}%（${o.votes}票）`).join('\n')}\n参加者：${result.participantCount}人`,
    );
  }
  if (correction.summary.grantTotal > 0)
    lines.push(
      `新たに正解となった方：${correction.summary.newlyCorrect}人（追加付与：合計 ${correction.summary.grantTotal}pt）`,
    );
  return new EmbedBuilder()
    .setColor(0xb9a2ff)
    .setTitle('📊 結果の訂正のお知らせ')
    .setDescription(lines.join('\n'))
    .setFooter({ text: `daily-correction:${delivery.correctionId}` });
}
export async function scanCorrectionDeliveries(
  ctx: Context,
  isCurrent: () => boolean = () => true,
) {
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
  let sendAlert: ((footer: string) => Promise<unknown>) | undefined;
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
    sendAlert = async (footer: string) => {
      const send = await dailyDeliveryAlertSender(guild, me, ctx.config.alertChannelId, channel);
      return send(
        `⚠️ 日次問題の結果訂正の通知配信が遅延しています。管理者は管理画面の集計状態を確認してください。確定済みの受取・回答は保持されています。\n${footer}`,
      );
    };
    const raw = await request(
      ctx.guildId,
      ctx.client.user.id,
      '/v2/participation/herta/corrections',
    );
    const response = z
      .object({
        status: z.literal('ok'),
        guildId: z.string(),
        discordUserId: z.string(),
        deliveries: z.array(correctionDelivery).max(20),
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
            m.embeds.some((e) => e.footer?.text === `daily-correction:${delivery.correctionId}`),
        );
        if (matches.size !== 1) {
          ctx.logger.warn('Daily correction notification requires reconciliation');
          incomplete = true;
          continue;
        }
        messageId = matches.first()!.id;
      } else {
        const message = await channel.send({
          embeds: [dailyCorrectionEmbed(delivery)],
          allowedMentions: { parse: [] },
          nonce: createHash('sha256')
            .update(`daily-correction:${ctx.guildId}:${delivery.correctionId}`)
            .digest('hex')
            .slice(0, 25),
          enforceNonce: true,
        });
        messageId = message.id;
      }
      const ack = await request(
        ctx.guildId,
        ctx.client.user.id,
        '/v2/participation/herta/corrections/ack',
        {
          correctionId: delivery.correctionId,
          deliveryToken: delivery.deliveryToken,
          messageId,
        },
      );
      if (ack?.correctionId !== delivery.correctionId || ack?.messageId !== messageId) {
        ctx.logger.warn('Daily correction acknowledgement unconfirmed');
        incomplete = true;
      }
    }
    if (incomplete) throw Error('Daily correction reconciliation pending');
    failures.get(ctx.guildId)?.recordSuccess();
  } catch {
    ctx.logger.warn('Daily correction delivery deferred; durable state retained');
    let tracker = failures.get(ctx.guildId);
    if (!tracker) {
      tracker = new DailyDeliveryFailureTracker('corrections');
      failures.set(ctx.guildId, tracker);
    }
    const now = Date.now();
    const incident = tracker.recordFailure(now);
    if (incident && sendAlert && isCurrent()) {
      try {
        await sendAlert(dailyDeliveryAlertFooter(incident, now));
        tracker.recordAlertSent(Date.now());
      } catch {
        /* Discord outage: keep retryable state and operational log. */
      }
    }
  } finally {
    running.delete(ctx.guildId);
  }
}
