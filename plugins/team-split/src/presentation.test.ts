import { describe, expect, it } from 'vitest';
import { buildTeamSplitDiscordMessage, formatTeamSplitSessionText } from './presentation.js';
import type { TeamSplitParticipantRecord, TeamSplitSessionRecord } from './service.js';

const SECRET = 'team-split-secret-for-tests-0123456789';
const SESSION: TeamSplitSessionRecord = {
  id: '123e4567-e89b-42d3-a456-426614174000',
  guildId: '123456789012345678',
  creatorId: '223456789012345678',
  channelId: '323456789012345678',
  messageId: null,
  title: '大会チーム分け',
  teamCount: 2,
  mode: 'balanced',
  maxParticipants: 8,
  participantCount: 2,
  participants: ['223456789012345678', '423456789012345678'],
  teams: [
    {
      teamNumber: 1,
      totalScore: 10,
      members: [{ userId: '223456789012345678', score: 10 }],
    },
    {
      teamNumber: 2,
      totalScore: 8,
      members: [{ userId: '423456789012345678', score: 8 }],
    },
  ],
  seedHash: 'secret-hash',
  generation: 0,
  status: 'split',
  expiresAt: new Date('2026-07-29T03:00:00.000Z'),
  splitAt: new Date('2026-07-29T02:00:00.000Z'),
  closedAt: null,
  messageState: 'pending',
  lastErrorName: null,
  createdBy: '223456789012345678',
  updatedBy: '223456789012345678',
  deletedAt: null,
  version: 2,
  createdAt: new Date('2026-07-29T01:00:00.000Z'),
  updatedAt: new Date('2026-07-29T02:00:00.000Z'),
};
const PARTICIPANTS: TeamSplitParticipantRecord[] = [
  {
    sessionId: SESSION.id,
    guildId: SESSION.guildId,
    userId: '223456789012345678',
    score: 10,
    status: 'joined',
    joinedAt: SESSION.createdAt,
    leftAt: null,
    updatedAt: SESSION.updatedAt,
  },
  {
    sessionId: SESSION.id,
    guildId: SESSION.guildId,
    userId: '423456789012345678',
    score: 8,
    status: 'joined',
    joinedAt: SESSION.createdAt,
    leftAt: null,
    updatedAt: SESSION.updatedAt,
  },
];

describe('Team Split presentation', () => {
  it('内部seedをDiscord payloadへ露出しない', () => {
    const payload = buildTeamSplitDiscordMessage(SESSION, PARTICIPANTS, SECRET);
    const json = JSON.stringify(payload);
    expect(json).not.toContain(SESSION.seedHash);
    expect(payload.allowed_mentions.parse).toEqual([]);
  });

  it('split後は参加Buttonを無効化する', () => {
    const payload = buildTeamSplitDiscordMessage(SESSION, PARTICIPANTS, SECRET);
    const row = payload.components[0] as { components: Array<{ disabled: boolean }> };
    expect(row.components.every((button) => button.disabled)).toBe(true);
  });

  it('テキスト表示へ結果を含める', () => {
    const text = formatTeamSplitSessionText(SESSION, PARTICIPANTS);
    expect(text).toContain('Team 1');
    expect(text).toContain('Team 2');
    expect(text).not.toContain(SESSION.seedHash);
  });

  it('結果カードへTeam Split生成画像を付与する', () => {
    const payload = buildTeamSplitDiscordMessage(SESSION, PARTICIPANTS, SECRET);
    expect(payload.embeds[0]?.image?.url).toBe(
      'https://herta.ivrm.jp/api/discord-assets/team-split/result',
    );
  });
});
