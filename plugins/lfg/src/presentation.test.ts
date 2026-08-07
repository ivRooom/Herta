import { describe, expect, it } from 'vitest';
import { buildLfgDiscordMessage, createLfgMessageNonce } from './presentation.js';
import type { LfgPostRecord } from './service.js';

const postId = '11111111-1111-4111-8111-111111111111';
const PARTICIPANT_IDS = ['223456789012345678'];
const COMPONENT_SECRET = 'lfg-component-secret-for-tests-0123456789abcdef';
const POST = {
  id: postId,
  guildId: '123456789012345678',
  creatorId: '223456789012345678',
  channelId: '323456789012345678',
  messageId: null,
  title: 'VALORANT募集',
  description: 'ゆるく遊びます',
  game: 'VALORANT',
  maxPlayers: 5,
  participantCount: 1,
  status: 'open',
  startTime: null,
  expiresAt: new Date('2026-08-07T13:00:00.000Z'),
  messageState: 'pending',
  lastErrorName: null,
  closedAt: null,
  createdBy: '223456789012345678',
  updatedBy: '223456789012345678',
  deletedAt: null,
  version: 1,
  createdAt: new Date('2026-08-07T12:00:00.000Z'),
  updatedAt: new Date('2026-08-07T12:00:00.000Z'),
} satisfies LfgPostRecord;

describe('LFG presentation', () => {
  it('同じ募集versionで安定した25文字以内のnonceを返す', () => {
    const first = createLfgMessageNonce(postId, 12);
    const second = createLfgMessageNonce(postId, 12);
    expect(first).toBe(second);
    expect(first.length).toBeLessThanOrEqual(25);
  });

  it('versionが変わるとnonceも変わる', () => {
    expect(createLfgMessageNonce(postId, 12)).not.toBe(createLfgMessageNonce(postId, 13));
  });

  it('不正なpost IDとversionも安全な文字列へ正規化する', () => {
    expect(createLfgMessageNonce('invalid', Number.NaN)).toMatch(/^lfg[0-9a-f0]+$/);
  });

  it('募集カードへHerta生成画像と安全なmention設定を付与する', () => {
    const payload = buildLfgDiscordMessage(POST, PARTICIPANT_IDS, COMPONENT_SECRET);
    expect(payload.embeds[0]?.image?.url).toBe(
      'https://herta.ivrm.jp/api/discord-assets/lfg/open',
    );
    expect(payload.allowed_mentions.parse).toEqual([]);
  });
});
