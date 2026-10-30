import { AttachmentBuilder, type ButtonInteraction } from 'discord.js';
import { renderDailyBonusCard } from './daily-bonus-card.js';
import { dailyBonusResultText, type ConfirmedDailyBonus } from './daily-bonus-presentation.js';

export async function replyDailyBonusResult(
  interaction: Pick<ButtonInteraction, 'editReply'>,
  result: ConfirmedDailyBonus,
  render = renderDailyBonusCard,
) {
  const fallback = {
    content: dailyBonusResultText(result),
    components: [],
    allowedMentions: { parse: [] as never[] },
  };
  if (process.env.DAILY_BONUS_RESULT_CARD_ENABLED === 'true') {
    try {
      const card = await render(result);
      await interaction.editReply({
        ...fallback,
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
