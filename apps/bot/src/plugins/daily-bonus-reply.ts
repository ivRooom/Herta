import { AttachmentBuilder, EmbedBuilder, type ButtonInteraction } from 'discord.js';
import { renderDailyBonusCard } from './daily-bonus-card.js';
import {
  dailyBonusResultText,
  loginBonusEarned,
  dailyFirstClaimLabel,
  type ConfirmedDailyBonus,
} from './daily-bonus-presentation.js';

export async function replyDailyBonusResult(
  interaction: Pick<ButtonInteraction, 'editReply'>,
  result: ConfirmedDailyBonus,
  render = renderDailyBonusCard,
) {
  const loginTotal = loginBonusEarned(result);
  const fallback = {
    content: dailyBonusResultText(result),
    embeds: [
      new EmbedBuilder()
        .setColor(0xb9a2ff)
        .setTitle(
          result.alreadyClaimed
            ? '🎁 本日のログインボーナス（受取済み）'
            : '🎁 ログインボーナス獲得！',
        )
        .addFields(
          {
            name: 'ログイン関連獲得ポイント',
            value: `+${loginTotal.toLocaleString('ja-JP')}pt`,
            inline: true,
          },
          {
            name: 'ログイン基本分',
            value: `+${result.receipt.rollPoints}pt`,
            inline: true,
          },
          ...(result.receipt.quizCorrect != null || result.receipt.quizBonusPoints > 0
            ? [
                {
                  name: 'クイズ正解追加（別枠）',
                  value: `+${result.receipt.quizBonusPoints}pt`,
                  inline: true,
                },
              ]
            : []),
          {
            name: '現在の保有ポイント',
            value: `${result.balance.toLocaleString('ja-JP')}pt`,
            inline: true,
          },
          {
            name: '連続ログイン',
            value: `${result.receipt.streakDay.toLocaleString('ja-JP')}日`,
            inline: true,
          },
          {
            name: '本日の受取順位・追加報酬',
            value: dailyFirstClaimLabel(result.receipt.firstClaimReward),
            inline: false,
          },
        )
        .setFooter({
          text: `受取日 ${result.receipt.claimDateJst} JST ・ 問題の回答は「今日の問題に挑戦」から`,
        }),
    ],
    components: [],
    allowedMentions: { parse: [] as never[] },
  };
  if (process.env.DAILY_BONUS_RESULT_CARD_ENABLED === 'true') {
    try {
      const card = await render(result);
      await interaction.editReply({
        ...fallback,
        embeds: [],
        files: [new AttachmentBuilder(card, { name: 'herta-daily-bonus.png' })],
      });
      return;
    } catch {
      // The canonical claim is committed. Retry only presentation, never the award.
      await interaction.editReply({ ...fallback, files: [], attachments: [] });
      return;
    }
  }
  await interaction.editReply(fallback);
}
