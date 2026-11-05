import type { DailyWalletResult } from './daily-bonus-wallet.js';

export type ConfirmedDailyBonus = Extract<DailyWalletResult, { status: 'confirmed' }>;

export function dailyBonusFailureMessage(status: DailyWalletResult['status']): string {
  if (status === 'profile_required')
    return '**🎁 ボーナスを受け取るには初回登録が必要です**\n\nまだivRooomのプロフィールが作成されていません。\n\n以下のMemberページに一度アクセスし、Discordアカウントでログインしてください。\nhttps://member.ivrm.jp/\n\n登録完了後、Discordに戻ってボーナスを受け取れます。';
  if (status === 'account_initialization_required')
    return 'プロフィールは登録済みですが、ポイント口座の初期設定が必要です。MemberページにDiscordアカウントでログインし、ポイント表示を確認してから再度お試しください。\nhttps://member.ivrm.jp/login-bonus';
  if (status === 'unlinked')
    return 'ポイント口座の連携・整合性を確認できません。初回登録の問題とは限らないため、管理者へお問い合わせください。';
  return 'ポイント連携・付与結果を確認できませんでした。時間をおいて同じボタンから再確認してください。';
}

/** The canonical Member claim opens at JST midnight; Discord opens after the next announcement. */
export function nextDailyBonusDate(date: string): string {
  const next = new Date(`${date}T00:00:00+09:00`);
  next.setTime(next.getTime() + 86_400_000);
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(next);
}

/** Display confirmed global claim rank without inventing a position for legacy receipts. */
export function dailyFirstClaimLabel(
  first: ConfirmedDailyBonus['receipt']['firstClaimReward'],
): string {
  if (!first) return '受取順位：記録なし / 追加報酬なし';
  const position =
    first.rank === 1
      ? '🥇 1番乗り'
      : first.rank === 2
        ? '🥈 2番乗り'
        : first.rank === 3
          ? '🥉 3番乗り'
          : `受取順位：${first.rank}位`;
  return `${position} / ${first.points > 0 ? `追加報酬 +${first.points}pt` : '追加報酬なし'}`;
}

/** Never count the legacy combined quiz award as a login bonus. */
export function loginBonusEarned(result: ConfirmedDailyBonus): number {
  return (
    result.receipt.rollPoints +
    (result.receipt.streakReward?.points ?? 0) +
    (result.receipt.firstClaimReward?.points ?? 0)
  );
}

export function dailyBonusResultText(result: ConfirmedDailyBonus): string {
  const receipt = result.receipt;
  const parts = [
    result.alreadyClaimed
      ? '🎉 本日のログインボーナスは受取済みです。'
      : '🎉 ログインボーナスを受け取りました！',
    `ログイン基本分：+${receipt.rollPoints}pt / ログイン関連合計：+${loginBonusEarned(result)}pt`,
    `保有：${result.balance}pt / 連続：${receipt.streakDay}日`,
    `連続ログイン追加：+${receipt.streakReward?.points ?? 0}pt`,
    dailyFirstClaimLabel(receipt.firstClaimReward),
  ];
  if (receipt.quizBonusPoints > 0) {
    parts.push(
      `過去の結合取引に含まれるクイズ正解追加：+${receipt.quizBonusPoints}pt（上記ログイン関連合計には含みません）`,
    );
  }
  return `${parts.join('\\n')}\\n次回受取：${nextDailyBonusDate(receipt.claimDateJst)} 00:00 JST（Member）／09:00 JSTの通知後（Discord）\\nhttps://member.ivrm.jp/login-bonus`;
}

/** Empty days do not fabricate anniversaries. Source URLs and annual calculations stay in selection. */
export function dailyAnniversaryHeading(count: number): string {
  return count > 0 ? '📅 今日は何の日？' : '';
}
