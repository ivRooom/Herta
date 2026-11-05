import { afterEach, expect, it, vi } from 'vitest';
import type { ButtonInteraction } from 'discord.js';
import { replyDailyBonusResult } from './daily-bonus-reply.js';
import type { ConfirmedDailyBonus } from './daily-bonus-presentation.js';

const result: ConfirmedDailyBonus = {
  status: 'confirmed',
  alreadyClaimed: true,
  balance: 320,
  message: '受取済み',
  receipt: {
    claimDateJst: '2026-10-30',
    rewardPoints: 44,
    rollPoints: 44,
    quizBonusPoints: 0,
    streakDay: 3,
    channel: 'web',
  },
};

afterEach(() => vi.unstubAllEnvs());

it('falls back to an Embed if PNG rendering fails', async () => {
  vi.stubEnv('DAILY_BONUS_RESULT_CARD_ENABLED', 'true');
  const editReply = vi.fn().mockResolvedValue({});
  const render = vi.fn().mockRejectedValue(Error('render failure'));
  await replyDailyBonusResult({ editReply } as never, result, render);
  expect(render).toHaveBeenCalledOnce();
  expect(editReply).toHaveBeenCalledOnce();
  expect(editReply.mock.calls[0]![0].embeds).toHaveLength(1);
});

it('does not retry an award after an attachment upload failure', async () => {
  vi.stubEnv('DAILY_BONUS_RESULT_CARD_ENABLED', 'true');
  const editReply = vi.fn().mockRejectedValueOnce(Error('upload failure')).mockResolvedValue({});
  const render = vi.fn().mockResolvedValue(Buffer.from('fake png'));
  await replyDailyBonusResult({ editReply } as never, result, render);
  expect(render).toHaveBeenCalledOnce();
  expect(editReply).toHaveBeenCalledTimes(2);
  expect(editReply.mock.calls[1]![0].embeds).toHaveLength(1);
});

it('shows login-only earnings but no quiz field', async () => {
  vi.stubEnv('DAILY_BONUS_RESULT_CARD_ENABLED', 'false');
  const editReply = vi.fn().mockResolvedValue({});
  await replyDailyBonusResult({ editReply } as never, result);
  const payload = editReply.mock.calls[0]![0];
  expect(payload.embeds).toHaveLength(1);
  expect(payload.content).toContain('ログイン関連合計：+44pt');
  expect(payload.content).not.toContain('デイリー問題');
  const fields = payload.embeds[0].toJSON().fields;
  expect(fields?.some((field: { name: string }) => field.name.includes('クイズ'))).toBe(false);
});

it.each([1, 2, 3])('shows canonical first-claim rank %s', async (rank) => {
  vi.stubEnv('DAILY_BONUS_RESULT_CARD_ENABLED', 'false');
  const editReply = vi.fn().mockResolvedValue({});
  const firstClaimReward = { rank, points: 5, scope: 'global' as const };
  const receipt = { ...result.receipt, firstClaimReward };
  await replyDailyBonusResult({ editReply } as never, { ...result, receipt });
  const payload = editReply.mock.calls[0]![0];
  expect(payload.content).toContain('追加報酬 +5pt');
  expect(payload.content).toContain('ログイン関連合計：+49pt');
});

it('separates the quiz answer from the login award', async () => {
  vi.stubEnv('DAILY_BONUS_RESULT_CARD_ENABLED', 'false');
  const editReply = vi.fn().mockResolvedValue({});
  const receipt = {
    ...result.receipt,
    rollPoints: 34,
    quizBonusPoints: 10,
    quizCorrect: true,
  };
  await replyDailyBonusResult({ editReply } as never, { ...result, receipt });
  const payload = editReply.mock.calls[0]![0];
  expect(payload.content).toContain('ログイン関連合計：+34pt');
  expect(payload.content).toContain('デイリー問題：正解');
  expect(payload.content).toContain('正解追加：+10pt');
  expect(payload.content).not.toContain('ログイン関連合計：+44pt');
});

it('reports an incorrect answer and zero quiz points', async () => {
  vi.stubEnv('DAILY_BONUS_RESULT_CARD_ENABLED', 'false');
  const editReply = vi.fn().mockResolvedValue({});
  const receipt = {
    ...result.receipt,
    rewardPoints: 34,
    rollPoints: 34,
    quizBonusPoints: 0,
    quizCorrect: false,
  };
  await replyDailyBonusResult({ editReply } as never, { ...result, receipt });
  const payload = editReply.mock.calls[0]![0];
  expect(payload.content).toContain('デイリー問題：不正解');
  expect(payload.content).toContain('正解追加：+0pt');
});
