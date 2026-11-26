import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  authorizeCommunityGameStatsRead,
  buildCommunityMatrix,
  buildCommunityMomentum,
  buildCommunityWeekdaySeconds,
  COMMUNITY_GAME_STATS_MATRIX_GAMES_LIMIT,
  COMMUNITY_GAME_STATS_PATH,
  COMMUNITY_GAME_STATS_PURPOSE,
  formatCommunityGameEarliestDate,
  projectCommunityActivityMessageRankingRow,
  projectCommunityActivityTotals,
  projectCommunityActivityUserTotals,
  projectCommunityActivityVoiceRankingRow,
  projectCommunityGameDailyPointRow,
  projectCommunityGameDetailRow,
  projectCommunityGamePlayerRow,
  projectCommunityGameRankingRow,
  projectCommunityGameStatRow,
  projectCommunityInsightsTotalsRow,
  projectCommunityMatrixCellRow,
  projectCommunityMomentumNewPlayersRow,
  projectCommunityMomentumRecentRow,
  projectCommunityTopGameRow,
  projectCommunityUserGameRow,
  projectCommunityWeekdaySecondsRow,
  summarizeCommunityPlayDates,
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
    gameName: null,
    version: 1,
  });
  assert.deepEqual(
    await authorizeCommunityGameStatsRead(
      signed({ ...input, mode: 'user', discordUserId: '100000000000000002' }),
      environment,
    ),
    { ...input, mode: 'user', discordUserId: '100000000000000002', gameName: null, version: 1 },
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
    { ...input, gameName: 'VALORANT' },
    { ...input, version: 4 },
    { ...input, version: 0 },
    { ...input, version: '2' },
    { ...input, version: 1.5 },
    { ...input, version: null },
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
  assert.equal(placeholders.length, 61);
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
  assert.equal((route.match(/SUM\(value\)::bigint AS "totalSeconds"/g) ?? []).length, 11);
  assert.equal((route.match(/SUM\(value\)::bigint AS total/g) ?? []).length, 3);
  assert.equal((route.match(/SUM\(value\)::bigint AS "totalCount"/g) ?? []).length, 1);
  assert.equal((route.match(/SUM\((?:inner_rows\.)?value\) AS/g) ?? []).length, 0);
  // v3 additions follow the same rule: the matrix cells read
  // through the daily alias, and the momentum window coalesces
  // an empty LEFT JOIN before the cast.
  assert.equal((route.match(/SUM\(daily\.value\)::bigint AS "totalSeconds"/g) ?? []).length, 1);
  assert.equal(
    (route.match(/COALESCE\(SUM\(daily\.value\), 0\)::bigint AS "recentSeconds"/g) ?? []).length,
    1,
  );
  assert.equal((route.match(/SUM\(daily\.value\) AS/g) ?? []).length, 0);
});
test('version 2 is negotiated by the signed body and defaults to 1', async () => {
  assert.deepEqual(
    await authorizeCommunityGameStatsRead(signed({ ...input, version: 2 }), environment),
    {
      ...input,
      mode: 'overview',
      discordUserId: null,
      gameName: null,
      version: 2,
    },
  );
  assert.deepEqual(
    await authorizeCommunityGameStatsRead(
      signed({ ...input, mode: 'user', discordUserId: '100000000000000002', version: 2 }),
      environment,
    ),
    { ...input, mode: 'user', discordUserId: '100000000000000002', gameName: null, version: 2 },
  );
  assert.deepEqual(
    await authorizeCommunityGameStatsRead(signed({ ...input, version: 1 }), environment),
    { ...input, mode: 'overview', discordUserId: null, gameName: null, version: 1 },
  );
});
test('activity row projections emit exactly the contract fields', () => {
  const voice = projectCommunityActivityVoiceRankingRow({
    discordUserId: '100000000000000002',
    totalSeconds: 7200n,
  });
  assert.deepEqual(voice, { discordUserId: '100000000000000002', totalSeconds: 7200 });
  assert.deepEqual(Object.keys(voice).sort(), ['discordUserId', 'totalSeconds']);
  const message = projectCommunityActivityMessageRankingRow({
    discordUserId: '100000000000000002',
    totalCount: '30',
  });
  assert.deepEqual(message, { discordUserId: '100000000000000002', totalCount: 30 });
  assert.deepEqual(Object.keys(message).sort(), ['discordUserId', 'totalCount']);
  assert.throws(() =>
    projectCommunityActivityVoiceRankingRow({ discordUserId: '123', totalSeconds: 1 }),
  );
  assert.throws(() =>
    projectCommunityActivityMessageRankingRow({
      discordUserId: '100000000000000002',
      totalCount: 1.5,
    }),
  );
  // A Decimal-shaped aggregate (object) must throw, not pass through (#1004).
  assert.throws(() =>
    projectCommunityActivityVoiceRankingRow({
      discordUserId: '100000000000000002',
      totalSeconds: { toString: () => '7200' },
    }),
  );
});
test('activity totals projections zero-fill missing metrics and reject unknown ones', () => {
  assert.deepEqual(
    projectCommunityActivityTotals([
      { metric: 'voice_seconds', total: 5400n, memberCount: 2 },
      { metric: 'messages', total: 45, memberCount: 3 },
    ]),
    {
      voiceSeconds: 5400,
      messageCount: 45,
      onlineSeconds: 0,
      voiceMemberCount: 2,
      messageMemberCount: 3,
    },
  );
  assert.deepEqual(projectCommunityActivityTotals([]), {
    voiceSeconds: 0,
    messageCount: 0,
    onlineSeconds: 0,
    voiceMemberCount: 0,
    messageMemberCount: 0,
  });
  assert.deepEqual(
    projectCommunityActivityUserTotals([
      { metric: 'online_seconds', total: '86400' },
      { metric: 'voice_seconds', total: 60n },
    ]),
    { voiceSeconds: 60, messageCount: 0, onlineSeconds: 86400 },
  );
  assert.throws(() =>
    projectCommunityActivityTotals([{ metric: 'reactions_given', total: 1n, memberCount: 1 }]),
  );
  assert.throws(() =>
    projectCommunityActivityTotals([
      { metric: 'messages', total: 1n, memberCount: 1 },
      { metric: 'messages', total: 2n, memberCount: 1 },
    ]),
  );
  assert.throws(() =>
    projectCommunityActivityTotals([{ metric: 'messages', total: 1n, memberCount: -1 }]),
  );
  assert.throws(() => projectCommunityActivityUserTotals([{ metric: 'messages', total: -1n }]));
});
test('v2 contract JSON extends v1 without changing the v1 shapes', () => {
  const read = (name: string) =>
    JSON.parse(
      readFileSync(new URL(`../../../../contracts/ivrm/${name}`, import.meta.url), 'utf8'),
    ) as {
      $id: string;
      description: string;
      $defs: Record<string, { required?: string[]; properties?: Record<string, unknown> }>;
    };
  const v1 = read('herta-community-game-stats-read.v1.json');
  const v2 = read('herta-community-game-stats-read.v2.json');
  assert.equal(v2.$id, 'https://ivrm.jp/contracts/herta-community-game-stats-read/v2');
  assert.ok(v2.description.includes(COMMUNITY_GAME_STATS_PATH));
  assert.ok(v2.description.includes(COMMUNITY_GAME_STATS_PURPOSE));
  // The v1 response shapes are carried over byte-for-byte in structure.
  assert.deepEqual(v2.$defs.overviewResponse, v1.$defs.overviewResponse);
  assert.deepEqual(v2.$defs.userResponse, v1.$defs.userResponse);
  // The request only gains the optional version field.
  assert.deepEqual(v2.$defs.request.required, v1.$defs.request.required);
  assert.deepEqual(
    Object.keys(v2.$defs.request.properties ?? {}).sort(),
    [...Object.keys(v1.$defs.request.properties ?? {}), 'version'].sort(),
  );
  // V2 responses require the activity section on top of the v1 shape.
  for (const [v2Def, v1Def] of [
    ['overviewResponseV2', 'overviewResponse'],
    ['userResponseV2', 'userResponse'],
  ] as const) {
    assert.deepEqual(
      [...(v2.$defs[v2Def].required ?? [])].sort(),
      [...(v1.$defs[v1Def].required ?? []), 'activity'].sort(),
    );
    assert.deepEqual(
      Object.keys(v2.$defs[v2Def].properties ?? {})
        .filter((key) => key !== 'activity')
        .sort(),
      Object.keys(v1.$defs[v1Def].properties ?? {}).sort(),
    );
  }
  assert.deepEqual(Object.keys(v2.$defs.activityUser.properties ?? {}).sort(), [
    'messageCount',
    'onlineSeconds',
    'voiceSeconds',
  ]);
  assert.deepEqual(Object.keys(v2.$defs.activityOverview.properties ?? {}).sort(), [
    'messageRanking',
    'totals',
    'voiceRanking',
  ]);
});
test('read route scopes activity queries to the three contract metrics', () => {
  const route = readFileSync(
    new URL('../app/api/ivrm/community-game-stats/read/route.ts', import.meta.url),
    'utf8',
  );
  assert.equal(
    (route.match(/metric IN \('voice_seconds', 'messages', 'online_seconds'\)/g) ?? []).length,
    2,
  );
  assert.equal((route.match(/metric = 'voice_seconds'/g) ?? []).length, 2);
  assert.equal((route.match(/metric = 'messages'/g) ?? []).length, 2);
  assert.ok(!route.includes('reactions'));
});
test('version 3 negotiates like v2 and unlocks the game mode', async () => {
  assert.deepEqual(
    await authorizeCommunityGameStatsRead(signed({ ...input, version: 3 }), environment),
    { ...input, mode: 'overview', discordUserId: null, gameName: null, version: 3 },
  );
  assert.deepEqual(
    await authorizeCommunityGameStatsRead(
      signed({ ...input, mode: 'game', gameName: 'VALORANT', version: 3 }),
      environment,
    ),
    { ...input, mode: 'game', discordUserId: null, gameName: 'VALORANT', version: 3 },
  );
  assert.deepEqual(
    await authorizeCommunityGameStatsRead(
      signed({
        ...input,
        mode: 'game',
        gameName: '原神',
        discordUserId: '100000000000000002',
        version: 3,
      }),
      environment,
    ),
    {
      ...input,
      mode: 'game',
      discordUserId: '100000000000000002',
      gameName: '原神',
      version: 3,
    },
  );
  for (const value of [
    // The game mode is v3-only and always names its game.
    { ...input, mode: 'game', gameName: 'VALORANT' },
    { ...input, mode: 'game', gameName: 'VALORANT', version: 2 },
    { ...input, mode: 'game', version: 3 },
    { ...input, mode: 'game', gameName: '', version: 3 },
    { ...input, mode: 'game', gameName: '   ', version: 3 },
    { ...input, mode: 'game', gameName: 'x'.repeat(129), version: 3 },
    { ...input, mode: 'game', gameName: 'VALORANT', discordUserId: 'nope', version: 3 },
    // gameName is meaningless (and rejected) outside the game mode.
    {
      ...input,
      mode: 'user',
      discordUserId: '100000000000000002',
      gameName: 'VALORANT',
      version: 3,
    },
  ]) {
    const response = await authorizeCommunityGameStatsRead(signed(value), environment);
    assert.ok(response instanceof Response);
    assert.equal(response.status, 422);
  }
});
test('insights projections emit exactly the contract fields', () => {
  assert.deepEqual(projectCommunityInsightsTotalsRow({ totalSeconds: 7200n, playerCount: 3 }), {
    totalSeconds: 7200,
    playerCount: 3,
  });
  assert.throws(() => projectCommunityInsightsTotalsRow({ totalSeconds: 1n, playerCount: 1.5 }));
  assert.equal(projectCommunityTopGameRow({ name: 'VALORANT' }), 'VALORANT');
  assert.throws(() => projectCommunityTopGameRow({ name: '' }));
  assert.deepEqual(
    projectCommunityGameDailyPointRow({
      date: new Date('2026-11-24T00:00:00.000Z'),
      totalSeconds: 60n,
    }),
    { date: '2026-11-24', totalSeconds: 60 },
  );
  assert.throws(() => projectCommunityGameDailyPointRow({ date: null, totalSeconds: 60n }));
  const detail = projectCommunityGameDetailRow({
    name: 'VALORANT',
    totalSeconds: '1997400',
    playerCount: 16,
    firstPlayDate: new Date('2026-09-30T00:00:00.000Z'),
    lastPlayDate: '2026-11-25',
  });
  assert.deepEqual(detail, {
    name: 'VALORANT',
    totalSeconds: 1997400,
    playerCount: 16,
    firstPlayDate: '2026-09-30',
    lastPlayDate: '2026-11-25',
  });
  assert.deepEqual(Object.keys(detail).sort(), [
    'firstPlayDate',
    'lastPlayDate',
    'name',
    'playerCount',
    'totalSeconds',
  ]);
  assert.deepEqual(
    projectCommunityGamePlayerRow({ discordUserId: '100000000000000002', totalSeconds: 30 }),
    { discordUserId: '100000000000000002', totalSeconds: 30 },
  );
  assert.throws(() => projectCommunityGamePlayerRow({ discordUserId: '123', totalSeconds: 30 }));
  // A Decimal-shaped aggregate must throw, not pass through (#1004).
  assert.throws(() =>
    projectCommunityGameDetailRow({
      name: 'VALORANT',
      totalSeconds: { toString: () => '1' },
      playerCount: 1,
      firstPlayDate: null,
      lastPlayDate: null,
    }),
  );
});
test('matrix assembly aligns cells to the top games and zero-fills', () => {
  const games = ['VALORANT', '原神'];
  const members = [
    { discordUserId: '100000000000000002' },
    { discordUserId: '100000000000000003' },
  ];
  const cells = [
    projectCommunityMatrixCellRow({
      discordUserId: '100000000000000002',
      name: '原神',
      totalSeconds: 120n,
    }),
    projectCommunityMatrixCellRow({
      discordUserId: '100000000000000003',
      name: 'VALORANT',
      totalSeconds: 60,
    }),
    // A cell outside the member list is dropped, never widens the shape.
    projectCommunityMatrixCellRow({
      discordUserId: '100000000000000099',
      name: 'VALORANT',
      totalSeconds: 1,
    }),
  ];
  assert.deepEqual(buildCommunityMatrix(games, members, cells), [
    { discordUserId: '100000000000000002', secondsByGame: [0, 120] },
    { discordUserId: '100000000000000003', secondsByGame: [60, 0] },
  ]);
  assert.throws(() =>
    projectCommunityMatrixCellRow({ discordUserId: '123', name: 'VALORANT', totalSeconds: 1 }),
  );
});
test('weekday assembly is Monday-first and zero-fills missing days', () => {
  const rows = [
    projectCommunityWeekdaySecondsRow({ isoDow: 1, totalSeconds: 3600n }),
    projectCommunityWeekdaySecondsRow({ isoDow: 7, totalSeconds: '60' }),
  ];
  assert.deepEqual(buildCommunityWeekdaySeconds(rows), [3600, 0, 0, 0, 0, 0, 60]);
  assert.deepEqual(buildCommunityWeekdaySeconds([]), [0, 0, 0, 0, 0, 0, 0]);
  assert.throws(() => projectCommunityWeekdaySecondsRow({ isoDow: 0, totalSeconds: 1 }));
  assert.throws(() => projectCommunityWeekdaySecondsRow({ isoDow: 8, totalSeconds: 1 }));
  assert.throws(() =>
    buildCommunityWeekdaySeconds([
      { isoDow: 3, totalSeconds: 1 },
      { isoDow: 3, totalSeconds: 2 },
    ]),
  );
});
test('momentum merge keeps the top-games order and zero-fills gaps', () => {
  const games = ['VALORANT', '原神', 'Minecraft'];
  const recent = [projectCommunityMomentumRecentRow({ name: '原神', recentSeconds: 300n })];
  const fresh = [
    projectCommunityMomentumNewPlayersRow({ name: 'VALORANT', newPlayerCount: 2 }),
    projectCommunityMomentumNewPlayersRow({ name: '原神', newPlayerCount: 1 }),
  ];
  assert.deepEqual(buildCommunityMomentum(games, recent, fresh), [
    { name: 'VALORANT', recentSeconds: 0, newPlayerCount: 2 },
    { name: '原神', recentSeconds: 300, newPlayerCount: 1 },
    { name: 'Minecraft', recentSeconds: 0, newPlayerCount: 0 },
  ]);
  assert.throws(() =>
    projectCommunityMomentumNewPlayersRow({ name: 'VALORANT', newPlayerCount: -1 }),
  );
});
test('streak summary counts consecutive observed days only', () => {
  assert.deepEqual(summarizeCommunityPlayDates([]), {
    longestStreakDays: 0,
    currentStreakDays: 0,
    lastPlayDate: null,
  });
  assert.deepEqual(summarizeCommunityPlayDates(['2026-11-25']), {
    longestStreakDays: 1,
    currentStreakDays: 1,
    lastPlayDate: '2026-11-25',
  });
  // Unsorted input with duplicates is normalized; the gap on
  // 11-23 breaks the run, so the current streak is the tail.
  assert.deepEqual(
    summarizeCommunityPlayDates([
      '2026-11-25',
      '2026-11-24',
      '2026-11-21',
      '2026-11-22',
      '2026-11-21',
      '2026-11-20',
    ]),
    { longestStreakDays: 3, currentStreakDays: 2, lastPlayDate: '2026-11-25' },
  );
  // A month boundary still counts as consecutive days.
  assert.deepEqual(summarizeCommunityPlayDates(['2026-10-31', '2026-11-01']), {
    longestStreakDays: 2,
    currentStreakDays: 2,
    lastPlayDate: '2026-11-01',
  });
  assert.throws(() => summarizeCommunityPlayDates(['2026-02-30']));
});
test('v3 contract JSON extends v2 without changing the v1/v2 shapes', () => {
  const read = (name: string) =>
    JSON.parse(
      readFileSync(new URL(`../../../../contracts/ivrm/${name}`, import.meta.url), 'utf8'),
    ) as {
      $id: string;
      description: string;
      $defs: Record<string, { required?: string[]; properties?: Record<string, unknown> }>;
    };
  const v2 = read('herta-community-game-stats-read.v2.json');
  const v3 = read('herta-community-game-stats-read.v3.json');
  assert.equal(v3.$id, 'https://ivrm.jp/contracts/herta-community-game-stats-read/v3');
  assert.ok(v3.description.includes(COMMUNITY_GAME_STATS_PATH));
  assert.ok(v3.description.includes(COMMUNITY_GAME_STATS_PURPOSE));
  // Every v2 definition except the request (which gains
  // gameName below) is carried over unchanged in structure.
  for (const name of Object.keys(v2.$defs).filter((key) => key !== 'request'))
    assert.deepEqual(v3.$defs[name], v2.$defs[name]);
  // The request only gains gameName and the widened enums.
  assert.deepEqual(
    Object.keys(v3.$defs.request.properties ?? {}).sort(),
    [...Object.keys(v2.$defs.request.properties ?? {}), 'gameName'].sort(),
  );
  assert.deepEqual(v3.$defs.request.required, v2.$defs.request.required);
  // V3 responses require insights on top of the v2 shape.
  for (const [v3Def, v2Def] of [
    ['overviewResponseV3', 'overviewResponseV2'],
    ['userResponseV3', 'userResponseV2'],
  ] as const) {
    assert.deepEqual(
      [...(v3.$defs[v3Def].required ?? [])].sort(),
      [...(v2.$defs[v2Def].required ?? []), 'insights'].sort(),
    );
    assert.deepEqual(
      Object.keys(v3.$defs[v3Def].properties ?? {})
        .filter((key) => key !== 'insights')
        .sort(),
      Object.keys(v2.$defs[v2Def].properties ?? {}).sort(),
    );
  }
  assert.deepEqual(Object.keys(v3.$defs.gameResponse.properties ?? {}).sort(), [
    'game',
    'guildId',
    'meta',
    'mode',
    'players',
    'range',
    'status',
    'viewer',
  ]);
  assert.deepEqual(Object.keys(v3.$defs.insightsOverview.properties ?? {}).sort(), [
    'matrix',
    'momentum',
    'totals',
    'weekdaySeconds',
  ]);
  assert.deepEqual(Object.keys(v3.$defs.insightsUser.properties ?? {}).sort(), [
    'currentStreakDays',
    'dailySeries',
    'lastPlayDate',
    'longestStreakDays',
    'playDays',
    'weekdaySeconds',
  ]);
});
test('read route pins the v3 query shapes (top-15 CTEs, ISODOW casts)', () => {
  const route = readFileSync(
    new URL('../app/api/ivrm/community-game-stats/read/route.ts', import.meta.url),
    'utf8',
  );
  // The top-15 selection is spelled identically in the plain
  // query and in the three CTEs (cells / momentum / new players).
  assert.equal((route.match(/WITH top_games AS/g) ?? []).length, 3);
  assert.equal((route.match(/\$\{COMMUNITY_GAME_STATS_MATRIX_GAMES_LIMIT\}/g) ?? []).length, 4);
  assert.equal(COMMUNITY_GAME_STATS_MATRIX_GAMES_LIMIT, 15);
  // EXTRACT returns PG numeric, so the ISODOW casts to ::int
  // keep Prisma from handing back a Decimal the projection
  // would reject (#1004 class).
  assert.equal((route.match(/EXTRACT\(ISODOW FROM activity_date\)::int/g) ?? []).length, 2);
  // The viewer rank compares inside SQL (HAVING), never by
  // selecting an uncast aggregate.
  assert.ok(route.includes('HAVING SUM(value) >'));
});
