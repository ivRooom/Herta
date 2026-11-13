import { describe, expect, it, vi } from 'vitest';
import {
  dailyQuizParticipationEnabled,
  dailyQuizResultCardEnabled,
  loadDailyQuizStudioSettings,
  parseDailyQuizStudioSettings,
} from './daily-quiz-settings.js';

describe('parseDailyQuizStudioSettings', () => {
  it('returns no restriction when the plugin row does not exist', () => {
    expect(parseDailyQuizStudioSettings(null)).toEqual({});
    expect(parseDailyQuizStudioSettings(undefined)).toEqual({});
  });

  it('disables both switches when the plugin itself is disabled in Studio', () => {
    expect(
      parseDailyQuizStudioSettings({
        enabled: false,
        config: { participationEnabled: true, resultCardEnabled: true },
      }),
    ).toEqual({ participationEnabled: false, resultCardEnabled: false });
  });

  it('passes through boolean config values', () => {
    expect(
      parseDailyQuizStudioSettings({
        enabled: true,
        config: { participationEnabled: false, resultCardEnabled: true },
      }),
    ).toEqual({ participationEnabled: false, resultCardEnabled: true });
  });

  it('treats missing or non-boolean config values as unset', () => {
    expect(parseDailyQuizStudioSettings({ enabled: true, config: {} })).toEqual({
      participationEnabled: undefined,
      resultCardEnabled: undefined,
    });
    expect(
      parseDailyQuizStudioSettings({
        enabled: true,
        config: { participationEnabled: 'false', resultCardEnabled: 0 },
      }),
    ).toEqual({ participationEnabled: undefined, resultCardEnabled: undefined });
    expect(parseDailyQuizStudioSettings({ enabled: true, config: null })).toEqual({
      participationEnabled: undefined,
      resultCardEnabled: undefined,
    });
  });
});

describe('loadDailyQuizStudioSettings', () => {
  it('reads the daily-quiz row for the guild', async () => {
    const findUnique = vi.fn(async () => ({
      enabled: true,
      config: { participationEnabled: false, resultCardEnabled: true },
    }));
    const settings = await loadDailyQuizStudioSettings({ guildPlugin: { findUnique } }, 'guild-1');
    expect(findUnique).toHaveBeenCalledWith({
      where: { guildId_pluginId: { guildId: 'guild-1', pluginId: 'daily-quiz' } },
      select: { enabled: true, config: true },
    });
    expect(settings).toEqual({ participationEnabled: false, resultCardEnabled: true });
  });

  it('falls back to unset when the store is not wired or fails', async () => {
    await expect(loadDailyQuizStudioSettings({}, 'guild-1')).resolves.toEqual({});
    await expect(loadDailyQuizStudioSettings(null, 'guild-1')).resolves.toEqual({});
    await expect(
      loadDailyQuizStudioSettings(
        {
          guildPlugin: {
            findUnique: vi.fn(async () => {
              throw new Error('db unavailable');
            }),
          },
        },
        'guild-1',
      ),
    ).resolves.toEqual({});
  });
});

describe('dailyQuizParticipationEnabled', () => {
  const envOn = { DAILY_PARTICIPATION_ENABLED: 'true' } as NodeJS.ProcessEnv;
  const envOff = { DAILY_PARTICIPATION_ENABLED: 'false' } as NodeJS.ProcessEnv;
  const envUnset = {} as NodeJS.ProcessEnv;

  it('keeps the env-only behaviour while Studio is unset', () => {
    expect(dailyQuizParticipationEnabled({}, envOn)).toBe(true);
    expect(dailyQuizParticipationEnabled({}, envOff)).toBe(false);
    expect(dailyQuizParticipationEnabled({}, envUnset)).toBe(false);
  });

  it('lets an explicit Studio OFF stop participation', () => {
    expect(dailyQuizParticipationEnabled({ participationEnabled: false }, envOn)).toBe(false);
    expect(dailyQuizParticipationEnabled({ participationEnabled: true }, envOn)).toBe(true);
  });

  it('keeps the env kill switch authoritative over Studio ON (fail-closed)', () => {
    expect(dailyQuizParticipationEnabled({ participationEnabled: true }, envOff)).toBe(false);
    expect(dailyQuizParticipationEnabled({ participationEnabled: true }, envUnset)).toBe(false);
  });
});

describe('dailyQuizResultCardEnabled', () => {
  const envOn = { DAILY_BONUS_RESULT_CARD_ENABLED: 'true' } as NodeJS.ProcessEnv;
  const envOff = { DAILY_BONUS_RESULT_CARD_ENABLED: 'false' } as NodeJS.ProcessEnv;

  it('mirrors the participation gate semantics on its own env flag', () => {
    expect(dailyQuizResultCardEnabled({}, envOn)).toBe(true);
    expect(dailyQuizResultCardEnabled({}, envOff)).toBe(false);
    expect(dailyQuizResultCardEnabled({ resultCardEnabled: false }, envOn)).toBe(false);
    expect(dailyQuizResultCardEnabled({ resultCardEnabled: true }, envOn)).toBe(true);
    expect(dailyQuizResultCardEnabled({ resultCardEnabled: true }, envOff)).toBe(false);
  });

  it('does not leak the participation switch into the result card gate', () => {
    expect(dailyQuizResultCardEnabled({ participationEnabled: false }, envOn)).toBe(true);
  });
});
