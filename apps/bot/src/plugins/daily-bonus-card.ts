import sharp from 'sharp';
import { nextDailyBonusDate, type ConfirmedDailyBonus } from './daily-bonus-presentation.js';

// Bound raster work across all Guilds. Busy renders fall back to text without queuing PII.
let activeRenders = 0;
export async function renderDailyBonusCard(result: ConfirmedDailyBonus): Promise<Buffer> {
  if (activeRenders >= 2) throw new Error('DailyBonusCardBusy');
  activeRenders++;
  try {
    const { receipt, balance, alreadyClaimed } = result;
    const total =
      receipt.rewardPoints +
      (receipt.streakReward?.points ?? 0) +
      (receipt.firstClaimReward?.points ?? 0);
    const escape = (value: string) =>
      value.replace(
        /[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!,
      );
    const text = (value: string, x: number, y: number, size = 26, color = '#e9e7f5') =>
      `<text x="${x}" y="${y}" font-size="${size}" fill="${color}">${escape(value)}</text>`;
    // Fixed layout, no remote assets or user names; same dark/lavender palette as fortune-card.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="730">
      <rect width="1000" height="730" rx="32" fill="#101620"/>
      <rect x="22" y="22" width="956" height="686" rx="24" fill="none" stroke="#b9a2ff" stroke-width="2"/>
      <g font-family="Noto Sans CJK JP, Noto Sans JP, Yu Gothic, sans-serif">
      ${text('HERTA  /  DAILY BONUS', 58, 78, 24, '#b9a2ff')}
      ${text(receipt.claimDateJst, 730, 78, 24)}
      ${text(alreadyClaimed ? '本日は受取済みです' : 'ボーナスを受け取りました！', 58, 144, 34)}
      <rect x="48" y="180" width="440" height="158" rx="20" fill="#242638"/>
      <rect x="510" y="180" width="440" height="158" rx="20" fill="#242638"/>
      ${text('本日の獲得', 76, 225, 24, '#abb7c9')}
      ${text(`${total.toLocaleString('ja-JP')} pt`, 76, 300, 52, '#b9a2ff')}
      ${text('現在の保有ポイント', 538, 225, 24, '#abb7c9')}
      ${text(`${balance.toLocaleString('ja-JP')} pt`, 538, 300, Math.min(44, Math.floor(560 / `${balance.toLocaleString('ja-JP')} pt`.length)))}
      ${text(`連続ログイン  ${receipt.streakDay.toLocaleString('ja-JP')} 日`, 58, 398, 32)}
      ${text(`連続ボーナス：${receipt.streakReward ? `+${receipt.streakReward.points} pt 獲得済み` : '本日の追加報酬なし'}`, 58, 451)}
      ${text(receipt.firstClaimReward ? `本日の受取順位：${receipt.firstClaimReward.rank}位 / 一番乗り：${receipt.firstClaimReward.points > 0 ? `+${receipt.firstClaimReward.points} pt 獲得` : '対象外'}` : '一番乗りボーナス：本日の追加報酬なし', 58, 498)}
      <path d="M58 535 H942" stroke="#b9a2ff" stroke-opacity="0.4"/>
      ${text('次回の受取', 58, 582, 24, '#b9a2ff')}
      ${text(`${nextDailyBonusDate(receipt.claimDateJst)} 00:00 JST（Member）`, 58, 623, 26)}
      ${text('Discordは09:00 JSTの当日通知後に受け取れます', 58, 666, 24, '#abb7c9')}
      </g></svg>`;
    return await sharp(Buffer.from(svg)).png().toBuffer();
  } finally {
    activeRenders--;
  }
}
