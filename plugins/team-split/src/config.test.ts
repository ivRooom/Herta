import { describe, expect, it } from 'vitest';
import {
  TEAM_SPLIT_DEFAULTS,
  TeamSplitValidationError,
  normalizeParticipantScore,
  normalizeTeamSplitConfig,
  normalizeTeamSplitSessionInput,
} from './config.js';

describe('normalizeTeamSplitConfig', () => {
  it('不正値を既定値へ戻す', () => {
    expect(normalizeTeamSplitConfig(null)).toEqual(TEAM_SPLIT_DEFAULTS);
    expect(normalizeTeamSplitConfig({ maxTeamCount: 999, retentionDays: 0 })).toMatchObject({
      maxTeamCount: 50,
      retentionDays: 1,
    });
  });
});

describe('normalizeTeamSplitSessionInput', () => {
  const now = new Date('2026-07-29T00:00:00.000Z');

  it('有効なセッションを正規化する', () => {
    const result = normalizeTeamSplitSessionInput(
      {
        channelId: '123456789012345678',
        title: 'カスタムマッチ',
        mode: 'balanced',
        teamCount: 2,
        maxParticipants: 10,
        durationMinutes: 30,
        seed: 'round-1',
      },
      TEAM_SPLIT_DEFAULTS,
      now,
    );
    expect(result.expiresAt.toISOString()).toBe('2026-07-29T00:30:00.000Z');
    expect(result.requestedSeed).toBe('round-1');
  });

  it('定員がチーム数未満なら拒否する', () => {
    expect(() =>
      normalizeTeamSplitSessionInput(
        {
          channelId: '123456789012345678',
          title: 'test',
          mode: 'random',
          teamCount: 4,
          maxParticipants: 3,
        },
        TEAM_SPLIT_DEFAULTS,
        now,
      ),
    ).toThrow(TeamSplitValidationError);
  });

  it('メンションを拒否する', () => {
    expect(() =>
      normalizeTeamSplitSessionInput(
        {
          channelId: '123456789012345678',
          title: '@everyone 集合',
          mode: 'random',
          teamCount: 2,
          maxParticipants: 8,
        },
        TEAM_SPLIT_DEFAULTS,
        now,
      ),
    ).toThrow('@everyoneと@hereは使用できません');
  });
});

describe('normalizeParticipantScore', () => {
  it('未指定は中立値0を使用する', () => {
    expect(normalizeParticipantScore(undefined)).toBe(0);
  });

  it('範囲外を拒否する', () => {
    expect(() => normalizeParticipantScore(100001)).toThrow(TeamSplitValidationError);
  });
});
