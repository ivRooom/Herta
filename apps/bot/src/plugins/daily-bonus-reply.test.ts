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
it('falls back to text after render failure without replaying any award', async () => {
  vi.stubEnv('DAILY_BONUS_RESULT_CARD_ENABLED', 'true');
  const editReply = vi.fn().mockResolvedValue({});
  const render = vi.fn().mockRejectedValue(new Error('synthetic renderer failure'));
  await replyDailyBonusResult(
    { editReply } as unknown as Pick<ButtonInteraction, 'editReply'>,
    result,
    render,
  );
  expect(editReply).toHaveBeenCalledOnce();
  expect(editReply.mock.calls[0]![0]).toMatchObject({
    content: expect.stringContaining('受取済み'),
    files: [],
    attachments: [],
    allowedMentions: { parse: [] },
  });
});
it('retries an attachment upload failure as text and preserves the original result', async () => {
  vi.stubEnv('DAILY_BONUS_RESULT_CARD_ENABLED', 'true');
  const editReply = vi
    .fn()
    .mockRejectedValueOnce(new Error('synthetic Discord error'))
    .mockResolvedValue({});
  const render = vi.fn().mockResolvedValue(Buffer.from('synthetic png'));
  await replyDailyBonusResult(
    { editReply } as unknown as Pick<ButtonInteraction, 'editReply'>,
    result,
    render,
  );
  expect(render).toHaveBeenCalledOnce();
  expect(editReply).toHaveBeenCalledTimes(2);
  expect(editReply.mock.calls[1]![0]).toMatchObject({ files: [], attachments: [] });
});
it('does not render while the feature flag is disabled', async () => {
  vi.stubEnv('DAILY_BONUS_RESULT_CARD_ENABLED', 'false');
  const editReply = vi.fn().mockResolvedValue({}),
    render = vi.fn();
  await replyDailyBonusResult(
    { editReply } as unknown as Pick<ButtonInteraction, 'editReply'>,
    result,
    render,
  );
  expect(render).not.toHaveBeenCalled();
  expect(editReply).toHaveBeenCalledOnce();
});
