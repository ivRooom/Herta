import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

/**
 * The three actions remain visible while V2 is disabled.
 * V1 questions reuse the canonical claim+answer flow; neither preview nor
 * fortune interaction may claim points without an explicit answer/claim.
 */
export function dailyBonusActionRow(date: string, participationEnabled: boolean) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`daily-bonus:${date}`)
      .setLabel('🎁 ボーナスを受け取る')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(
        participationEnabled
          ? `daily-participation:questions:${date}`
          : `daily-bonus:questions:${date}`,
      )
      .setLabel('🧠 今日の問題に挑戦')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`daily-bonus:fortune:${date}`)
      .setLabel('🔮 今日の運勢')
      .setStyle(ButtonStyle.Secondary),
  );
}
