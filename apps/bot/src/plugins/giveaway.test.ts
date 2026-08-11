import { describe, expect, it } from 'vitest';
import {
  buildGiveawayMessage,
  formatGiveawayListPages,
  normalizeGiveawayConfig,
  selectRandomWinners,
} from './giveaway.js';
import type { GiveawayListRecord, GiveawaySnapshot } from './giveaway-repository.js';

describe('Giveaway v1', () => {
  it('Studio設定を安全な範囲へ正規化する', () => {
    expect(normalizeGiveawayConfig(undefined)).toEqual({
      enabled: true,
      ephemeralResponses: true,
      defaultDurationMinutes: 1440,
      maxDurationMinutes: 10080,
      defaultWinnerCount: 1,
      maxWinnerCount: 10,
      allowCreatorEntry: false,
      announceWinners: true,
      maxActivePerUser: 3,
    });
    expect(
      normalizeGiveawayConfig({
        defaultDurationMinutes: 500,
        maxDurationMinutes: 120,
        defaultWinnerCount: 15,
        maxWinnerCount: 4,
        maxActivePerUser: 99,
      }),
    ).toMatchObject({
      defaultDurationMinutes: 120,
      maxDurationMinutes: 120,
      defaultWinnerCount: 4,
      maxWinnerCount: 4,
      maxActivePerUser: 20,
    });
  });

  it('開催中は参加Buttonと参加人数を表示する', () => {
    const message = buildGiveawayMessage(makeSnapshot());
    expect(message.content).toContain('参加者: 4人');
    expect(message.components).toHaveLength(1);
    expect(message.allowedMentions.users).toBeUndefined();
  });

  it('終了後はButtonを消して当選者だけmention許可する', () => {
    const message = buildGiveawayMessage(
      makeSnapshot({ status: 'closed', winners: ['100', '200'], winnerCount: 2 }),
    );
    expect(message.components).toHaveLength(0);
    expect(message.content).toContain('<@100>');
    expect(message.allowedMentions.users).toEqual(['100', '200']);
  });

  it('当選発表OFFでは公開メッセージから当選者IDを隠す', () => {
    const message = buildGiveawayMessage(
      makeSnapshot({ status: 'closed', winners: ['100'], announceWinners: false }),
    );
    expect(message.content).not.toContain('<@100>');
    expect(message.allowedMentions.users).toBeUndefined();
  });

  it('暗号学的乱数による抽選で重複当選を作らない', () => {
    const entrants = ['1', '2', '2', '3', '4'];
    const winners = selectRandomWinners(entrants, 3);
    expect(winners).toHaveLength(3);
    expect(new Set(winners).size).toBe(3);
    expect(winners.every((winner) => entrants.includes(winner))).toBe(true);
  });

  it('参加者より当選枠が多い場合は全参加者までに制限する', () => {
    expect(selectRandomWinners(['1', '2'], 10).sort()).toEqual(['1', '2']);
  });

  it('Giveaway一覧をDiscord文字数上限以下へ分割する', () => {
    const records: GiveawayListRecord[] = Array.from({ length: 25 }, (_, index) => ({
      id: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
      prize: `賞品 ${index + 1} ${'x'.repeat(90)}`,
      status: 'open',
      endsAt: new Date('2026-08-12T12:00:00.000Z'),
      entryCount: index,
    }));
    const pages = formatGiveawayListPages(records);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.every((page) => page.length <= 1900)).toBe(true);
    for (const record of records) expect(pages.join('\n')).toContain(record.id);
  });
});

function makeSnapshot(overrides: Partial<GiveawaySnapshot> = {}): GiveawaySnapshot {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    guildId: '123',
    creatorId: '456',
    channelId: '789',
    messageId: '999',
    prize: 'Nitro 1か月分',
    winnerCount: 1,
    announceWinners: true,
    status: 'open',
    endsAt: new Date('2026-08-12T12:00:00.000Z'),
    closedAt: null,
    entryCount: 4,
    winners: [],
    ...overrides,
  };
}
