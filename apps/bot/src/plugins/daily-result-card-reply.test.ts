import { afterEach, describe, expect, it, vi } from 'vitest';
import { replyDailyParticipationAnswer } from './daily-result-card-reply.js';
import {
  selectDailyQuizResultAsset,
  type DailyQuizResultAssetPool,
} from './daily-quiz-result-asset-selector.js';
import type {
  DailyResultCardAssetMeta,
  DailyResultCardConfig,
} from './daily-result-card-config.js';

const CONTENT = '正解です！\n獲得：10pt / 保有：691pt\nhttps://member.ivrm.jp/login-bonus';
const RECEIPT = 'daily-participation-answer:123456789012345678:question-1:2026-11-11T01:00:00.000Z';

function meta(assetId: string, alt: string): DailyResultCardAssetMeta {
  return { assetId, alt, mimeType: 'image/webp', byteSize: 4 };
}

function makeConfig(
  correct: DailyResultCardAssetMeta[],
  incorrect: DailyResultCardAssetMeta[] = [],
): DailyResultCardConfig {
  const toPool = (assets: readonly DailyResultCardAssetMeta[]) =>
    assets.map((asset) => ({ assetId: asset.assetId, alt: asset.alt, enabled: true }));
  const pool: DailyQuizResultAssetPool = {
    revision: '3',
    correctAssets: toPool(correct),
    incorrectAssets: toPool(incorrect),
  };
  return {
    revision: 3,
    activatedAt: '2026-11-11T00:00:00.000Z',
    correctAssets: correct,
    incorrectAssets: incorrect,
    pool,
  };
}

const config = makeConfig(
  [meta('asset-a', '正解イラストA'), meta('asset-b', '正解イラストB')],
  [meta('asset-c', '不正解イラスト')],
);

function makeDeps(overrides: Record<string, unknown> = {}) {
  return {
    fetchConfig: vi.fn().mockResolvedValue(config),
    fetchMedia: vi.fn().mockResolvedValue(Buffer.from('webp')),
    render: vi.fn().mockResolvedValue(Buffer.from('rendered png')),
    ...overrides,
  };
}

function makeInteraction(editReply = vi.fn().mockResolvedValue({})) {
  return { interaction: { editReply } as never, editReply };
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    guildId: 'guild',
    userId: '123456789012345678',
    content: CONTENT,
    result: 'correct' as const,
    rewardPoints: 10,
    balance: 691,
    finalizedReceiptId: RECEIPT,
    ...overrides,
  };
}

afterEach(() => vi.unstubAllEnvs());

describe('replyDailyParticipationAnswer', () => {
  it('sends the exact legacy payload and touches no card dependency while the flag is off', async () => {
    vi.stubEnv('DAILY_RESULT_CARD_ENABLED', 'false');
    const { interaction, editReply } = makeInteraction();
    const deps = makeDeps();
    await replyDailyParticipationAnswer(interaction, baseInput(), deps as never);
    expect(deps.fetchConfig).not.toHaveBeenCalled();
    expect(deps.fetchMedia).not.toHaveBeenCalled();
    expect(deps.render).not.toHaveBeenCalled();
    expect(editReply).toHaveBeenCalledTimes(1);
    expect(editReply.mock.calls[0]![0]).toEqual({
      content: CONTENT,
      allowedMentions: { parse: [] },
      components: [],
    });
  });

  it('never cards a pending or void result even with the flag on', async () => {
    vi.stubEnv('DAILY_RESULT_CARD_ENABLED', 'true');
    const { interaction, editReply } = makeInteraction();
    const deps = makeDeps();
    await replyDailyParticipationAnswer(
      interaction,
      baseInput({ result: null, content: '回答を受け付けました。結果の確定をお待ちください。' }),
      deps as never,
    );
    expect(deps.fetchConfig).not.toHaveBeenCalled();
    expect(editReply.mock.calls[0]![0].files).toBeUndefined();
    expect(editReply.mock.calls[0]![0].content).toContain('結果の確定をお待ちください');
  });

  it('attaches the deterministically selected card and keeps the canonical text', async () => {
    vi.stubEnv('DAILY_RESULT_CARD_ENABLED', 'true');
    const expected = selectDailyQuizResultAsset(config.pool, 'correct', RECEIPT);
    expect(expected).not.toBeNull();
    const descriptions: string[] = [];
    for (let i = 0; i < 2; i++) {
      const { interaction, editReply } = makeInteraction();
      const deps = makeDeps();
      await replyDailyParticipationAnswer(interaction, baseInput(), deps as never);
      expect(editReply).toHaveBeenCalledTimes(1);
      const payload = editReply.mock.calls[0]![0];
      expect(payload.content).toBe(CONTENT);
      expect(payload.files).toHaveLength(1);
      const attachment = payload.files[0];
      expect(attachment.name).toBe('herta-daily-result.png');
      // The filename carries neither the outcome nor any answer content.
      expect(attachment.name).not.toContain('correct');
      expect(attachment.name).not.toContain('incorrect');
      descriptions.push(attachment.description);
    }
    // Same finalized answer + same revision -> same artwork on re-display.
    expect(descriptions[0]).toBe(expected!.alt);
    expect(descriptions[1]).toBe(descriptions[0]);
  });

  it('uses the incorrect pool for an incorrect result', async () => {
    vi.stubEnv('DAILY_RESULT_CARD_ENABLED', 'true');
    const { interaction, editReply } = makeInteraction();
    const deps = makeDeps();
    await replyDailyParticipationAnswer(
      interaction,
      baseInput({ result: 'incorrect' }),
      deps as never,
    );
    expect(deps.fetchMedia).toHaveBeenCalledWith(
      'guild',
      '123456789012345678',
      expect.objectContaining({ assetId: 'asset-c' }),
    );
    expect(deps.render).toHaveBeenCalledWith(expect.objectContaining({ result: 'incorrect' }));
    expect(editReply.mock.calls[0]![0].files[0].description).toBe('不正解イラスト');
  });

  it.each([
    ['config unavailable', { fetchConfig: vi.fn().mockResolvedValue(null) }, 'fetchConfig'],
    ['empty pool', { fetchConfig: vi.fn().mockResolvedValue(makeConfig([], [])) }, 'fetchConfig'],
    ['media unavailable', { fetchMedia: vi.fn().mockResolvedValue(null) }, 'fetchMedia'],
    ['render failure', { render: vi.fn().mockRejectedValue(new Error('busy')) }, 'render'],
  ])('falls back to the canonical text when %s', async (_label, overrides, lastDep) => {
    vi.stubEnv('DAILY_RESULT_CARD_ENABLED', 'true');
    const { interaction, editReply } = makeInteraction();
    const deps = makeDeps(overrides);
    await replyDailyParticipationAnswer(interaction, baseInput(), deps as never);
    expect(editReply).toHaveBeenCalledTimes(1);
    const payload = editReply.mock.calls[0]![0];
    expect(payload.content).toBe(CONTENT);
    expect(payload.files).toEqual([]);
    expect(deps[lastDep as keyof typeof deps]).toHaveBeenCalledTimes(1);
  });

  it('retries only the presentation after an attachment upload failure', async () => {
    vi.stubEnv('DAILY_RESULT_CARD_ENABLED', 'true');
    const editReply = vi
      .fn()
      .mockRejectedValueOnce(new Error('upload failure'))
      .mockResolvedValue({});
    const { interaction } = makeInteraction(editReply);
    const deps = makeDeps();
    await replyDailyParticipationAnswer(interaction, baseInput(), deps as never);
    expect(editReply).toHaveBeenCalledTimes(2);
    expect(editReply.mock.calls[1]![0].content).toBe(CONTENT);
    expect(editReply.mock.calls[1]![0].files).toEqual([]);
    // Nothing upstream of the presentation is ever re-executed.
    expect(deps.fetchConfig).toHaveBeenCalledTimes(1);
    expect(deps.fetchMedia).toHaveBeenCalledTimes(1);
    expect(deps.render).toHaveBeenCalledTimes(1);
  });
});
