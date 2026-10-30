import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { renderDailyBonusCard } from './daily-bonus-card.js';
import {
  dailyBonusFailureMessage,
  dailyBonusResultText,
  nextDailyBonusDate,
  type ConfirmedDailyBonus,
} from './daily-bonus-presentation.js';

const result: ConfirmedDailyBonus = {
  status: 'confirmed',
  alreadyClaimed: true,
  balance: 320,
  message: '本日は受取済みです。',
  receipt: {
    claimDateJst: '2026-10-30',
    rewardPoints: 44,
    rollPoints: 34,
    quizBonusPoints: 10,
    streakDay: 3,
    channel: 'discord',
  },
};
describe('private daily bonus presentation', () => {
  it('renders a bounded PNG from the canonical receipt', async () => {
    const card = await renderDailyBonusCard(result);
    expect(await sharp(card).metadata()).toMatchObject({ width: 1000, height: 730, format: 'png' });
    expect(card.byteLength).toBeLessThan(1024 * 1024);
    expect(
      (await renderDailyBonusCard({ ...result, balance: Number.MAX_SAFE_INTEGER })).length,
    ).toBeGreaterThan(0);
  });
  it('bounds concurrent rendering and recovers after busy fallback', async () => {
    const cards = await Promise.allSettled([
      renderDailyBonusCard(result),
      renderDailyBonusCard(result),
      renderDailyBonusCard(result),
    ]);
    expect(cards.filter((c) => c.status === 'fulfilled')).toHaveLength(2);
    expect(cards.filter((c) => c.status === 'rejected')).toHaveLength(1);
    expect((await renderDailyBonusCard(result)).length).toBeGreaterThan(0);
  });
  it('calculates next JST date across month, year and leap boundaries', () => {
    expect(nextDailyBonusDate('2026-12-31')).toBe('2027-01-01');
    expect(nextDailyBonusDate('2028-02-28')).toBe('2028-02-29');
    expect(nextDailyBonusDate('2026-10-31')).toBe('2026-11-01');
    expect(dailyBonusResultText(result)).toContain('2026-10-31 00:00 JST');
    expect(dailyBonusResultText(result)).toContain('09:00 JST');
  });
  it('does not label identity/baseline failures as a missing profile', () => {
    expect(dailyBonusFailureMessage('profile_required')).toContain(
      'まだivRooomのプロフィールが作成されていません',
    );
    expect(dailyBonusFailureMessage('account_initialization_required')).toContain(
      'プロフィールは登録済み',
    );
    for (const status of ['unlinked', 'unavailable'] as const)
      expect(dailyBonusFailureMessage(status)).not.toContain('まだivRooomのプロフィール');
  });
});
