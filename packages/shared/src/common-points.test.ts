import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildCommonPointsRequest,
  fetchCommonPointsBalance,
  resolveCommonPointsConfig,
} from './common-points.js';

const config = { guildId: '100000000000000000', secret: 'test-only' };
describe('common wallet contract', () => {
  it('is opt-in, guild scoped and independently keyed', () => {
    expect(resolveCommonPointsConfig({})).toBeNull();
    expect(
      resolveCommonPointsConfig({
        COMMON_POINTS_ENABLED: 'TRUE',
        HERTA_POINTS_SECRET: 'x',
        HERTA_POINTS_GUILD_ID: config.guildId,
      }),
    ).toBeNull();
    expect(() =>
      buildCommonPointsRequest(
        config,
        '/v1/points/herta/balance',
        JSON.stringify({ guildId: 'other', discordUserId: '200000000000000000' }),
        'a'.repeat(36),
      ),
    ).toThrow();
  });
  it('signs the exact persistent event bytes and scopes the destination', async () => {
    const path = '/v1/points/herta/earn',
      timestamp = '2026-10-29T00:00:00.000Z',
      event = '11111111-1111-4111-8111-111111111111';
    const body = JSON.stringify({
      guildId: config.guildId,
      discordUserId: '200000000000000000',
      amount: 7,
      earningId: 'day:metric:1',
      epoch: event,
      ruleVersion: 'a'.repeat(64),
      occurredAt: timestamp,
    });
    const request = buildCommonPointsRequest(config, path, body, event, timestamp);
    const schema = JSON.parse(
      readFileSync(
        new URL('../../../contracts/ivrm/common-points.v1.schema.json', import.meta.url),
        'utf8',
      ),
    );
    expect(Object.keys(JSON.parse(body)).sort()).toEqual(schema.$defs.earnRequest.required.sort());
    expect(request.url).toBe(`https://api.ivrm.jp${path}`);
    expect(await request.text()).toBe(body);
    expect(request.headers.get('X-IVRM-Signature')).toBe(
      createHmac('sha256', config.secret)
        .update(`${timestamp}.${event}.POST.${path}.${body}`)
        .digest('hex'),
    );
    expect(request.redirect).toBe('error');
  });
  it('uses canonical wallet values and reports unavailable without local score fallback', async () => {
    const fetcher = async () =>
      Response.json({
        status: 'ok',
        userId: 'canonical-user',
        account: { balance: 160, lifetimeEarned: 250, lifetimeSpent: 90 },
      });
    expect(
      (await fetchCommonPointsBalance(config, config.guildId, '200000000000000000', fetcher))
        ?.balance,
    ).toBe(160);
    expect(
      await fetchCommonPointsBalance(
        config,
        config.guildId,
        '200000000000000000',
        async () => new Response(null, { status: 503 }),
      ),
    ).toBeNull();
    expect(
      await fetchCommonPointsBalance(config, config.guildId, '200000000000000000', async () =>
        Response.json({
          status: 'ok',
          userId: 'x',
          account: { balance: -1, lifetimeEarned: 1, lifetimeSpent: 1 },
        }),
      ),
    ).toBeNull();
  });
});
