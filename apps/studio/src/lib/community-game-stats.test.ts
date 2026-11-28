import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  aggregateCommunityGamesOverviewV5,
  authorizeCommunityGameStatsRead,
  buildCommunityLeaderboardGameCounts,
  buildCommunityLeaderboardGrowth,
  buildCommunityMatrix,
  buildCommunityMatrixV5,
  buildCommunityMomentum,
  buildCommunityMomentumV5,
  buildCommunityUserGamesV5,
  buildCommunityWeekdaySeconds,
  buildCommunityWeeklyChampions,
  communityGamePreviousRange,
  COMMUNITY_CHANNEL_BREAKDOWN_LIMIT,
  COMMUNITY_GAME_STATS_MATRIX_GAMES_LIMIT,
  COMMUNITY_GAME_STATS_PATH,
  COMMUNITY_GAME_STATS_PURPOSE,
  COMMUNITY_WEEKLY_CHAMPION_LEADERS_LIMIT,
  formatCommunityGameEarliestDate,
  groupCommunityGameRows,
  communityGameGroupIdentity,
  isCommunityGameKey,
  projectCommunityActivityMessageRankingRow,
  projectCommunityActivityTotals,
  projectCommunityActivityUserTotals,
  projectCommunityActivityUserTotalsV4,
  projectCommunityActivityVoiceRankingRow,
  projectCommunityChannelMessageMemberRow,
  projectCommunityChannelMessageRow,
  projectCommunityChannelName,
  projectCommunityChannelVoiceMemberRow,
  projectCommunityChannelVoiceRow,
  projectCommunityCharUnitsRankingRow,
  projectCommunityCharUnitsTotalsRow,
  projectCommunityGameDailyPointRow,
  projectCommunityGameDetailRow,
  projectCommunityGameFirstPlayRow,
  projectCommunityGamePlayerRow,
  projectCommunityGameRankingRow,
  projectCommunityGameSourceRow,
  projectCommunityGameStatRow,
  projectCommunityGameUserSourceRow,
  projectCommunityInsightsTotalsRow,
  projectCommunityLeaderboardGrowthRow,
  projectCommunityLeaderboardPlayDaysRow,
  projectCommunityMatrixCellRow,
  projectCommunityMomentumNewPlayersRow,
  projectCommunityMomentumRecentRow,
  projectCommunityTopGameRow,
  projectCommunityUserGameRow,
  projectCommunityWeekdaySecondsRow,
  projectCommunityWeeklyChampionRow,
  resolveCommunityGame,
  summarizeCommunityPlayDates,
  toCommunityGameSeconds,
  type CommunityGameIdentityMapping,
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
    gameApplicationId: null,
    gameKey: null,
    channelId: null,
    channelMetric: null,
    version: 1,
  });
  assert.deepEqual(
    await authorizeCommunityGameStatsRead(
      signed({ ...input, mode: 'user', discordUserId: '100000000000000002' }),
      environment,
    ),
    {
      ...input,
      mode: 'user',
      discordUserId: '100000000000000002',
      gameName: null,
      gameApplicationId: null,
      gameKey: null,
      channelId: null,
      channelMetric: null,
      version: 1,
    },
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
  // 73 through v4; v5 adds the unified per-user reads, the
  // v5 insights reads and the game-detail selector reads;
  // v6 adds the leaderboards reads (the unified source rows,
  // the play-days read and count, and the growth window
  // split, which names the range start twice more); v7 adds
  // the weekly champions read and the channel-mode reads
  // (totals, members, count, and the two viewer reads).
  assert.equal(placeholders.length, 112);
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
  // 12 through v4; v5 adds eight more through the same
  // alias (overview / user / insights unified reads, the
  // momentum window, and the two game-detail selectors);
  // v6 adds the leaderboards unified source read; v7 adds
  // the weekly champions read.
  assert.equal((route.match(/SUM\(value\)::bigint AS "totalSeconds"/g) ?? []).length, 22);
  // v7 channel mode reads the channel total, the member
  // page and the viewer total through one metric-neutral
  // alias; the branch projects it into the metric's field.
  assert.equal((route.match(/SUM\(value\)::bigint AS "totalValue"/g) ?? []).length, 3);
  assert.equal((route.match(/SUM\(value\)::bigint AS total/g) ?? []).length, 4);
  assert.equal((route.match(/SUM\(value\)::bigint AS "totalCount"/g) ?? []).length, 2);
  // v4 additions follow the same rule: the char-units totals
  // and ranking select through the totalUnits alias.
  assert.equal((route.match(/SUM\(value\)::bigint AS "totalUnits"/g) ?? []).length, 2);
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
      gameApplicationId: null,
      gameKey: null,
      channelId: null,
      channelMetric: null,
      version: 2,
    },
  );
  assert.deepEqual(
    await authorizeCommunityGameStatsRead(
      signed({ ...input, mode: 'user', discordUserId: '100000000000000002', version: 2 }),
      environment,
    ),
    {
      ...input,
      mode: 'user',
      discordUserId: '100000000000000002',
      gameName: null,
      gameApplicationId: null,
      gameKey: null,
      channelId: null,
      channelMetric: null,
      version: 2,
    },
  );
  assert.deepEqual(
    await authorizeCommunityGameStatsRead(signed({ ...input, version: 1 }), environment),
    {
      ...input,
      mode: 'overview',
      discordUserId: null,
      gameName: null,
      gameApplicationId: null,
      gameKey: null,
      channelId: null,
      channelMetric: null,
      version: 1,
    },
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
test('read route scopes activity queries to the contract metrics', () => {
  const route = readFileSync(
    new URL('../app/api/ivrm/community-game-stats/read/route.ts', import.meta.url),
    'utf8',
  );
  assert.equal(
    (route.match(/metric IN \('voice_seconds', 'messages', 'online_seconds'\)/g) ?? []).length,
    2,
  );
  // v4 widens only the user read to message_char_units; the
  // channel breakdowns scope to one metric each, and the
  // char-units totals / ranking / count name the metric
  // directly.
  assert.equal(
    (
      route.match(
        /metric IN \('voice_seconds', 'messages', 'online_seconds', 'message_char_units'\)/g,
      ) ?? []
    ).length,
    1,
  );
  assert.equal((route.match(/metric = 'voice_seconds'/g) ?? []).length, 3);
  assert.equal((route.match(/metric = 'messages'/g) ?? []).length, 3);
  assert.equal((route.match(/metric = 'message_char_units'/g) ?? []).length, 3);
  assert.ok(!route.includes('reactions'));
});
test('version 3 negotiates like v2 and unlocks the game mode', async () => {
  assert.deepEqual(
    await authorizeCommunityGameStatsRead(signed({ ...input, version: 3 }), environment),
    {
      ...input,
      mode: 'overview',
      discordUserId: null,
      gameName: null,
      gameApplicationId: null,
      gameKey: null,
      channelId: null,
      channelMetric: null,
      version: 3,
    },
  );
  assert.deepEqual(
    await authorizeCommunityGameStatsRead(
      signed({ ...input, mode: 'game', gameName: 'VALORANT', version: 3 }),
      environment,
    ),
    {
      ...input,
      mode: 'game',
      discordUserId: null,
      gameName: 'VALORANT',
      gameApplicationId: null,
      gameKey: null,
      channelId: null,
      channelMetric: null,
      version: 3,
    },
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
      gameApplicationId: null,
      gameKey: null,
      channelId: null,
      channelMetric: null,
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
      gameApplicationId: null,
      gameKey: null,
      channelId: null,
      channelMetric: null,
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
  // would reject (#1004 class). Two through v4 (overview /
  // user insights); the v5 insights variant adds the third.
  assert.equal((route.match(/EXTRACT\(ISODOW FROM activity_date\)::int/g) ?? []).length, 3);
  // The viewer rank compares inside SQL (HAVING), never by
  // selecting an uncast aggregate.
  assert.ok(route.includes('HAVING SUM(value) >'));
});
test('version 4 negotiates like v3 and keeps the game mode', async () => {
  assert.deepEqual(
    await authorizeCommunityGameStatsRead(signed({ ...input, version: 4 }), environment),
    {
      ...input,
      mode: 'overview',
      discordUserId: null,
      gameName: null,
      gameApplicationId: null,
      gameKey: null,
      channelId: null,
      channelMetric: null,
      version: 4,
    },
  );
  assert.deepEqual(
    await authorizeCommunityGameStatsRead(
      signed({ ...input, mode: 'user', discordUserId: '100000000000000002', version: 4 }),
      environment,
    ),
    {
      ...input,
      mode: 'user',
      discordUserId: '100000000000000002',
      gameName: null,
      gameApplicationId: null,
      gameKey: null,
      channelId: null,
      channelMetric: null,
      version: 4,
    },
  );
  // The game mode shape is unchanged in v4, so it unlocks
  // at version 3 and stays available at version 4.
  assert.deepEqual(
    await authorizeCommunityGameStatsRead(
      signed({ ...input, mode: 'game', gameName: 'VALORANT', version: 4 }),
      environment,
    ),
    {
      ...input,
      mode: 'game',
      discordUserId: null,
      gameName: 'VALORANT',
      gameApplicationId: null,
      gameKey: null,
      channelId: null,
      channelMetric: null,
      version: 4,
    },
  );
  for (const value of [
    { ...input, version: 0 },
    { ...input, mode: 'game', gameName: 'VALORANT', version: 2 },
  ]) {
    const response = await authorizeCommunityGameStatsRead(signed(value), environment);
    assert.ok(response instanceof Response);
    assert.equal(response.status, 422);
  }
});
test('channels projections emit exactly the contract fields', () => {
  const voice = projectCommunityChannelVoiceRow({
    channelId: '100000000000000010',
    totalSeconds: 7200n,
    memberCount: 3,
  });
  assert.deepEqual(voice, {
    channelId: '100000000000000010',
    totalSeconds: 7200,
    memberCount: 3,
  });
  assert.deepEqual(Object.keys(voice).sort(), ['channelId', 'memberCount', 'totalSeconds']);
  const message = projectCommunityChannelMessageRow({
    channelId: '100000000000000011',
    totalCount: '45',
    memberCount: 2,
  });
  assert.deepEqual(message, {
    channelId: '100000000000000011',
    totalCount: 45,
    memberCount: 2,
  });
  assert.throws(() =>
    projectCommunityChannelVoiceRow({ channelId: '123', totalSeconds: 1, memberCount: 1 }),
  );
  assert.throws(() =>
    projectCommunityChannelMessageRow({
      channelId: '100000000000000011',
      totalCount: 1,
      memberCount: -1,
    }),
  );
  // A Decimal-shaped aggregate must throw, not pass through (#1004).
  assert.throws(() =>
    projectCommunityChannelVoiceRow({
      channelId: '100000000000000010',
      totalSeconds: { toString: () => '7200' },
      memberCount: 1,
    }),
  );
  const charRow = projectCommunityCharUnitsRankingRow({
    discordUserId: '100000000000000002',
    totalUnits: 19542n,
  });
  assert.deepEqual(charRow, { discordUserId: '100000000000000002', totalUnits: 19542 });
  assert.deepEqual(Object.keys(charRow).sort(), ['discordUserId', 'totalUnits']);
  assert.deepEqual(projectCommunityCharUnitsTotalsRow({ totalUnits: '19542', memberCount: 14 }), {
    totalUnits: 19542,
    memberCount: 14,
  });
  assert.throws(() => projectCommunityCharUnitsRankingRow({ discordUserId: '123', totalUnits: 1 }));
});
test('channel name projection keeps plausible names and degrades the rest to null', () => {
  assert.equal(projectCommunityChannelName('general-vc'), 'general-vc');
  assert.equal(projectCommunityChannelName('  雑談  '), '雑談');
  assert.equal(projectCommunityChannelName(undefined), null);
  assert.equal(projectCommunityChannelName(null), null);
  assert.equal(projectCommunityChannelName(''), null);
  assert.equal(projectCommunityChannelName('   '), null);
  assert.equal(projectCommunityChannelName('x'.repeat(101)), null);
  assert.equal(projectCommunityChannelName(42), null);
});
test('user totals v4 projection adds messageCharUnits and rejects unknown metrics', () => {
  assert.deepEqual(
    projectCommunityActivityUserTotalsV4([
      { metric: 'message_char_units', total: 120n },
      { metric: 'voice_seconds', total: 60 },
    ]),
    { voiceSeconds: 60, messageCount: 0, onlineSeconds: 0, messageCharUnits: 120 },
  );
  assert.deepEqual(projectCommunityActivityUserTotalsV4([]), {
    voiceSeconds: 0,
    messageCount: 0,
    onlineSeconds: 0,
    messageCharUnits: 0,
  });
  // The v2 projection stays strict: a char-units row there
  // is a bug, not data to forward.
  assert.throws(() =>
    projectCommunityActivityUserTotals([{ metric: 'message_char_units', total: 1n }]),
  );
  assert.throws(() => projectCommunityActivityUserTotalsV4([{ metric: 'commands', total: 1n }]));
  assert.throws(() =>
    projectCommunityActivityUserTotalsV4([
      { metric: 'message_char_units', total: 1n },
      { metric: 'message_char_units', total: 2n },
    ]),
  );
});
test('v4 contract JSON extends v3 without changing the v1/v2/v3 shapes', () => {
  const read = (name: string) =>
    JSON.parse(
      readFileSync(new URL(`../../../../contracts/ivrm/${name}`, import.meta.url), 'utf8'),
    ) as {
      $id: string;
      description: string;
      $defs: Record<string, { required?: string[]; properties?: Record<string, unknown> }>;
    };
  const v3 = read('herta-community-game-stats-read.v3.json');
  const v4 = read('herta-community-game-stats-read.v4.json');
  assert.equal(v4.$id, 'https://ivrm.jp/contracts/herta-community-game-stats-read/v4');
  assert.ok(v4.description.includes(COMMUNITY_GAME_STATS_PATH));
  assert.ok(v4.description.includes(COMMUNITY_GAME_STATS_PURPOSE));
  // Every v3 definition except the request is carried over
  // unchanged in structure.
  for (const name of Object.keys(v3.$defs).filter((key) => key !== 'request'))
    assert.deepEqual(v4.$defs[name], v3.$defs[name]);
  // The request only widens the version enum.
  assert.deepEqual(
    Object.keys(v4.$defs.request.properties ?? {}).sort(),
    Object.keys(v3.$defs.request.properties ?? {}).sort(),
  );
  assert.deepEqual(v4.$defs.request.required, v3.$defs.request.required);
  // V4 overview requires channels on top of the v3 shape.
  assert.deepEqual(
    [...(v4.$defs.overviewResponseV4.required ?? [])].sort(),
    [...(v3.$defs.overviewResponseV3.required ?? []), 'channels'].sort(),
  );
  assert.deepEqual(
    Object.keys(v4.$defs.overviewResponseV4.properties ?? {})
      .filter((key) => key !== 'channels')
      .sort(),
    Object.keys(v3.$defs.overviewResponseV3.properties ?? {}).sort(),
  );
  // V4 user keeps the v3 keys; only the activity payload
  // widens (activityUserV4 adds messageCharUnits).
  assert.deepEqual(
    [...(v4.$defs.userResponseV4.required ?? [])].sort(),
    [...(v3.$defs.userResponseV3.required ?? [])].sort(),
  );
  assert.deepEqual(
    Object.keys(v4.$defs.userResponseV4.properties ?? {}).sort(),
    Object.keys(v3.$defs.userResponseV3.properties ?? {}).sort(),
  );
  assert.deepEqual(
    [...(v4.$defs.activityUserV4.required ?? [])].sort(),
    [...(v3.$defs.activityUser.required ?? []), 'messageCharUnits'].sort(),
  );
  assert.deepEqual(Object.keys(v4.$defs.channelsOverview.properties ?? {}).sort(), [
    'charUnits',
    'messageChannels',
    'recordedFrom',
    'voiceChannels',
  ]);
});
test('read route pins the v4 query shapes (channel table, breakdown cap, name lookup)', () => {
  const route = readFileSync(
    new URL('../app/api/ivrm/community-game-stats/read/route.ts', import.meta.url),
    'utf8',
  );
  // Both channel breakdowns read the channel daily table;
  // recordedFrom is its guild-wide MIN, not range-limited.
  // v7 adds the channel mode's six reads of the same table
  // (recordedFrom, totals, members, count, and the two
  // viewer reads).
  assert.equal((route.match(/FROM community_activity_channel_daily/g) ?? []).length, 9);
  assert.ok(route.includes('MIN(activity_date) AS "recordedFrom"'));
  // The breakdown cap is the shared constant in both lists.
  assert.equal((route.match(/\$\{COMMUNITY_CHANNEL_BREAKDOWN_LIMIT\}/g) ?? []).length, 2);
  assert.equal(COMMUNITY_CHANNEL_BREAKDOWN_LIMIT, 25);
  // Channel names resolve through the cached guild options,
  // never from a database column (none exists).
  assert.ok(route.includes('getGuildConfigurationOptionsCached'));
  assert.ok(route.includes("console.error('community_channels_read_failed', error)"));
});
const identityMappings: CommunityGameIdentityMapping[] = [
  {
    canonicalName: 'Genshin Impact',
    applicationIds: ['762434991303950386'],
    activityNames: ['原神'],
  },
  {
    canonicalName: 'Honkai: Star Rail',
    applicationIds: ['1121201675240210523'],
    activityNames: ['崩壊：スターレイル'],
  },
];
test('version 5 negotiates like v4 and unlocks the id / key game selectors', async () => {
  assert.deepEqual(
    await authorizeCommunityGameStatsRead(signed({ ...input, version: 5 }), environment),
    {
      ...input,
      mode: 'overview',
      discordUserId: null,
      gameName: null,
      gameApplicationId: null,
      gameKey: null,
      channelId: null,
      channelMetric: null,
      version: 5,
    },
  );
  assert.deepEqual(
    await authorizeCommunityGameStatsRead(
      signed({ ...input, mode: 'game', gameApplicationId: '762434991303950386', version: 5 }),
      environment,
    ),
    {
      ...input,
      mode: 'game',
      discordUserId: null,
      gameName: null,
      gameApplicationId: '762434991303950386',
      gameKey: null,
      channelId: null,
      channelMetric: null,
      version: 5,
    },
  );
  assert.deepEqual(
    await authorizeCommunityGameStatsRead(
      signed({ ...input, mode: 'game', gameKey: 'name:原神', version: 5 }),
      environment,
    ),
    {
      ...input,
      mode: 'game',
      discordUserId: null,
      gameName: null,
      gameApplicationId: null,
      gameKey: 'name:原神',
      channelId: null,
      channelMetric: null,
      version: 5,
    },
  );
  // gameName keeps working at v5 (exact-name figures).
  assert.deepEqual(
    await authorizeCommunityGameStatsRead(
      signed({ ...input, mode: 'game', gameName: 'VALORANT', version: 5 }),
      environment,
    ),
    {
      ...input,
      mode: 'game',
      discordUserId: null,
      gameName: 'VALORANT',
      gameApplicationId: null,
      gameKey: null,
      channelId: null,
      channelMetric: null,
      version: 5,
    },
  );
  for (const value of [
    // The new selectors are v5-only.
    { ...input, mode: 'game', gameApplicationId: '762434991303950386', version: 4 },
    { ...input, mode: 'game', gameKey: 'app:762434991303950386', version: 3 },
    // Exactly one selector must be present.
    { ...input, mode: 'game', version: 5 },
    { ...input, mode: 'game', gameName: 'VALORANT', gameKey: 'name:VALORANT', version: 5 },
    {
      ...input,
      mode: 'game',
      gameApplicationId: '762434991303950386',
      gameKey: 'app:762434991303950386',
      version: 5,
    },
    // Selector shapes are strict.
    { ...input, mode: 'game', gameApplicationId: '123', version: 5 },
    { ...input, mode: 'game', gameApplicationId: 'not-a-snowflake!', version: 5 },
    { ...input, mode: 'game', gameKey: 'app:123', version: 5 },
    { ...input, mode: 'game', gameKey: 'id:762434991303950386', version: 5 },
    { ...input, mode: 'game', gameKey: 'name:', version: 5 },
    { ...input, mode: 'game', gameKey: 'name:   ', version: 5 },
    // Selectors are meaningless outside the game mode.
    { ...input, gameApplicationId: '762434991303950386', version: 5 },
    {
      ...input,
      mode: 'user',
      discordUserId: '100000000000000002',
      gameKey: 'name:原神',
      version: 5,
    },
  ]) {
    const response = await authorizeCommunityGameStatsRead(signed(value), environment);
    assert.ok(response instanceof Response);
    assert.equal(response.status, 422);
  }
});
test('game key validation accepts only the produced shapes', () => {
  assert.equal(isCommunityGameKey('app:762434991303950386'), true);
  assert.equal(isCommunityGameKey('name:原神'), true);
  assert.equal(isCommunityGameKey('name:VALORANT'), true);
  assert.equal(isCommunityGameKey('app:123'), false);
  assert.equal(isCommunityGameKey('app:'), false);
  assert.equal(isCommunityGameKey('name:'), false);
  assert.equal(isCommunityGameKey('name:  '), false);
  assert.equal(isCommunityGameKey('原神'), false);
  assert.equal(isCommunityGameKey(''), false);
});
test('identity resolution follows the mapping decision order', () => {
  // 1. A mapped application id wins, whatever name the row carried.
  assert.deepEqual(resolveCommunityGame('原神', '762434991303950386', identityMappings), {
    key: 'app:762434991303950386',
    canonicalName: 'Genshin Impact',
    applicationId: '762434991303950386',
  });
  assert.deepEqual(resolveCommunityGame('Genshin Impact', '762434991303950386', identityMappings), {
    key: 'app:762434991303950386',
    canonicalName: 'Genshin Impact',
    applicationId: '762434991303950386',
  });
  // 2. An unmapped id groups by id — even when its name is a mapped alias.
  assert.deepEqual(resolveCommunityGame('原神', '999999999999999999', identityMappings), {
    key: 'app:999999999999999999',
    canonicalName: null,
    applicationId: '999999999999999999',
  });
  // 3. Id-less rows resolve by name: aliases and the canonical name itself.
  assert.deepEqual(resolveCommunityGame('原神', null, identityMappings), {
    key: 'app:762434991303950386',
    canonicalName: 'Genshin Impact',
    applicationId: '762434991303950386',
  });
  assert.deepEqual(resolveCommunityGame('Genshin Impact', null, identityMappings), {
    key: 'app:762434991303950386',
    canonicalName: 'Genshin Impact',
    applicationId: '762434991303950386',
  });
  assert.deepEqual(resolveCommunityGame('崩壊：スターレイル', null, identityMappings), {
    key: 'app:1121201675240210523',
    canonicalName: 'Honkai: Star Rail',
    applicationId: '1121201675240210523',
  });
  // Name matching follows the exclusion rule (trimmed, case-insensitive).
  assert.deepEqual(resolveCommunityGame(' genshin impact ', null, identityMappings), {
    key: 'app:762434991303950386',
    canonicalName: 'Genshin Impact',
    applicationId: '762434991303950386',
  });
  // 4. Anything else groups by its recorded name.
  assert.deepEqual(resolveCommunityGame('VALORANT', null, identityMappings), {
    key: 'name:VALORANT',
    canonicalName: null,
    applicationId: null,
  });
  assert.deepEqual(resolveCommunityGame('VALORANT', null, []), {
    key: 'name:VALORANT',
    canonicalName: null,
    applicationId: null,
  });
});
test('source row projection maps the empty id sentinel to null and rejects bad ids', () => {
  assert.deepEqual(
    projectCommunityGameSourceRow({ name: '原神', applicationId: '', totalSeconds: 60n }),
    { name: '原神', applicationId: null, totalSeconds: 60 },
  );
  assert.deepEqual(
    projectCommunityGameSourceRow({
      name: 'VALORANT',
      applicationId: '100000000000000001',
      totalSeconds: '30',
    }),
    { name: 'VALORANT', applicationId: '100000000000000001', totalSeconds: 30 },
  );
  assert.throws(() =>
    projectCommunityGameSourceRow({ name: 'VALORANT', applicationId: 'abc', totalSeconds: 1 }),
  );
  assert.throws(() =>
    projectCommunityGameSourceRow({ name: 'VALORANT', applicationId: 123, totalSeconds: 1 }),
  );
  assert.throws(() =>
    projectCommunityGameSourceRow({ name: 'VALORANT', applicationId: null, totalSeconds: 1 }),
  );
  // A Decimal-shaped aggregate must throw, not pass through (#1004).
  assert.throws(() =>
    projectCommunityGameSourceRow({
      name: 'VALORANT',
      applicationId: '',
      totalSeconds: { toString: () => '1' },
    }),
  );
  assert.deepEqual(
    projectCommunityGameUserSourceRow({
      discordUserId: '100000000000000002',
      name: '原神',
      applicationId: '',
      totalSeconds: 45,
    }),
    { discordUserId: '100000000000000002', name: '原神', applicationId: null, totalSeconds: 45 },
  );
  assert.throws(() =>
    projectCommunityGameUserSourceRow({
      discordUserId: '123',
      name: '原神',
      applicationId: '',
      totalSeconds: 45,
    }),
  );
  assert.deepEqual(
    projectCommunityGameFirstPlayRow({
      discordUserId: '100000000000000002',
      name: '原神',
      applicationId: '',
      firstDate: new Date('2026-11-24T00:00:00.000Z'),
    }),
    {
      discordUserId: '100000000000000002',
      name: '原神',
      applicationId: null,
      firstDate: '2026-11-24',
    },
  );
});
test('grouping unifies localized names and picks the display name by accumulated seconds', () => {
  const groups = groupCommunityGameRows(
    [
      { name: '原神', applicationId: null, totalSeconds: 500 },
      { name: '原神', applicationId: '762434991303950386', totalSeconds: 300 },
      { name: 'Genshin Impact', applicationId: '762434991303950386', totalSeconds: 200 },
      { name: 'VALORANT', applicationId: '100000000000000001', totalSeconds: 900 },
      { name: 'VALORANT', applicationId: null, totalSeconds: 100 },
    ],
    identityMappings,
  );
  // The mapped group merges past (id-less) and current rows;
  // its display name is the canonical name. The id-less
  // VALORANT rows stay a separate name group from the
  // id-carrying ones — the id is the stronger identity.
  assert.deepEqual(
    groups.map((group) => ({
      ...communityGameGroupIdentity(group),
      totalSeconds: group.totalSeconds,
    })),
    [
      {
        key: 'app:762434991303950386',
        name: 'Genshin Impact',
        applicationId: '762434991303950386',
        totalSeconds: 1000,
      },
      {
        key: 'app:100000000000000001',
        name: 'VALORANT',
        applicationId: '100000000000000001',
        totalSeconds: 900,
      },
      { key: 'name:VALORANT', name: 'VALORANT', applicationId: null, totalSeconds: 100 },
    ],
  );
  // Without a mapping, an id group's display name is the
  // name it accumulated the most seconds under (W7).
  const unmapped = groupCommunityGameRows(
    [
      { name: 'Star Rail', applicationId: '100000000000000009', totalSeconds: 100 },
      { name: 'Honkai: Star Rail', applicationId: '100000000000000009', totalSeconds: 300 },
    ],
    [],
  );
  assert.equal(unmapped.length, 1);
  assert.equal(
    communityGameGroupIdentity(unmapped[0] as (typeof unmapped)[number]).name,
    'Honkai: Star Rail',
  );
});
test('overview aggregation counts distinct players across names and unifies top games', () => {
  const aggregated = aggregateCommunityGamesOverviewV5(
    [
      {
        discordUserId: '100000000000000002',
        name: '原神',
        applicationId: null,
        totalSeconds: 500,
      },
      {
        discordUserId: '100000000000000002',
        name: 'Genshin Impact',
        applicationId: '762434991303950386',
        totalSeconds: 300,
      },
      {
        discordUserId: '100000000000000003',
        name: '原神',
        applicationId: null,
        totalSeconds: 100,
      },
      {
        discordUserId: '100000000000000003',
        name: 'VALORANT',
        applicationId: null,
        totalSeconds: 50,
      },
      {
        discordUserId: '100000000000000004',
        name: 'Genshin Impact',
        applicationId: '762434991303950386',
        totalSeconds: 200,
      },
    ],
    identityMappings,
  );
  // Member 002 played the same game under two names but is
  // one player of the unified game.
  assert.deepEqual(aggregated.games, [
    {
      identity: {
        key: 'app:762434991303950386',
        name: 'Genshin Impact',
        applicationId: '762434991303950386',
      },
      totalSeconds: 1100,
      playerCount: 3,
    },
    {
      identity: { key: 'name:VALORANT', name: 'VALORANT', applicationId: null },
      totalSeconds: 50,
      playerCount: 1,
    },
  ]);
  assert.deepEqual(aggregated.users, [
    {
      discordUserId: '100000000000000002',
      totalSeconds: 800,
      topGame: {
        key: 'app:762434991303950386',
        name: 'Genshin Impact',
        applicationId: '762434991303950386',
      },
    },
    {
      discordUserId: '100000000000000004',
      totalSeconds: 200,
      topGame: {
        key: 'app:762434991303950386',
        name: 'Genshin Impact',
        applicationId: '762434991303950386',
      },
    },
    {
      discordUserId: '100000000000000003',
      totalSeconds: 150,
      topGame: {
        key: 'app:762434991303950386',
        name: 'Genshin Impact',
        applicationId: '762434991303950386',
      },
    },
  ]);
});
test('user games unify the member history including pre-id rows', () => {
  assert.deepEqual(
    buildCommunityUserGamesV5(
      [
        { name: '原神', applicationId: null, totalSeconds: 500 },
        { name: 'Genshin Impact', applicationId: '762434991303950386', totalSeconds: 300 },
        { name: 'Minecraft', applicationId: null, totalSeconds: 100 },
      ],
      identityMappings,
    ),
    [
      {
        key: 'app:762434991303950386',
        name: 'Genshin Impact',
        applicationId: '762434991303950386',
        totalSeconds: 800,
      },
      { key: 'name:Minecraft', name: 'Minecraft', applicationId: null, totalSeconds: 100 },
    ],
  );
});
test('matrix v5 sums cells across the unified names', () => {
  const games = [
    {
      key: 'app:762434991303950386',
      name: 'Genshin Impact',
      applicationId: '762434991303950386',
    },
    { key: 'name:VALORANT', name: 'VALORANT', applicationId: null },
  ];
  const members = buildCommunityMatrixV5(
    games,
    [
      {
        discordUserId: '100000000000000002',
        name: '原神',
        applicationId: null,
        totalSeconds: 500,
      },
      {
        discordUserId: '100000000000000002',
        name: 'Genshin Impact',
        applicationId: '762434991303950386',
        totalSeconds: 300,
      },
      {
        discordUserId: '100000000000000003',
        name: 'VALORANT',
        applicationId: null,
        totalSeconds: 50,
      },
    ],
    identityMappings,
  );
  assert.deepEqual(members, [
    { discordUserId: '100000000000000002', secondsByGame: [800, 0] },
    { discordUserId: '100000000000000003', secondsByGame: [0, 50] },
  ]);
});
test('momentum v5 counts a new player once across aliases', () => {
  const games = [
    {
      key: 'app:762434991303950386',
      name: 'Genshin Impact',
      applicationId: '762434991303950386',
    },
    { key: 'name:VALORANT', name: 'VALORANT', applicationId: null },
  ];
  const momentum = buildCommunityMomentumV5(
    games,
    [
      { name: '原神', applicationId: null, totalSeconds: 100 },
      { name: 'Genshin Impact', applicationId: '762434991303950386', totalSeconds: 50 },
    ],
    [
      // The same member first played under both names; the
      // earlier date is the game's first play for them.
      {
        discordUserId: '100000000000000002',
        name: '原神',
        applicationId: null,
        firstDate: '2026-11-25',
      },
      {
        discordUserId: '100000000000000002',
        name: 'Genshin Impact',
        applicationId: '762434991303950386',
        firstDate: '2026-11-24',
      },
      {
        discordUserId: '100000000000000003',
        name: 'VALORANT',
        applicationId: null,
        firstDate: '2026-09-01',
      },
    ],
    identityMappings,
    { from: '2026-11-20', to: '2026-11-26' },
  );
  assert.deepEqual(momentum, [
    {
      key: 'app:762434991303950386',
      name: 'Genshin Impact',
      applicationId: '762434991303950386',
      recentSeconds: 150,
      newPlayerCount: 1,
    },
    {
      key: 'name:VALORANT',
      name: 'VALORANT',
      applicationId: null,
      recentSeconds: 0,
      newPlayerCount: 0,
    },
  ]);
});
test('v5 contract JSON extends v4 without changing the v1–v4 shapes', () => {
  const read = (name: string) =>
    JSON.parse(
      readFileSync(new URL(`../../../../contracts/ivrm/${name}`, import.meta.url), 'utf8'),
    ) as {
      $id: string;
      description: string;
      $defs: Record<string, { required?: string[]; properties?: Record<string, unknown> }>;
    };
  const v4 = read('herta-community-game-stats-read.v4.json');
  const v5 = read('herta-community-game-stats-read.v5.json');
  assert.equal(v5.$id, 'https://ivrm.jp/contracts/herta-community-game-stats-read/v5');
  assert.ok(v5.description.includes(COMMUNITY_GAME_STATS_PATH));
  assert.ok(v5.description.includes(COMMUNITY_GAME_STATS_PURPOSE));
  // Every v4 definition except the request is carried over
  // unchanged in structure.
  for (const name of Object.keys(v4.$defs).filter((key) => key !== 'request'))
    assert.deepEqual(v5.$defs[name], v4.$defs[name]);
  // The request only gains the two game selectors and the
  // widened version enum.
  assert.deepEqual(
    Object.keys(v5.$defs.request.properties ?? {}).sort(),
    [...Object.keys(v4.$defs.request.properties ?? {}), 'gameApplicationId', 'gameKey'].sort(),
  );
  assert.deepEqual(v5.$defs.request.required, v4.$defs.request.required);
  // The V5 responses keep the v4 section sets; only the
  // game-bearing payloads switch to the unified shapes.
  assert.deepEqual(
    Object.keys(v5.$defs.overviewResponseV5.properties ?? {}).sort(),
    Object.keys(v4.$defs.overviewResponseV4.properties ?? {}).sort(),
  );
  assert.deepEqual(
    Object.keys(v5.$defs.userResponseV5.properties ?? {}).sort(),
    Object.keys(v4.$defs.userResponseV4.properties ?? {}).sort(),
  );
  assert.deepEqual(
    Object.keys(v5.$defs.gameResponseV5.properties ?? {}).sort(),
    Object.keys(v4.$defs.gameResponse.properties ?? {}).sort(),
  );
  assert.deepEqual(Object.keys(v5.$defs.gameItemV5.properties ?? {}).sort(), [
    'applicationId',
    'key',
    'name',
    'playerCount',
    'totalSeconds',
  ]);
  assert.deepEqual(Object.keys(v5.$defs.rankingItemV5.properties ?? {}).sort(), [
    'discordUserId',
    'topGameKey',
    'topGameName',
    'totalSeconds',
  ]);
  assert.deepEqual(Object.keys(v5.$defs.gameDetailV5.properties ?? {}).sort(), [
    'applicationId',
    'firstPlayDate',
    'key',
    'lastPlayDate',
    'name',
    'playerCount',
    'totalSeconds',
  ]);
  assert.deepEqual(Object.keys(v5.$defs.insightsOverviewV5.properties ?? {}).sort(), [
    'matrix',
    'momentum',
    'totals',
    'weekdaySeconds',
  ]);
  assert.deepEqual(Object.keys(v5.$defs.insightsMatrixV5.properties ?? {}).sort(), [
    'games',
    'members',
  ]);
});
test('read route pins the v5 query shapes (id column, selector reads, mapping load)', () => {
  const route = readFileSync(
    new URL('../app/api/ivrm/community-game-stats/read/route.ts', import.meta.url),
    'utf8',
  );
  // The unified reads group by the recorded (name, id)
  // pair; the game-detail name selector only claims
  // id-less rows, which is exactly the set a name mapping
  // may unify. (The v6 leaderboards source read groups the
  // same way, so the count is six since S9.)
  assert.equal((route.match(/GROUP BY user_id, activity_name, application_id/g) ?? []).length, 6);
  assert.equal((route.match(/GROUP BY activity_name, application_id/g) ?? []).length, 2);
  assert.ok(route.includes("application_id = '' AND activity_name ="));
  // The mappings come from the guild's Activity Rules
  // config through the shared normalization.
  assert.ok(route.includes("pluginId: 'activity-rules'"));
  assert.ok(route.includes('normalizeActivityRulesConfig'));
  assert.ok(route.includes("console.error('community_game_identity_mapping_read_failed', error)"));
});
test('version 6 negotiates like v5 and keeps the id / key game selectors', async () => {
  assert.deepEqual(
    await authorizeCommunityGameStatsRead(signed({ ...input, version: 6 }), environment),
    {
      ...input,
      mode: 'overview',
      discordUserId: null,
      gameName: null,
      gameApplicationId: null,
      gameKey: null,
      channelId: null,
      channelMetric: null,
      version: 6,
    },
  );
  assert.deepEqual(
    await authorizeCommunityGameStatsRead(
      signed({
        ...input,
        mode: 'game',
        gameApplicationId: '762434991303950386',
        version: 6,
      }),
      environment,
    ),
    {
      ...input,
      mode: 'game',
      discordUserId: null,
      gameName: null,
      gameApplicationId: '762434991303950386',
      gameKey: null,
      channelId: null,
      channelMetric: null,
      version: 6,
    },
  );
  assert.deepEqual(
    await authorizeCommunityGameStatsRead(
      signed({
        ...input,
        mode: 'user',
        discordUserId: '100000000000000002',
        version: 6,
      }),
      environment,
    ),
    {
      ...input,
      mode: 'user',
      discordUserId: '100000000000000002',
      gameName: null,
      gameApplicationId: null,
      gameKey: null,
      channelId: null,
      channelMetric: null,
      version: 6,
    },
  );
  for (const value of [
    { ...input, version: 8 },
    {
      ...input,
      mode: 'game',
      gameApplicationId: '762434991303950386',
      version: 2,
    },
    { ...input, mode: 'game', gameKey: 'app:762434991303950386', version: 4 },
  ]) {
    const response = await authorizeCommunityGameStatsRead(signed(value), environment);
    assert.ok(response instanceof Response);
    assert.equal(response.status, 422);
  }
});
test('leaderboard projections emit exactly the contract fields', () => {
  const playDays = projectCommunityLeaderboardPlayDaysRow({
    discordUserId: '100000000000000002',
    playDays: 42,
  });
  assert.deepEqual(playDays, {
    discordUserId: '100000000000000002',
    playDays: 42,
  });
  assert.deepEqual(Object.keys(playDays).sort(), ['discordUserId', 'playDays']);
  // The growth projection derives the increase from the two
  // totals; it does not filter — eligibility is the
  // builder's rule, so a decrease projects as a negative.
  const growth = projectCommunityLeaderboardGrowthRow({
    discordUserId: '100000000000000002',
    currentSeconds: 7200n,
    previousSeconds: 3600n,
  });
  assert.deepEqual(growth, {
    discordUserId: '100000000000000002',
    currentSeconds: 7200,
    previousSeconds: 3600,
    growthSeconds: 3600,
  });
  assert.deepEqual(Object.keys(growth).sort(), [
    'currentSeconds',
    'discordUserId',
    'growthSeconds',
    'previousSeconds',
  ]);
  assert.equal(
    projectCommunityLeaderboardGrowthRow({
      discordUserId: '100000000000000002',
      currentSeconds: 1800n,
      previousSeconds: 3600n,
    }).growthSeconds,
    -1800,
  );
  for (const bad of [
    () =>
      projectCommunityLeaderboardPlayDaysRow({
        discordUserId: 'nope',
        playDays: 1,
      }),
    () =>
      projectCommunityLeaderboardPlayDaysRow({
        discordUserId: '100000000000000002',
        playDays: 1.5,
      }),
    () =>
      projectCommunityLeaderboardPlayDaysRow({
        discordUserId: '100000000000000002',
        playDays: -1,
      }),
    () =>
      projectCommunityLeaderboardGrowthRow({
        discordUserId: '100000000000000002',
        currentSeconds: -1n,
        previousSeconds: 0n,
      }),
  ])
    assert.throws(bad);
});
test('previous range is the same-length window immediately before the range', () => {
  // A week against the week before it.
  assert.deepEqual(communityGamePreviousRange({ from: '2026-11-21', to: '2026-11-27' }), {
    from: '2026-11-14',
    to: '2026-11-20',
  });
  // A 30-day month window: the 30 days before it, not the
  // calendar month (the G7 comparison definition).
  assert.deepEqual(communityGamePreviousRange({ from: '2026-11-01', to: '2026-11-30' }), {
    from: '2026-10-02',
    to: '2026-10-31',
  });
  // A single day, across a year boundary, and across a leap day.
  assert.deepEqual(communityGamePreviousRange({ from: '2027-01-01', to: '2027-01-01' }), {
    from: '2026-12-31',
    to: '2026-12-31',
  });
  assert.deepEqual(communityGamePreviousRange({ from: '2028-02-28', to: '2028-03-01' }), {
    from: '2028-02-25',
    to: '2028-02-27',
  });
  assert.throws(() => communityGamePreviousRange({ from: '2026-11-27', to: '2026-11-21' }));
  assert.throws(() => communityGamePreviousRange({ from: '2026-02-30', to: '2026-03-01' }));
});
test('game count board counts distinct unified games per member', () => {
  const rows = [
    // U1 played Genshin under both its names and its id:
    // one unified game, not three.
    {
      discordUserId: '100000000000000011',
      name: 'Genshin Impact',
      applicationId: '762434991303950386',
      totalSeconds: 3600,
    },
    {
      discordUserId: '100000000000000011',
      name: '原神',
      applicationId: null,
      totalSeconds: 1800,
    },
    {
      discordUserId: '100000000000000011',
      name: '原神',
      applicationId: '762434991303950386',
      totalSeconds: 60,
    },
    {
      discordUserId: '100000000000000011',
      name: 'VALORANT',
      applicationId: null,
      totalSeconds: 7200,
    },
    // U2 played two games; the tie with U3 breaks by id.
    {
      discordUserId: '100000000000000012',
      name: 'VALORANT',
      applicationId: null,
      totalSeconds: 100,
    },
    {
      discordUserId: '100000000000000012',
      name: 'Minecraft',
      applicationId: null,
      totalSeconds: 100,
    },
    {
      discordUserId: '100000000000000013',
      name: 'VALORANT',
      applicationId: null,
      totalSeconds: 100,
    },
    {
      discordUserId: '100000000000000013',
      name: 'Minecraft',
      applicationId: null,
      totalSeconds: 100,
    },
  ];
  assert.deepEqual(buildCommunityLeaderboardGameCounts(rows, identityMappings), [
    { discordUserId: '100000000000000011', gameCount: 2 },
    { discordUserId: '100000000000000012', gameCount: 2 },
    { discordUserId: '100000000000000013', gameCount: 2 },
  ]);
  // Without mappings the localized name and the id group
  // stay apart — the documented pre-mapping behaviour.
  assert.deepEqual(buildCommunityLeaderboardGameCounts(rows, []), [
    { discordUserId: '100000000000000011', gameCount: 3 },
    { discordUserId: '100000000000000012', gameCount: 2 },
    { discordUserId: '100000000000000013', gameCount: 2 },
  ]);
  assert.deepEqual(buildCommunityLeaderboardGameCounts([], identityMappings), []);
});
test('growth board keeps only members with a previous hour and a positive increase', () => {
  const board = buildCommunityLeaderboardGrowth([
    // Eligible: grew by an hour over a solid previous week.
    {
      discordUserId: '100000000000000011',
      currentSeconds: 10800,
      previousSeconds: 7200,
      growthSeconds: 3600,
    },
    // Eligible and tied on growth: the larger current total wins.
    {
      discordUserId: '100000000000000012',
      currentSeconds: 14400,
      previousSeconds: 10800,
      growthSeconds: 3600,
    },
    // Exactly one previous hour is enough.
    {
      discordUserId: '100000000000000013',
      currentSeconds: 3601,
      previousSeconds: 3600,
      growthSeconds: 1,
    },
    // Just under the previous-hour floor: excluded even
    // though the increase is the largest on the board.
    {
      discordUserId: '100000000000000014',
      currentSeconds: 999999,
      previousSeconds: 3599,
      growthSeconds: 996400,
    },
    // No previous record at all (a first week) is excluded.
    {
      discordUserId: '100000000000000015',
      currentSeconds: 7200,
      previousSeconds: 0,
      growthSeconds: 7200,
    },
    // Flat and decreased members are not a leaderboard.
    {
      discordUserId: '100000000000000016',
      currentSeconds: 7200,
      previousSeconds: 7200,
      growthSeconds: 0,
    },
    {
      discordUserId: '100000000000000017',
      currentSeconds: 3600,
      previousSeconds: 7200,
      growthSeconds: -3600,
    },
  ]);
  assert.deepEqual(board, [
    {
      discordUserId: '100000000000000012',
      currentSeconds: 14400,
      previousSeconds: 10800,
      growthSeconds: 3600,
    },
    {
      discordUserId: '100000000000000011',
      currentSeconds: 10800,
      previousSeconds: 7200,
      growthSeconds: 3600,
    },
    {
      discordUserId: '100000000000000013',
      currentSeconds: 3601,
      previousSeconds: 3600,
      growthSeconds: 1,
    },
  ]);
  assert.deepEqual(buildCommunityLeaderboardGrowth([]), []);
});
test('v6 contract JSON extends v5 without changing the v1–v5 shapes', () => {
  const read = (name: string) =>
    JSON.parse(
      readFileSync(new URL(`../../../../contracts/ivrm/${name}`, import.meta.url), 'utf8'),
    ) as {
      $id: string;
      description: string;
      $defs: Record<string, { required?: string[]; properties?: Record<string, unknown> }>;
    };
  const v5 = read('herta-community-game-stats-read.v5.json');
  const v6 = read('herta-community-game-stats-read.v6.json');
  assert.equal(v6.$id, 'https://ivrm.jp/contracts/herta-community-game-stats-read/v6');
  assert.ok(v6.description.includes(COMMUNITY_GAME_STATS_PATH));
  assert.ok(v6.description.includes(COMMUNITY_GAME_STATS_PURPOSE));
  // Every v5 definition except the request is carried over
  // unchanged in structure.
  for (const name of Object.keys(v5.$defs).filter((key) => key !== 'request'))
    assert.deepEqual(v6.$defs[name], v5.$defs[name]);
  // The request only widens the version enum.
  assert.deepEqual(
    Object.keys(v6.$defs.request.properties ?? {}).sort(),
    Object.keys(v5.$defs.request.properties ?? {}).sort(),
  );
  assert.deepEqual(v6.$defs.request.required, v5.$defs.request.required);
  assert.deepEqual(
    (v6.$defs.request.properties?.version as { enum: number[] }).enum,
    [1, 2, 3, 4, 5, 6],
  );
  // The v6 overview is the v5 overview plus the required
  // leaderboards section; nothing else moves.
  assert.deepEqual(
    Object.keys(v6.$defs.overviewResponseV6.properties ?? {}).sort(),
    [...Object.keys(v5.$defs.overviewResponseV5.properties ?? {}), 'leaderboards'].sort(),
  );
  assert.deepEqual(Object.keys(v6.$defs.leaderboardsOverview.properties ?? {}).sort(), [
    'gameCount',
    'growth',
    'playDays',
  ]);
  const boards = v6.$defs.leaderboardsOverview.properties as unknown as Record<
    string,
    {
      properties: Record<string, { items?: { properties: Record<string, unknown> } } | undefined>;
    }
  >;
  assert.deepEqual(Object.keys(boards.gameCount.properties.items?.items?.properties ?? {}).sort(), [
    'discordUserId',
    'gameCount',
  ]);
  assert.deepEqual(Object.keys(boards.playDays.properties.items?.items?.properties ?? {}).sort(), [
    'discordUserId',
    'playDays',
  ]);
  assert.deepEqual(Object.keys(boards.growth.properties.items?.items?.properties ?? {}).sort(), [
    'currentSeconds',
    'discordUserId',
    'growthSeconds',
    'previousSeconds',
  ]);
  assert.deepEqual(Object.keys(boards.growth.properties ?? {}).sort(), [
    'items',
    'pagination',
    'previousRange',
  ]);
});
test('read route pins the v6 query shapes (distinct days, previous window, fail-soft)', () => {
  const route = readFileSync(
    new URL('../app/api/ivrm/community-game-stats/read/route.ts', import.meta.url),
    'utf8',
  );
  // playDays counts distinct activity dates per member.
  assert.ok(route.includes('COUNT(DISTINCT activity_date)::int AS "playDays"'));
  // Growth splits one grouped read at the range start and
  // bounds it by the derived previous window.
  assert.ok(
    route.includes(
      'SUM(CASE WHEN activity_date >= ${input.from}::date THEN value ELSE 0 END)::bigint AS "currentSeconds"',
    ),
  );
  assert.ok(route.includes('communityGamePreviousRange({ from: input.from, to: input.to })'));
  assert.ok(route.includes('activity_date >= ${previousRange.from}::date'));
  // The section degrades to null like the other sections,
  // and only a v6 overview carries it.
  assert.ok(route.includes("console.error('community_leaderboards_read_failed', error)"));
  assert.ok(route.includes('leaderboards: await readOverviewLeaderboards(input, mappings)'));
});
test('version 7 negotiates like v6 and unlocks the channel mode', async () => {
  assert.deepEqual(
    await authorizeCommunityGameStatsRead(signed({ ...input, version: 7 }), environment),
    {
      ...input,
      mode: 'overview',
      discordUserId: null,
      gameName: null,
      gameApplicationId: null,
      gameKey: null,
      channelId: null,
      channelMetric: null,
      version: 7,
    },
  );
  assert.deepEqual(
    await authorizeCommunityGameStatsRead(
      signed({
        ...input,
        mode: 'game',
        gameKey: 'app:762434991303950386',
        version: 7,
      }),
      environment,
    ),
    {
      ...input,
      mode: 'game',
      discordUserId: null,
      gameName: null,
      gameApplicationId: null,
      gameKey: 'app:762434991303950386',
      channelId: null,
      channelMetric: null,
      version: 7,
    },
  );
  assert.deepEqual(
    await authorizeCommunityGameStatsRead(
      signed({
        ...input,
        mode: 'channel',
        channelId: '100000000000000090',
        channelMetric: 'voice',
        version: 7,
      }),
      environment,
    ),
    {
      ...input,
      mode: 'channel',
      discordUserId: null,
      gameName: null,
      gameApplicationId: null,
      gameKey: null,
      channelId: '100000000000000090',
      channelMetric: 'voice',
      version: 7,
    },
  );
  assert.deepEqual(
    await authorizeCommunityGameStatsRead(
      signed({
        ...input,
        mode: 'channel',
        channelId: '100000000000000090',
        channelMetric: 'messages',
        discordUserId: '100000000000000002',
        version: 7,
      }),
      environment,
    ),
    {
      ...input,
      mode: 'channel',
      discordUserId: '100000000000000002',
      gameName: null,
      gameApplicationId: null,
      gameKey: null,
      channelId: '100000000000000090',
      channelMetric: 'messages',
      version: 7,
    },
  );
  for (const value of [
    { ...input, version: 8 },
    // The channel mode exists only in v7.
    {
      ...input,
      mode: 'channel',
      channelId: '100000000000000090',
      channelMetric: 'voice',
      version: 6,
    },
    // Both channel selectors are required, and the metric
    // is the closed wire enum.
    { ...input, mode: 'channel', channelId: '100000000000000090', version: 7 },
    { ...input, mode: 'channel', channelMetric: 'voice', version: 7 },
    {
      ...input,
      mode: 'channel',
      channelId: '100000000000000090',
      channelMetric: 'online',
      version: 7,
    },
    {
      ...input,
      mode: 'channel',
      channelId: '123',
      channelMetric: 'voice',
      version: 7,
    },
    // The game selectors and the channel selectors never mix.
    {
      ...input,
      mode: 'channel',
      channelId: '100000000000000090',
      channelMetric: 'voice',
      gameName: 'VALORANT',
      version: 7,
    },
    { ...input, channelId: '100000000000000090', version: 7 },
    {
      ...input,
      mode: 'game',
      gameName: 'VALORANT',
      channelMetric: 'voice',
      version: 7,
    },
    // The optional viewer still has to be a snowflake.
    {
      ...input,
      mode: 'channel',
      channelId: '100000000000000090',
      channelMetric: 'voice',
      discordUserId: 'nope',
      version: 7,
    },
  ]) {
    const response = await authorizeCommunityGameStatsRead(signed(value), environment);
    assert.ok(response instanceof Response);
    assert.equal(response.status, 422);
  }
});
test('channel ranking projections emit exactly the contract fields', () => {
  const voice = projectCommunityChannelVoiceMemberRow({
    discordUserId: '100000000000000002',
    totalSeconds: 7200n,
  });
  assert.deepEqual(voice, { discordUserId: '100000000000000002', totalSeconds: 7200 });
  assert.deepEqual(Object.keys(voice).sort(), ['discordUserId', 'totalSeconds']);
  const message = projectCommunityChannelMessageMemberRow({
    discordUserId: '100000000000000002',
    totalCount: 30n,
  });
  assert.deepEqual(message, { discordUserId: '100000000000000002', totalCount: 30 });
  assert.deepEqual(Object.keys(message).sort(), ['discordUserId', 'totalCount']);
  for (const bad of [
    () =>
      projectCommunityChannelVoiceMemberRow({
        discordUserId: 'nope',
        totalSeconds: 1n,
      }),
    () =>
      projectCommunityChannelVoiceMemberRow({
        discordUserId: '100000000000000002',
        totalSeconds: -1n,
      }),
    () =>
      projectCommunityChannelMessageMemberRow({
        discordUserId: '100000000000000002',
        totalCount: 1.5,
      }),
  ])
    assert.throws(bad);
});
test('weekly champions assembly partitions weeks and caps the candidates', () => {
  // Rows arrive unordered; the builder owns the week
  // order, the candidate order and the cap.
  const weeks = buildCommunityWeeklyChampions([
    { weekStart: '2026-11-30', discordUserId: '100000000000000025', totalSeconds: 400 },
    { weekStart: '2026-11-23', discordUserId: '100000000000000011', totalSeconds: 3600 },
    { weekStart: '2026-11-30', discordUserId: '100000000000000021', totalSeconds: 700 },
    { weekStart: '2026-11-30', discordUserId: '100000000000000027', totalSeconds: 200 },
    { weekStart: '2026-11-23', discordUserId: '100000000000000012', totalSeconds: 7200 },
    { weekStart: '2026-11-30', discordUserId: '100000000000000024', totalSeconds: 500 },
    { weekStart: '2026-11-30', discordUserId: '100000000000000022', totalSeconds: 600 },
    { weekStart: '2026-11-30', discordUserId: '100000000000000026', totalSeconds: 300 },
    { weekStart: '2026-11-30', discordUserId: '100000000000000023', totalSeconds: 500 },
    { weekStart: '2026-12-28', discordUserId: '100000000000000011', totalSeconds: 60 },
  ]);
  assert.deepEqual(weeks, [
    {
      weekStart: '2026-11-23',
      weekEnd: '2026-11-29',
      leaders: [
        { discordUserId: '100000000000000012', totalSeconds: 7200 },
        { discordUserId: '100000000000000011', totalSeconds: 3600 },
      ],
    },
    {
      weekStart: '2026-11-30',
      weekEnd: '2026-12-06',
      leaders: [
        { discordUserId: '100000000000000021', totalSeconds: 700 },
        { discordUserId: '100000000000000022', totalSeconds: 600 },
        // Tied candidates break by id, and the cap keeps
        // exactly the leaders limit.
        { discordUserId: '100000000000000023', totalSeconds: 500 },
        { discordUserId: '100000000000000024', totalSeconds: 500 },
        { discordUserId: '100000000000000025', totalSeconds: 400 },
      ],
    },
    {
      // The week end crosses the year boundary.
      weekStart: '2026-12-28',
      weekEnd: '2027-01-03',
      leaders: [{ discordUserId: '100000000000000011', totalSeconds: 60 }],
    },
  ]);
  assert.equal(COMMUNITY_WEEKLY_CHAMPION_LEADERS_LIMIT, 5);
  assert.deepEqual(buildCommunityWeeklyChampions([]), []);
  // The row projection accepts the DATE the SQL returns
  // (a Date at UTC midnight or a date string).
  assert.deepEqual(
    projectCommunityWeeklyChampionRow({
      weekStart: new Date('2026-11-23T00:00:00.000Z'),
      discordUserId: '100000000000000002',
      totalSeconds: 60n,
    }),
    { weekStart: '2026-11-23', discordUserId: '100000000000000002', totalSeconds: 60 },
  );
  for (const bad of [
    () =>
      projectCommunityWeeklyChampionRow({
        weekStart: null,
        discordUserId: '100000000000000002',
        totalSeconds: 60n,
      }),
    () =>
      projectCommunityWeeklyChampionRow({
        weekStart: '2026-11-23',
        discordUserId: 'nope',
        totalSeconds: 60n,
      }),
    () =>
      projectCommunityWeeklyChampionRow({
        weekStart: '2026-11-23',
        discordUserId: '100000000000000002',
        totalSeconds: -1n,
      }),
  ])
    assert.throws(bad);
});
test('v7 contract JSON extends v6 without changing the v1–v6 shapes', () => {
  const read = (name: string) =>
    JSON.parse(
      readFileSync(new URL(`../../../../contracts/ivrm/${name}`, import.meta.url), 'utf8'),
    ) as {
      $id: string;
      description: string;
      oneOf: Array<{ $ref: string }>;
      $defs: Record<string, { required?: string[]; properties?: Record<string, unknown> }>;
    };
  const v6 = read('herta-community-game-stats-read.v6.json');
  const v7 = read('herta-community-game-stats-read.v7.json');
  assert.equal(v7.$id, 'https://ivrm.jp/contracts/herta-community-game-stats-read/v7');
  assert.ok(v7.description.includes(COMMUNITY_GAME_STATS_PATH));
  assert.ok(v7.description.includes(COMMUNITY_GAME_STATS_PURPOSE));
  // Every v6 definition except the request is carried over
  // unchanged in structure.
  for (const name of Object.keys(v6.$defs).filter((key) => key !== 'request'))
    assert.deepEqual(v7.$defs[name], v6.$defs[name]);
  // The request only widens: the channel selectors join,
  // the mode enum gains channel, the version enum gains 7.
  assert.deepEqual(
    Object.keys(v7.$defs.request.properties ?? {}).sort(),
    [...Object.keys(v6.$defs.request.properties ?? {}), 'channelId', 'channelMetric'].sort(),
  );
  assert.deepEqual(v7.$defs.request.required, v6.$defs.request.required);
  assert.deepEqual(
    (v7.$defs.request.properties?.version as { enum: number[] }).enum,
    [1, 2, 3, 4, 5, 6, 7],
  );
  assert.deepEqual((v7.$defs.request.properties?.mode as { enum: string[] }).enum, [
    'overview',
    'user',
    'game',
    'channel',
  ]);
  // The v7 overview is the v6 overview plus the required
  // weeklyChampions section; nothing else moves.
  assert.deepEqual(
    Object.keys(v7.$defs.overviewResponseV7.properties ?? {}).sort(),
    [...Object.keys(v6.$defs.overviewResponseV6.properties ?? {}), 'weeklyChampions'].sort(),
  );
  assert.deepEqual(Object.keys(v7.$defs.weeklyChampionsOverview.properties ?? {}).sort(), [
    'weeks',
  ]);
  const week = v7.$defs.weeklyChampionWeek.properties as unknown as {
    leaders: { maxItems: number };
  };
  assert.equal(week.leaders.maxItems, COMMUNITY_WEEKLY_CHAMPION_LEADERS_LIMIT);
  assert.deepEqual(Object.keys(v7.$defs.weeklyChampionLeader.properties ?? {}).sort(), [
    'discordUserId',
    'totalSeconds',
  ]);
  // The channel response names the channel, its members
  // and the viewer; the detail splits by metric.
  assert.deepEqual(Object.keys(v7.$defs.channelResponse.properties ?? {}).sort(), [
    'channel',
    'guildId',
    'members',
    'meta',
    'mode',
    'range',
    'status',
    'viewer',
  ]);
  assert.deepEqual(Object.keys(v7.$defs.channelDetailVoice.properties ?? {}).sort(), [
    'channelId',
    'memberCount',
    'metric',
    'name',
    'recordedFrom',
    'totalSeconds',
  ]);
  assert.deepEqual(Object.keys(v7.$defs.channelDetailMessage.properties ?? {}).sort(), [
    'channelId',
    'memberCount',
    'metric',
    'name',
    'recordedFrom',
    'totalCount',
  ]);
  assert.deepEqual(
    v7.oneOf.map((entry) => entry.$ref),
    [
      ...v6.oneOf.map((entry) => entry.$ref),
      '#/$defs/overviewResponseV7',
      '#/$defs/channelResponse',
    ],
  );
});
test('read route pins the v7 query shapes (week truncation, channel reads, fail-soft)', () => {
  const route = readFileSync(
    new URL('../app/api/ivrm/community-game-stats/read/route.ts', import.meta.url),
    'utf8',
  );
  // Weekly champions bucket the JST dates by their
  // Monday-start week.
  assert.ok(route.includes('date_trunc(\'week\', activity_date)::date AS "weekStart"'));
  assert.ok(route.includes("GROUP BY date_trunc('week', activity_date), user_id"));
  // The section degrades to null like the other sections,
  // and only a v7 overview carries it.
  assert.ok(route.includes("console.error('community_weekly_champions_read_failed', error)"));
  assert.ok(route.includes('weeklyChampions: await readOverviewWeeklyChampions(input)'));
  // The channel mode reads the channel table through the
  // metric map and dispatches on the mode like the game
  // mode does.
  assert.ok(route.includes("voice: 'voice_seconds'"));
  assert.ok(route.includes("messages: 'messages'"));
  assert.ok(route.includes("if (input.mode === 'channel')"));
  assert.ok(route.includes('readChannelRanking(input)'));
});
