import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { claimDailyBonus, dailyBonusStatus } from './daily-bonus-wallet.js';
const guild = '123456789012345678',
  user = '223456789012345678',
  secret = 'synthetic-wallet-test-secret';
function configure() {
  vi.stubEnv('IVRM_WEB_API_BASE_URL', 'https://api.example.test');
  vi.stubEnv('HERTA_POINTS_SECRET', secret);
  vi.stubEnv('IVRM_INTEGRATION_GUILD_ID', guild);
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe('daily bonus canonical wallet client', () => {
  it('signs actual request bytes and never sends points or canonical user', async () => {
    configure();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: URL, options: RequestInit) => {
        const headers = options.headers as Record<string, string>,
          body = String(options.body);
        expect(input.pathname).toBe('/v1/points/herta/login-bonus/claim');
        expect(options.redirect).toBe('error');
        expect(headers['X-IVRM-Signature']).toBe(
          createHmac('sha256', secret)
            .update(
              `${headers['X-IVRM-Timestamp']}.${headers['X-IVRM-Event-Id']}.POST.${input.pathname}.${body}`,
            )
            .digest('hex'),
        );
        expect(JSON.parse(body)).toEqual({
          guildId: guild,
          discordUserId: user,
          claimDateJst: '2026-10-30',
          announcementMessageId: '323456789012345678',
          idempotencyKey: `daily-login:${guild}:${user}:2026-10-30`,
          // Deprecated contract fields: claims never carry a V1 quiz answer.
          quizId: null,
          choiceIndex: null,
        });
        return Response.json({
          status: 'ok',
          guildId: guild,
          discordUserId: user,
          mode: 'created',
          claim: {
            claimDateJst: '2026-10-30',
            rewardPoints: 15,
            rollPoints: 5,
            quizBonusPoints: 10,
            streakDay: 1,
            channel: 'discord',
          },
          account: { balance: 115 },
        });
      }),
    );
    expect((await claimDailyBonus(guild, user, '2026-10-30', '323456789012345678')).status).toBe(
      'confirmed',
    );
  });
  it('rejects wrong response subject and does not claim uncertain credit succeeded', async () => {
    configure();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          status: 'ok',
          guildId: guild,
          discordUserId: 'other',
          claim: { rewardPoints: 999, streakDay: 1 },
          account: { balance: 999 },
        }),
      ),
    );
    expect((await claimDailyBonus(guild, user, '2026-10-30', '323456789012345678')).status).toBe(
      'unavailable',
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('response lost');
      }),
    );
    expect((await claimDailyBonus(guild, user, '2026-10-30', '323456789012345678')).status).toBe(
      'unavailable',
    );
  });
  it('handles no-question day, retired quiz payload and unresolved identity explicitly', async () => {
    configure();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          status: 'ok',
          guildId: guild,
          discordUserId: user,
          claimedToday: false,
          quiz: null,
        }),
      ),
    );
    expect((await dailyBonusStatus(guild, user)).status).toBe('ready');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          status: 'ok',
          guildId: guild,
          discordUserId: user,
          claimedToday: false,
          quiz: { quizId: 'quiz', kind: 'quiz', question: '問題', choices: ['1', '2', '3', '4'] },
        }),
      ),
    );
    // A quiz-bearing status response is no longer conformant after the V1
    // quiz retirement (ivrm-web#770) and must not surface a quiz.
    expect((await dailyBonusStatus(guild, user)).status).toBe('unavailable');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ error: 'identity_or_baseline_unresolved' }, { status: 409 }),
      ),
    );
    expect((await dailyBonusStatus(guild, user)).status).toBe('unlinked');
  });
});

describe('canonical streak reward extension', () => {
  it('distinguishes explicit setup requirements from legacy unresolved identity and auth failures', async () => {
    configure();
    for (const [error, status] of [
      ['profile_required', 'profile_required'],
      ['account_initialization_required', 'account_initialization_required'],
      ['identity_or_baseline_unresolved', 'unlinked'],
      ['invalid_service_auth', 'unavailable'],
    ]) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          Response.json({ error }, { status: error === 'invalid_service_auth' ? 401 : 409 }),
        ),
      );
      expect((await dailyBonusStatus(guild, user)).status).toBe(status);
      expect((await claimDailyBonus(guild, user, '2026-10-30', '323456789012345678')).status).toBe(
        status,
      );
    }
  });
  it('displays the separately confirmed extra once and rejects malformed rewards', async () => {
    configure();
    const response = (streakReward: unknown) =>
      Response.json({
        status: 'ok',
        guildId: guild,
        discordUserId: user,
        mode: 'created',
        claim: {
          claimDateJst: '2026-10-30',
          rewardPoints: 15,
          rollPoints: 5,
          quizBonusPoints: 10,
          streakDay: 7,
          channel: 'discord',
        },
        account: { balance: 135 },
        streakReward,
      });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response({ points: 20, streakDay: 7 })),
    );
    const result = await claimDailyBonus(guild, user, '2026-10-30', '323456789012345678');
    expect(result.status).toBe('confirmed');
    if (result.status === 'confirmed') {
      expect(result.message).toContain('獲得：35pt');
      expect(result.message).toContain('連続ログイン追加報酬：+20pt');
      expect(result.receipt.streakReward).toEqual({ points: 20, streakDay: 7 });
    }
    for (const extra of [
      { points: -1, streakDay: 7 },
      { points: 20, streakDay: 8 },
      { points: 1.1, streakDay: 7 },
      { points: Number.MAX_SAFE_INTEGER, streakDay: 7 },
      { points: 20, streakDay: 7, untrusted: 'extra' },
      'wrong',
    ]) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => response(extra)),
      );
      expect((await claimDailyBonus(guild, user, '2026-10-30', '323456789012345678')).status).toBe(
        'unavailable',
      );
    }
  });
});

describe('daily bonus wallet failure diagnostics', () => {
  it('keeps the HTTP status and API error code for a service failure', async () => {
    configure();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: 'daily_login_unavailable' }, { status: 503 })),
    );
    expect(await dailyBonusStatus(guild, user)).toEqual({
      status: 'unavailable',
      failure: { kind: 'http', status: 503, errorCode: 'daily_login_unavailable' },
    });
    expect(await claimDailyBonus(guild, user, '2026-10-30', '323456789012345678')).toEqual({
      status: 'unavailable',
      failure: { kind: 'http', status: 503, errorCode: 'daily_login_unavailable' },
    });
  });
  it('keeps a non-setup conflict error code instead of dropping it', async () => {
    configure();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: 'date_mismatch' }, { status: 409 })),
    );
    expect(await claimDailyBonus(guild, user, '2026-10-30', '323456789012345678')).toEqual({
      status: 'unavailable',
      failure: { kind: 'http', status: 409, errorCode: 'date_mismatch' },
    });
  });
  it('distinguishes transport failures, missing configuration and malformed payloads', async () => {
    configure();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    expect(await dailyBonusStatus(guild, user)).toEqual({
      status: 'unavailable',
      failure: { kind: 'network', errorName: 'TypeError' },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          status: 'ok',
          guildId: guild,
          discordUserId: 'other',
          claimedToday: false,
          quiz: null,
        }),
      ),
    );
    expect(await dailyBonusStatus(guild, user)).toEqual({
      status: 'unavailable',
      failure: { kind: 'invalid_response' },
    });
    vi.unstubAllEnvs();
    expect(await dailyBonusStatus(guild, user)).toEqual({
      status: 'unavailable',
      failure: { kind: 'not_configured' },
    });
  });
  it('marks a structurally invalid receipt as invalid_receipt', async () => {
    configure();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          status: 'ok',
          guildId: guild,
          discordUserId: user,
          mode: 'created',
          claim: {
            claimDateJst: '2026-10-30',
            rewardPoints: 15,
            rollPoints: 5,
            quizBonusPoints: 9,
            streakDay: 1,
            channel: 'discord',
          },
          account: { balance: 115 },
        }),
      ),
    );
    expect(await claimDailyBonus(guild, user, '2026-10-30', '323456789012345678')).toEqual({
      status: 'unavailable',
      failure: { kind: 'invalid_receipt' },
    });
  });
});
