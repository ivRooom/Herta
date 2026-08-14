import type { MiniGameStats } from './mini-games-repository.js';

export function formatMiniGameStats(userId: string, stats: MiniGameStats): string {
  const coinflipRate = percentage(stats.coinflipWins, stats.coinflipPredictions);
  const blackjackRate = percentage(stats.blackjackWins, stats.blackjackPlays);
  return [
    `**🎮 <@${userId}> Mini Games Stats**`,
    `All Games: **${stats.totalPlays.toLocaleString()} plays** · **${stats.totalWins.toLocaleString()} wins**`,
    '',
    `🪙 **Coin Flip** — ${stats.coinflipPlays.toLocaleString()} flips`,
    `予想 **${stats.coinflipPredictions.toLocaleString()}回** · 的中 **${stats.coinflipWins.toLocaleString()}回** · ${coinflipRate}`,
    '',
    `🎴 **High-Low** — ${stats.highlowPlays.toLocaleString()} plays`,
    `正解Round **${stats.highlowRoundWins.toLocaleString()}** · Best **${stats.highlowBestStreak.toLocaleString()}連勝** · Perfect **${stats.highlowClears.toLocaleString()}回**`,
    '',
    `🃏 **Blackjack** — ${stats.blackjackPlays.toLocaleString()} plays`,
    `勝利 **${stats.blackjackWins.toLocaleString()}** · Push **${stats.blackjackPushes.toLocaleString()}** · Natural **${stats.blackjackNaturals.toLocaleString()}** · ${blackjackRate}`,
  ].join('\n');
}

function percentage(wins: number, total: number): string {
  if (total <= 0) return '勝率 —';
  const value = Math.round((Math.max(0, wins) / total) * 1000) / 10;
  return `勝率 **${value.toFixed(value % 1 === 0 ? 0 : 1)}%**`;
}
