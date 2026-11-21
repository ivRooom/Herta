import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

/**
 * The five actions remain visible while V2 is disabled.
 * V1 questions reuse the canonical claim+answer flow; neither preview nor
 * fortune interaction may claim points without an explicit answer/claim.
 * The yesterday review (#820) is V2-only and read-only: it never claims,
 * answers or opens a session. The quest view (#954) is read-only too: it
 * answers with the presser's own quest board, ephemerally.
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
      .setCustomId(`daily-participation:yesterday:${date}`)
      .setLabel('📚 昨日の問題')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`daily-bonus:fortune:${date}`)
      .setLabel('🔮 今日の運勢')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`daily-bonus:quests:${date}`)
      .setLabel('📋 クエストを確認')
      .setStyle(ButtonStyle.Secondary),
  );
}

/**
 * TEST sends (#723) render the same five actions with inert customIds.
 * The daily-bonus-test: prefix is handled by a dedicated branch that
 * only explains the message is a test: it can never claim, answer,
 * generate a fortune or move points.
 */
/**
 * The announcement message content (#766 Phase D3): the role
 * mention, plus the bundle video URL on its own line when the day
 * carries one (link method — Discord renders a direct video link
 * inline; the bot never downloads or attaches the file). The
 * reconcile matcher accepts both the plain mention (messages sent
 * before video existed) and the mention + video line shape, and
 * nothing else, so a tampered or unrelated message never matches.
 */
export function buildDailyBonusMessageContent(roleId: string, videoUrl: string | null): string {
  return videoUrl ? `<@&${roleId}>\n${videoUrl}` : `<@&${roleId}>`;
}

export function matchesDailyBonusMessageContent(content: string, roleId: string): boolean {
  const mention = `<@&${roleId}>`;
  if (content === mention) return true;
  if (!content.startsWith(`${mention}\n`)) return false;
  const rest = content.slice(mention.length + 1);
  if (rest.length === 0 || rest.length > 2048 || /\s/.test(rest)) return false;
  try {
    const parsed = new URL(rest);
    return parsed.protocol === 'https:' && parsed.hostname.length > 0;
  } catch {
    return false;
  }
}

export function dailyBonusTestActionRow(requestId: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`daily-bonus-test:${requestId}:claim`)
      .setLabel('🎁 ボーナスを受け取る')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`daily-bonus-test:${requestId}:questions`)
      .setLabel('🧠 今日の問題に挑戦')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`daily-bonus-test:${requestId}:yesterday`)
      .setLabel('📚 昨日の問題')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`daily-bonus-test:${requestId}:fortune`)
      .setLabel('🔮 今日の運勢')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`daily-bonus-test:${requestId}:quests`)
      .setLabel('📋 クエストを確認')
      .setStyle(ButtonStyle.Secondary),
  );
}
