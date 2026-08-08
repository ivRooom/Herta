import { describe, expect, it } from 'vitest';
import {
  LFG_DEFAULTS,
  LfgValidationError,
  normalizeLfgConfig,
  normalizeLfgPostInput,
} from './config.js';

const now = new Date('2026-07-29T00:00:00.000Z');

describe('LFG config', () => {
  it('既定値を適用する', () => {
    expect(normalizeLfgConfig({})).toEqual(LFG_DEFAULTS);
  });

  it('設定値を許容範囲へ制限する', () => {
    expect(
      normalizeLfgConfig({
        maxOpenPostsPerGuild: 9999,
        maxOpenPostsPerChannel: 0,
        creationCooldownSeconds: 9999,
        maxPlayersLimit: 1,
      }),
    ).toMatchObject({
      maxOpenPostsPerGuild: 500,
      maxOpenPostsPerChannel: 1,
      creationCooldownSeconds: 3600,
      maxPlayersLimit: 2,
    });
  });

  it('既定定員をmaxPlayersLimit以下へ調整する', () => {
    expect(normalizeLfgConfig({ maxPlayersLimit: 3, defaultMaxPlayers: 8 })).toMatchObject({
      maxPlayersLimit: 3,
      defaultMaxPlayers: 3,
    });
  });

  it('ゲームPresetをtrim・重複除去して保持する', () => {
    expect(
      normalizeLfgConfig({
        gamePresets: [' Minecraft ', 'VALORANT', 'Minecraft', '', 123, 'Apex Legends'],
      }).gamePresets,
    ).toEqual(['Minecraft', 'VALORANT', 'Apex Legends']);
  });

  it('ゲームPresetは空配列も許可する', () => {
    expect(normalizeLfgConfig({ gamePresets: [] }).gamePresets).toEqual([]);
  });
});

describe('LFG input validation', () => {
  it('募集入力を正規化し期限を計算する', () => {
    const normalized = normalizeLfgPostInput(
      {
        channelId: '123456789012345678',
        game: ' Minecraft ',
        title: ' 建築メンバー募集 ',
        description: ' サバイバルで建築します ',
        maxPlayers: 5,
        durationMinutes: 60,
      },
      LFG_DEFAULTS,
      now,
    );

    expect(normalized).toEqual({
      channelId: '123456789012345678',
      game: 'Minecraft',
      title: '建築メンバー募集',
      description: 'サバイバルで建築します',
      maxPlayers: 5,
      startTime: null,
      expiresAt: new Date('2026-07-29T01:00:00.000Z'),
    });
  });

  it.each(['@everyone 集合', '@here 集合', '<@&123456789012345678> 集合'])(
    '危険なメンションを拒否する: %s',
    (description) => {
      expect(() =>
        normalizeLfgPostInput(
          {
            channelId: '123456789012345678',
            game: 'Minecraft',
            title: '募集',
            description,
            maxPlayers: 4,
          },
          LFG_DEFAULTS,
          now,
        ),
      ).toThrow(LfgValidationError);
    },
  );

  it('ユーザーメンションを既定で拒否する', () => {
    expect(() =>
      normalizeLfgPostInput(
        {
          channelId: '123456789012345678',
          game: 'Minecraft',
          title: '募集',
          description: '<@123456789012345678> 参加して',
          maxPlayers: 4,
        },
        LFG_DEFAULTS,
        now,
      ),
    ).toThrow(LfgValidationError);
  });

  it('過去の開始時刻を拒否する', () => {
    expect(() =>
      normalizeLfgPostInput(
        {
          channelId: '123456789012345678',
          game: 'Minecraft',
          title: '募集',
          maxPlayers: 4,
          startTime: new Date('2026-07-28T23:59:59.000Z'),
        },
        LFG_DEFAULTS,
        now,
      ),
    ).toThrow(LfgValidationError);
  });
});
