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
import {
  DailyDeliveryFailureTracker,
  dailyDeliveryAlertFooter,
  dailyDeliveryAlertSender,
} from './daily-participation-alert.js';
import { dailyBonusAllowedMentions } from './daily-bonus-policy.js';
import {
  dailyQuizParticipationEnabled,
  loadDailyQuizStudioSettings,
} from './daily-quiz-settings.js';
const idPattern = /^[A-Za-z0-9_-]{1,64}$/;
const id = z.string().regex(idPattern);
const instant = z.string().datetime();
const text = (max: number) => z.string().refine((s) => Array.from(s).length <= max);
const jstDate = z
  .string()
  .regex(/^\d{4}-\d\d-\d\d$/)
  .refine((s) => Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s);
const media = z
  .object({
    id,
    kind: z.enum(['image', 'audio']),
    mimeType: z.enum([
      'image/png',
      'image/jpeg',
      'image/webp',
      'audio/mpeg',
      'audio/ogg',
      'audio/wav',
    ]),
    url: z
      .string()
      .url()
      .max(2048)
      .refine((value) => new URL(value).protocol === 'https:'),
    byteSize: z.number().int().min(1).max(10485760),
    durationMs: z.number().int().min(1).max(30000).nullable(),
    rights: z.enum(['original', 'licensed', 'public_domain']),
  })
  .strict();
// Mirrors publicDailyQuestion in daily-participation-client.ts (post-#917),
// kept local so this PR is independent of #919's merge order.
export const rescueQuestion = z
  .object({
    id,
    dateJst: jstDate,
    slot: z.enum(['daily', 'bonus', 'rescue']),
    categoryId: id,
    themeId: id,
    format: z.enum(['choice2', 'choice3', 'choice4', 'image_choice', 'audio_choice', 'free_text']),
    scoring: z.enum(['instant', 'poll', 'majority', 'minority', 'human_review']),
    prompt: text(1000).refine((s) => s.trim().length > 0),
    options: z
      .array(
        z
          .object({
            id,
            label: text(80).refine((s) => s.trim().length > 0),
            mediaId: id.nullable(),
          })
          .strict(),
      )
      .max(4),
    media: z.array(media).max(5),
    closesAt: instant,
    requiresClaim: z.boolean(),
    maxTextLength: z.number().int().min(1).max(1000),
  })
  .strict()
  .refine((q) => {
    const count = { choice2: 2, choice3: 3, choice4: 4, free_text: 0 }[
      q.format as 'choice2' | 'choice3' | 'choice4' | 'free_text'
    ];
    return (
      (count === undefined ? q.options.length >= 2 : q.options.length === count) &&
      new Set(q.options.map((o) => o.id)).size === q.options.length &&
      new Set(q.media.map((m) => m.id)).size === q.media.length &&
      q.options.every((o) => o.mediaId === null || q.media.some((m) => m.id === o.mediaId))
    );
  });
export const rescueDelivery = z
  .object({
    questionId: z.string().regex(idPattern),
    deliveryToken: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
    status: z.enum(['sending', 'uncertain']),
    question: rescueQuestion,
  })
  .strict();
type RescueDelivery = z.infer<typeof rescueDelivery>;
const running = new Set<string>();
const failures = new Map<string, DailyDeliveryFailureTracker>();
interface Context {
  guildId: string;
  client: Client;
  config: {
    enabled: boolean;
    channelId: string;
    notificationRoleId: string;
    alertChannelId?: string;
  };
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
        `⚠️ 追加問題の告知配信が遅延しています。管理者は管理画面の集計状態を確認してください。確定済みの受取・回答は保持されています。\n${footer}`,
      );
    };
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
    failures.get(ctx.guildId)?.recordSuccess();
  } catch {
    ctx.logger.warn('Daily rescue delivery deferred; durable state retained');
    let tracker = failures.get(ctx.guildId);
    if (!tracker) {
      tracker = new DailyDeliveryFailureTracker('rescue');
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
