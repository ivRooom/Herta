import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  authorizeCommunityGameStatsRead,
  COMMUNITY_GAME_STATS_PATH,
  COMMUNITY_GAME_STATS_PURPOSE,
  formatCommunityGameEarliestDate,
  projectCommunityGameRankingRow,
  projectCommunityGameStatRow,
  projectCommunityUserGameRow,
  toCommunityGameSeconds,
} from './community-game-stats.ts';
const environment = {
  IVRM_INTEGRATION_GUILD_ID: '100000000000000001',
  IVRM_INTEGRATION_TOKEN: 'test-secret-value-that-is-long-enough-32',
};
const input = {
  guildId: environment.IVRM_INTEGRATION_GUILD_ID,
  from: '2026-10-01',
  to: '2026-11-30',
  limit: 50,
  offset: 0,
};
function signed(
  value: unknown = input,
  timestamp = new Date().toISOString(),
  secret = environment.IVRM_INTEGRATION_TOKEN,
) {
  const body = JSON.stringify(value),
    event = randomUUID(),
    key = createHmac('sha256', secret).update(COMMUNITY_GAME_STATS_PURPOSE).digest();
  return new Request(`https://studio.test${COMMUNITY_GAME_STATS_PATH}`, {
    method: 'POST',
    headers: {
      'X-IVRM-Timestamp': timestamp,
      'X-IVRM-Event-Id': event,
      'X-IVRM-Signature': createHmac('sha256', key)
        .update(`${timestamp}.${event}.POST.${COMMUNITY_GAME_STATS_PATH}.${body}`)
        .digest('hex'),
    },
    body,
  });
}
test('authenticates exact service body, binds Guild and defaults to overview', async () => {
  assert.deepEqual(await authorizeCommunityGameStatsRead(signed(), environment), {
    ...input,
    mode: 'overview',
    discordUserId: null,
  });
  assert.deepEqual(
    await authorizeCommunityGameStatsRead(
      signed({ ...input, mode: 'user', discordUserId: '100000000000000002' }),
      environment,
    ),
    { ...input, mode: 'user', discordUserId: '100000000000000002' },
  );
  for (const value of [
    { ...input, guildId: '100000000000000099' },
    { ...input, from: '2026-02-30' },
    { ...input, from: '2026-12-01' },
    { ...input, offset: -1 },
    { ...input, limit: 101 },
    { ...input, limit: 0 },
    { ...input, extra: true },
    { ...input, mode: 'raw' },
    { ...input, mode: 'user' },
    { ...input, mode: 'user', discordUserId: 'not-a-snowflake' },
    { ...input, discordUserId: '100000000000000002' },
  ]) {
    const response = await authorizeCommunityGameStatsRead(signed(value), environment);
    assert.ok(response instanceof Response);
    assert.equal(response.status, 422);
  }
});
test('rejects expired signature and wrong key, fails closed while unconfigured', async () => {
  for (const request of [
    signed(input, '2020-01-01T00:00:00.000Z'),
    signed(input, new Date().toISOString(), 'wrong-secret-value-that-is-long-enough'),
  ]) {
    const response = await authorizeCommunityGameStatsRead(request, environment);
    assert.ok(response instanceof Response);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  }
  const response = await authorizeCommunityGameStatsRead(signed(), {
    IVRM_INTEGRATION_GUILD_ID: environment.IVRM_INTEGRATION_GUILD_ID,
  });
  assert.ok(response instanceof Response);
  assert.equal(response.status, 503);
});
test('seconds conversion only accepts exact non-negative aggregates', () => {
  assert.equal(toCommunityGameSeconds(3600n), 3600);
  assert.equal(toCommunityGameSeconds(3600), 3600);
  assert.equal(toCommunityGameSeconds('3600'), 3600);
  assert.equal(toCommunityGameSeconds(0n), 0);
  for (const value of [-1n, -1, 1.5, '1.5', 'abc', null, undefined, 2n ** 60n]) {
    assert.throws(() => toCommunityGameSeconds(value));
  }
});
test('row projections emit exactly the contract fields', () => {
  const game = projectCommunityGameStatRow({
    name: 'VALORANT',
    totalSeconds: 1997400n,
    playerCount: 16,
  });
  assert.deepEqual(game, { name: 'VALORANT', totalSeconds: 1997400, playerCount: 16 });
  assert.deepEqual(Object.keys(game).sort(), ['name', 'playerCount', 'totalSeconds']);
  const ranking = projectCommunityGameRankingRow({
    discordUserId: '100000000000000002',
    totalSeconds: '7200',
    topGameName: 'VALORANT',
  });
  assert.deepEqual(ranking, {
    discordUserId: '100000000000000002',
    totalSeconds: 7200,
    topGameName: 'VALORANT',
  });
  assert.deepEqual(Object.keys(ranking).sort(), ['discordUserId', 'topGameName', 'totalSeconds']);
  assert.deepEqual(projectCommunityUserGameRow({ name: '原神', totalSeconds: 60 }), {
    name: '原神',
    totalSeconds: 60,
  });
  assert.throws(() =>
    projectCommunityGameRankingRow({
      discordUserId: '123',
      totalSeconds: 1,
      topGameName: 'VALORANT',
    }),
  );
  assert.throws(() => projectCommunityGameStatRow({ name: '', totalSeconds: 1, playerCount: 1 }));
  assert.throws(() =>
    projectCommunityGameStatRow({ name: 'VALORANT', totalSeconds: 1, playerCount: -1 }),
  );
});
test('earliest date formatting accepts Date or date string only', () => {
  assert.equal(formatCommunityGameEarliestDate(new Date('2026-09-30T00:00:00.000Z')), '2026-09-30');
  assert.equal(formatCommunityGameEarliestDate('2026-09-30'), '2026-09-30');
  assert.equal(formatCommunityGameEarliestDate(null), null);
  assert.throws(() => formatCommunityGameEarliestDate('2026-02-30'));
  assert.throws(() => formatCommunityGameEarliestDate('2026-09-30T12:00:00Z'));
  assert.throws(() => formatCommunityGameEarliestDate(20260930));
});
test('contract JSON matches the implemented endpoint', () => {
  const contract = JSON.parse(
    readFileSync(
      new URL(
        '../../../../contracts/ivrm/herta-community-game-stats-read.v1.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ) as {
    $id: string;
    description: string;
    $defs: {
      request: { required: string[]; properties: Record<string, unknown> };
    };
  };
  assert.equal(contract.$id, 'https://ivrm.jp/contracts/herta-community-game-stats-read/v1');
  assert.ok(contract.description.includes(COMMUNITY_GAME_STATS_PATH));
  assert.ok(contract.description.includes(COMMUNITY_GAME_STATS_PURPOSE));
  assert.deepEqual(contract.$defs.request.required, ['guildId', 'from', 'to', 'limit', 'offset']);
  assert.deepEqual(Object.keys(contract.$defs.request.properties).sort(), [
    'discordUserId',
    'from',
    'guildId',
    'limit',
    'mode',
    'offset',
    'to',
  ]);
});
test('read route casts every range bound to date (PG 42883 regression)', () => {
  // The route hands the validated from/to strings to Prisma $queryRaw,
  // where they are bound as text; comparing them against the DATE
  // column activity_date raises PG 42883
  // (operator does not exist: date >= text, Prisma P2010), which the
  // route's catch-all turned into a permanent 503. Pin the query
  // shape: every range placeholder must carry an explicit ::date cast.
  const route = readFileSync(
    new URL('../app/api/ivrm/community-game-stats/read/route.ts', import.meta.url),
    'utf8',
  );
  const placeholders = route.match(/\$\{input\.(?:from|to)\}/g) ?? [];
  const casted = route.match(/\$\{input\.(?:from|to)\}::date/g) ?? [];
  assert.equal(placeholders.length, 12);
  assert.equal(casted.length, placeholders.length);
});
test('read route casts every SUM(value) aggregate to bigint (PG numeric regression)', () => {
  // SUM over the BigInt `value` column returns PG numeric, which
  // Prisma $queryRaw hands back as a Decimal object — not the
  // bigint / number / string the projections accept — so
  // toCommunityGameSeconds threw on every non-empty result and
  // the route's catch-all turned it into a permanent 503 (#1004).
  // Checking the returned values as strings masks this (a Decimal
  // stringifies to its digits), so pin the query shape instead:
  // every selected SUM(value) aggregate must carry an explicit
  // ::bigint cast. ORDER BY aggregates do not cross the wire and
  // need no cast.
  const route = readFileSync(
    new URL('../app/api/ivrm/community-game-stats/read/route.ts', import.meta.url),
    'utf8',
  );
  assert.equal((route.match(/SUM\(value\)::bigint AS "totalSeconds"/g) ?? []).length, 3);
  assert.equal((route.match(/SUM\(value\)::bigint AS total/g) ?? []).length, 1);
  assert.equal((route.match(/SUM\((?:inner_rows\.)?value\) AS/g) ?? []).length, 0);
});
