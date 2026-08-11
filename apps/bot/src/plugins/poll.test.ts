import { describe, expect, it } from 'vitest';
import {
  buildPollMessage,
  formatPollListPages,
  formatPollResult,
  normalizePollConfig,
  parsePollOptions,
} from './poll.js';
import type { PollListRecord, PollSnapshot } from './poll-repository.js';

describe('Poll v1', () => {
  it('選択肢を | 区切りで正規化する', () => {
    expect(parsePollOptions('Java | TypeScript | Go')).toEqual(['Java', 'TypeScript', 'Go']);
    expect(parsePollOptions('Java | java')).toBeNull();
    expect(parsePollOptions('1つだけ')).toBeNull();
  });

  it('Studio設定を安全な範囲へ正規化する', () => {
    expect(normalizePollConfig(undefined)).toEqual({
      enabled: true,
      ephemeralResponses: true,
      defaultDurationMinutes: 60,
      maxDurationMinutes: 10080,
      defaultMultipleChoice: false,
      showLiveResults: true,
      resultStyle: 'percentage',
      closeAnnouncement: true,
      maxActivePerUser: 5,
    });
    expect(
      normalizePollConfig({
        defaultDurationMinutes: 500,
        maxDurationMinutes: 120,
        maxActivePerUser: 99,
      }),
    ).toMatchObject({ defaultDurationMinutes: 120, maxDurationMinutes: 120, maxActivePerUser: 20 });
  });

  it('途中結果を隠す設定では開催中の得票数を表示しない', () => {
    const snapshot = makeSnapshot({ showLiveResults: false });
    const message = buildPollMessage(snapshot);
    const result = formatPollResult(snapshot);
    expect(message.content).toContain('投票受付中');
    expect(message.content).not.toContain('3票');
    expect(message.components).toHaveLength(1);
    expect(result).toContain('途中結果は締切まで非公開');
    expect(result).not.toContain('3票');
  });

  it('終了したPollでは結果を表示して投票Buttonを消す', () => {
    const message = buildPollMessage(makeSnapshot({ status: 'closed', showLiveResults: false }));
    expect(message.content).toContain('3票');
    expect(message.components).toHaveLength(0);
  });

  it('最終結果を非公開にしても終了時は投票Buttonを消す', () => {
    const snapshot = makeSnapshot({
      status: 'closed',
      showLiveResults: false,
      closeAnnouncement: false,
    });
    const message = buildPollMessage(snapshot);
    const result = formatPollResult(snapshot);
    expect(message.content).toContain('最終結果は非公開');
    expect(message.content).not.toContain('3票');
    expect(message.components).toHaveLength(0);
    expect(result).toContain('最終結果は非公開');
    expect(result).not.toContain('3票');
  });

  it('count表示では結果コマンドに割合を付けない', () => {
    const result = formatPollResult(makeSnapshot({ resultStyle: 'count' }));
    expect(result).toContain('3票');
    expect(result).not.toContain('75%');
  });

  it('percentage表示では結果コマンドに割合を表示する', () => {
    const result = formatPollResult(makeSnapshot({ resultStyle: 'percentage' }));
    expect(result).toContain('3票 (75%)');
  });

  it('Poll一覧をDiscord文字数上限以下へ分割する', () => {
    const records: PollListRecord[] = Array.from({ length: 25 }, (_, index) => ({
      id: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
      question: `投票 ${index + 1} ${'x'.repeat(90)}`,
      multiple: false,
      status: 'open',
      endsAt: new Date('2026-08-11T12:00:00.000Z'),
    }));
    const pages = formatPollListPages(records);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.every((page) => page.length <= 1900)).toBe(true);
    for (const record of records) expect(pages.join('\n')).toContain(record.id);
  });
});

function makeSnapshot(overrides: Partial<PollSnapshot> = {}): PollSnapshot {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    guildId: '123',
    creatorId: '456',
    channelId: '789',
    messageId: '999',
    question: '好きな言語は？',
    multiple: false,
    showLiveResults: true,
    resultStyle: 'percentage',
    closeAnnouncement: true,
    status: 'open',
    endsAt: new Date('2026-08-11T12:00:00.000Z'),
    closedAt: null,
    options: [
      { position: 0, label: 'TypeScript', votes: 3 },
      { position: 1, label: 'Go', votes: 1 },
    ],
    totalVotes: 4,
    uniqueVoters: 4,
    ...overrides,
  };
}
