import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

/** Only expose an action when its server-side handler is enabled. */
export function dailyBonusButtonRow(
  date: string,
  options: { participationEnabled: boolean; fortuneEnabled: boolean },
) {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`daily-bonus:${date}`)
      .setLabel('🎁 ボーナスを受け取る')
      .setStyle(ButtonStyle.Primary),
  );
  if (options.participationEnabled) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`daily-participation:questions:${date}`)
        .setLabel('🧠 今日の問題に挑戦')
        .setStyle(ButtonStyle.Secondary),
    );
  }
  if (options.fortuneEnabled) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`daily-bonus:fortune:${date}`)
        .setLabel('🔮 今日の運勢を見る')
        .setStyle(ButtonStyle.Secondary),
    );
  }
  return row;
}
