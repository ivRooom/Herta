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
    embeds: expect.arrayContaining([expect.anything()]),
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
  expect(editReply.mock.calls[1]![0]).toMatchObject({
    files: [],
    attachments: [],
    embeds: expect.arrayContaining([expect.anything()]),
  });
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
  const payload = editReply.mock.calls[0]![0];
  expect(payload.embeds).toHaveLength(1);
  const card = payload.embeds[0].toJSON();
  expect(card.title).toContain('ログインボーナス');
  expect(card.fields).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: 'ログイン関連獲得ポイント', value: '+44pt' }),
      expect.objectContaining({ name: '現在の保有ポイント', value: '320pt' }),
      expect.objectContaining({
        name: '本日の受取順位・追加報酬',
        value: expect.stringContaining('記録なし'),
      }),
    ]),
  );
  const fieldNames = card.fields?.map((field: { name: string }) => field.name);
  expect(fieldNames).not.toContain('クイズ正解追加（別枠）');
  expect(payload.components).toEqual([]);
});

it.each([
  { rank: 1, points: 10, position: '🥇 1番乗り', bonus: '+10pt' },
  { rank: 2, points: 5, position: '🥈 2番乗り', bonus: '+5pt' },
  { rank: 3, points: 3, position: '🥉 3番乗り', bonus: '+3pt' },
  { rank: 4, points: 0, position: '受取順位：4位', bonus: '追加報酬なし' },
])(
  'shows the confirmed global rank $rank without inventing points',
  async ({ rank, points, position, bonus }) => {
    vi.stubEnv('DAILY_BONUS_RESULT_CARD_ENABLED', 'false');
    const editReply = vi.fn().mockResolvedValue({});
    await replyDailyBonusResult(
      { editReply } as unknown as Pick<ButtonInteraction, 'editReply'>,
      {
        ...result,
        receipt: {
          ...result.receipt,
          firstClaimReward: { rank, points, scope: 'global' },
        },
      },
    );
    const payload = editReply.mock.calls[0]![0];
    const fields = payload.embeds[0].toJSON().fields;
    const rankText = fields?.find(
      (field: { name: string }) => field.name === '本日の受取順位・追加報酬',
    )?.value;
    expect(rankText).toContain(position);
    expect(rankText).toContain(bonus);
    expect(payload.components).toEqual([]);
  },
);

it('does not mislabel a legacy combined quiz award as a login bonus', async () => {
  vi.stubEnv('DAILY_BONUS_RESULT_CARD_ENABLED', 'false');
  const editReply = vi.fn().mockResolvedValue({});
  await replyDailyBonusResult(
    { editReply } as unknown as Pick<ButtonInteraction, 'editReply'>,
    {
      ...result,
      receipt: {
        ...result.receipt,
        rewardPoints: 44,
        rollPoints: 34,
        quizBonusPoints: 10,
        quizCorrect: true,
        firstClaimReward: { rank: 2, points: 5, scope: 'global' },
      },
    },
  );
  const payload = editReply.mock.calls[0]![0];
  const fields = payload.embeds[0].toJSON().fields;
  const byName = Object.fromEntries(
    fields.map((field: { name: string; value: string }) => [field.name, field.value]),
  );
  expect(byName['ログイン関連獲得ポイント']).toBe('+39pt');
  expect(byName['ログイン基本分']).toBe('+34pt');
  expect(byName['クイズ正解追加（別枠）']).toBe('+10pt');
  const content: string = payload.content;
  expect(content).toContain('ログイン基本分：+34pt');
  expect(content).toContain('ログイン関連合計：+39pt');
  expect(content).toContain('デイリー問題：正解');
  expect(content).toContain('正解追加：+10pt');
  expect(content).not.toContain('獲得：49pt');
});

it('shows an incorrect V1 answer with zero quiz bonus', async () => {
  vi.stubEnv('DAILY_BONUS_RESULT_CARD_ENABLED', 'false');
  const editReply = vi.fn().mockResolvedValue({});
  await replyDailyBonusResult(
    { editReply } as unknown as Pick<ButtonInteraction, 'editReply'>,
    {
      ...result,
      receipt: {
        ...result.receipt,
        rewardPoints: 34,
        rollPoints: 34,
        quizBonusPoints: 0,
        quizCorrect: false,
      },
    },
  );
  const payload = editReply.mock.calls[0]![0];
  const content: string = payload.content;
  expect(content).toContain('デイリー問題：不正解');
  expect(content).toContain('正解追加：+0pt');
  expect(content).toContain('ログイン関連合計：+34pt');
  expect(content).not.toContain('ログイン関連合計：+44pt');
});
