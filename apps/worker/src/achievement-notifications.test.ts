import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import type { Logger } from '@herta/logger';
import {
  ACHIEVEMENT_CARD_FILENAME,
  ACHIEVEMENT_RANK_ORDER,
  buildAchievementNotificationMessage,
  isDiscordRoutedRank,
  normalizeAchievementScanIntervalSeconds,
  parseAchievementPayload,
  startAchievementNotificationRuntime,
  tierPresentation,
  verifyAchievementPayloadHash,
  type AchievementNotificationStore,
  type AchievementOutboxRow,
} from './achievement-notifications.js';

function createLogger() {
  const warn: unknown[][] = [];
  const error: unknown[][] = [];
  const logger = {
    info: () => undefined,
    warn: (...args: unknown[]) => warn.push(args),
    error: (...args: unknown[]) => error.push(args),
  } as unknown as Logger;
  return { logger, warn, error };
}

const PAYLOAD_JSON = JSON.stringify({
  code: 'total-xp-100',
  name: '最初の一歩',
  tier: 'bronze',
  xpReward: 100,
  unlockedAt: '2026-11-18T03:00:00.000Z',
});
const PAYLOAD_HASH = createHash('sha256').update(PAYLOAD_JSON, 'utf8').digest('hex');

function createRow(overrides: Partial<AchievementOutboxRow> = {}): AchievementOutboxRow {
  return {
    id: 'unlock-1',
    userId: 'user-1',
    achievementId: 'ach_total_xp_100',
    payloadJson: PAYLOAD_JSON,
    payloadHash: PAYLOAD_HASH,
    attempts: 0,
    ...overrides,
  };
}

function createStore(rows: AchievementOutboxRow[]) {
  const sent: string[] = [];
  const attemptFailed: string[] = [];
  const poisoned: string[] = [];
  let listCalls = 0;
  const store: AchievementNotificationStore = {
    async listPending() {
      listCalls += 1;
      return rows;
    },
    async resolveRecipient(userId: string) {
      return userId === 'user-1' ? { discordUserId: 'discord-1', username: 'ivuru' } : null;
    },
    async markSent(id: string) {
      sent.push(id);
    },
    async markAttemptFailed(id: string) {
      attemptFailed.push(id);
    },
    async markPoisoned(id: string) {
      poisoned.push(id);
    },
    async close() {},
  };
  return { store, sent, attemptFailed, poisoned, listCalls: () => listCalls };
}

function createFetch(handler: (url: string, init?: RequestInit) => Response) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

test('payload を解釈し、hash を検証する', () => {
  const payload = parseAchievementPayload(PAYLOAD_JSON);
  assert.equal(payload?.name, '最初の一歩');
  assert.equal(payload?.xpReward, 100);
  assert.equal(payload?.rank, undefined);
  assert.equal(parseAchievementPayload('{"code":1}'), null);
  assert.equal(parseAchievementPayload('not-json'), null);
  assert.equal(verifyAchievementPayloadHash(PAYLOAD_JSON, PAYLOAD_HASH), true);
  assert.equal(verifyAchievementPayloadHash(PAYLOAD_JSON, '0'.repeat(64)), false);
});

test('payload の rank は文字列のときだけ受理し、それ以外は無視する (#1005)', () => {
  const withRank = parseAchievementPayload(
    JSON.stringify({
      code: 'settings-completion-10',
      name: '設定マスター',
      tier: 'platinum',
      rank: 'legend',
      xpReward: 5000,
      unlockedAt: '2026-11-25T11:40:06.289Z',
    }),
  );
  assert.equal(withRank?.rank, 'legend');
  // rank が文字列でなくても payload 自体は有効 (tier 表示に落ちる)。
  const badRank = parseAchievementPayload(
    JSON.stringify({
      code: 'settings-completion-10',
      name: '設定マスター',
      tier: 'platinum',
      rank: 5,
      xpReward: 5000,
      unlockedAt: '2026-11-25T11:40:06.289Z',
    }),
  );
  assert.ok(badRank);
  assert.equal(badRank?.rank, undefined);
  assert.equal(badRank?.tier, 'platinum');
});

test('通知本文は公開可能な範囲のみで本人メンションを含む', () => {
  const body = buildAchievementNotificationMessage({
    displayName: 'いゔる',
    discordUserId: 'discord-1',
    payload: {
      code: 'total-xp-100',
      name: '最初の一歩',
      tier: 'bronze',
      xpReward: 100,
      unlockedAt: '2026-11-18T03:00:00.000Z',
    },
  });
  assert.equal(body.content, '<@discord-1>');
  assert.deepEqual(body.allowed_mentions, { users: ['discord-1'] });
  const embed = body.embeds[0] as {
    description: string;
    fields: Array<{ name: string; value: string }>;
  };
  assert.match(embed.description, /最初の一歩/);
  assert.deepEqual(
    embed.fields.map((field) => field.value),
    ['ブロンズ', '+100 XP', '2026-11-18'],
  );
});

test('scan interval は既定60秒で上下限に丸める', () => {
  assert.equal(normalizeAchievementScanIntervalSeconds(undefined), 60);
  assert.equal(normalizeAchievementScanIntervalSeconds(1), 15);
  assert.equal(normalizeAchievementScanIntervalSeconds(9999), 600);
  assert.equal(normalizeAchievementScanIntervalSeconds(120), 120);
});

test('チャンネル未設定の間は outbox を一切触らない', async () => {
  const { logger } = createLogger();
  const fake = createStore([createRow()]);
  const { fetchImpl, calls } = createFetch(() => new Response('{}', { status: 200 }));
  const runtime = await startAchievementNotificationRuntime({
    logger,
    store: fake.store,
    discordBotToken: 'token',
    guildId: 'guild-1',
    resolveChannelId: async () => null,
    fetchImpl,
    now: () => new Date('2026-11-18T04:00:00.000Z'),
  });
  await runtime.close();
  assert.equal(fake.listCalls(), 0);
  assert.equal(calls.length, 0);
  assert.deepEqual(fake.sent, []);
});

test('pending を送信して sent にし、表示名はギルドメンバーから取る', async () => {
  const { logger } = createLogger();
  const fake = createStore([createRow()]);
  const { fetchImpl, calls } = createFetch((url) => {
    if (url.includes('/members/')) {
      return new Response(JSON.stringify({ nick: 'いゔる', user: { username: 'ivuru' } }), {
        status: 200,
      });
    }
    return new Response('{}', { status: 200 });
  });
  const runtime = await startAchievementNotificationRuntime({
    logger,
    store: fake.store,
    discordBotToken: 'token',
    guildId: 'guild-1',
    resolveChannelId: async () => 'channel-1',
    fetchImpl,
    now: () => new Date('2026-11-18T04:00:00.000Z'),
  });
  await runtime.close();
  assert.deepEqual(fake.sent, ['unlock-1']);
  const post = calls.find((call) => call.url.includes('/channels/channel-1/messages'));
  assert.ok(post);
  const body = JSON.parse(String(post.init?.body)) as { embeds: Array<{ description: string }> };
  assert.match(body.embeds[0]?.description ?? '', /いゔる/);
});

test('hash 不一致は送信せず poisoned として failed にする', async () => {
  const { logger } = createLogger();
  const fake = createStore([createRow({ payloadHash: '0'.repeat(64) })]);
  const { fetchImpl, calls } = createFetch(() => new Response('{}', { status: 200 }));
  const runtime = await startAchievementNotificationRuntime({
    logger,
    store: fake.store,
    discordBotToken: 'token',
    guildId: 'guild-1',
    resolveChannelId: async () => 'channel-1',
    fetchImpl,
  });
  await runtime.close();
  assert.deepEqual(fake.poisoned, ['unlock-1']);
  assert.deepEqual(fake.sent, []);
  assert.equal(calls.length, 0);
});

test('未連携ユーザーは再試行扱いにし、Discord 送信失敗も attempts を進める', async () => {
  const { logger } = createLogger();
  const fake = createStore([
    createRow({ id: 'unlock-unlinked', userId: 'user-unknown' }),
    createRow({ id: 'unlock-flaky' }),
  ]);
  const { fetchImpl } = createFetch((url) => {
    if (url.includes('/members/')) {
      return new Response(JSON.stringify({ user: { username: 'ivuru' } }), { status: 200 });
    }
    return new Response('{}', { status: 500 });
  });
  const runtime = await startAchievementNotificationRuntime({
    logger,
    store: fake.store,
    discordBotToken: 'token',
    guildId: 'guild-1',
    resolveChannelId: async () => 'channel-1',
    fetchImpl,
  });
  await runtime.close();
  assert.deepEqual(fake.attemptFailed.sort(), ['unlock-flaky', 'unlock-unlinked']);
  assert.deepEqual(fake.sent, []);
});

test('通知本文の段階表示は rank を優先し、rank 無しでは tier と変わらない (#1005)', () => {
  const base = {
    code: 'settings-completion-10',
    name: '設定マスター',
    tier: 'platinum',
    xpReward: 5000,
    unlockedAt: '2026-11-25T11:40:06.289Z',
  };
  const legend = buildAchievementNotificationMessage({
    displayName: 'いゔる',
    discordUserId: 'discord-1',
    payload: { ...base, rank: 'legend' },
  });
  const legendEmbed = legend.embeds[0] as {
    title: string;
    color: number;
    fields: Array<{ name: string; value: string }>;
  };
  assert.equal(legendEmbed.title, '👑 アチーブメント解除！');
  assert.equal(legendEmbed.color, 0xfb7185);
  assert.deepEqual(
    legendEmbed.fields.map((field) => field.value),
    ['レジェンド', '+5000 XP', '2026-11-25'],
  );

  const beginner = buildAchievementNotificationMessage({
    displayName: 'いゔる',
    discordUserId: 'discord-1',
    payload: { ...base, tier: 'bronze', rank: 'beginner', xpReward: 50 },
  });
  const beginnerEmbed = beginner.embeds[0] as {
    title: string;
    color: number;
    fields: Array<{ name: string; value: string }>;
  };
  assert.equal(beginnerEmbed.title, '🌱 アチーブメント解除！');
  assert.equal(beginnerEmbed.color, 0x4ade80);
  assert.equal(beginnerEmbed.fields[0]?.value, 'ビギナー');

  // rank 無しの旧 payload は従来どおり platinum 表示のまま。
  const legacy = buildAchievementNotificationMessage({
    displayName: 'いゔる',
    discordUserId: 'discord-1',
    payload: base,
  });
  const legacyEmbed = legacy.embeds[0] as {
    fields: Array<{ name: string; value: string }>;
  };
  assert.equal(legacyEmbed.fields[0]?.value, 'プラチナ');
});

test('ティア表は master / diamond / legend を持ち、platinum は legacy のまま', () => {
  assert.deepEqual(tierPresentation('master'), { label: 'マスター', emoji: '💠', color: 0xa78bfa });
  assert.deepEqual(tierPresentation('diamond'), {
    label: 'ダイヤモンド',
    emoji: '💎',
    color: 0x7dd3fc,
  });
  assert.deepEqual(tierPresentation('legend'), {
    label: 'レジェンド',
    emoji: '👑',
    color: 0xfb7185,
  });
  assert.deepEqual(tierPresentation('platinum'), {
    label: 'プラチナ',
    emoji: '💎',
    color: 0x7dd3fc,
  });
  assert.deepEqual(tierPresentation('bronze'), { label: 'ブロンズ', emoji: '🥉', color: 0xcd7f32 });
  // beginner は rank 一本化での提案値 (API 側カードと同値)。
  assert.deepEqual(tierPresentation('beginner'), {
    label: 'ビギナー',
    emoji: '🌱',
    color: 0x4ade80,
  });
});

test('カード添付時はコンパニオン Embed に attachment 画像が付く', () => {
  const payload = {
    code: 'total-xp-100',
    name: '最初の一歩',
    tier: 'master',
    xpReward: 100,
    unlockedAt: '2026-11-18T03:00:00.000Z',
  };
  const withCard = buildAchievementNotificationMessage({
    displayName: 'いゔる',
    discordUserId: 'discord-1',
    payload,
    cardFileName: ACHIEVEMENT_CARD_FILENAME,
  });
  const embedWithCard = withCard.embeds[0] as { image?: { url: string }; color: number };
  assert.equal(embedWithCard.image?.url, 'attachment://achievement-card.png');
  assert.equal(embedWithCard.color, 0xa78bfa);

  const withoutCard = buildAchievementNotificationMessage({
    displayName: 'いゔる',
    discordUserId: 'discord-1',
    payload,
  });
  const embedWithoutCard = withoutCard.embeds[0] as { image?: { url: string } };
  assert.equal(embedWithoutCard.image, undefined);
});

const TEST_CARD_PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('fake-card-bytes'),
]);

test('カード取得に成功したら multipart で添付して送信し sent にする', async () => {
  const { logger } = createLogger();
  const fake = createStore([createRow()]);
  const { fetchImpl, calls } = createFetch((url) => {
    if (url.includes('/members/')) {
      return new Response(JSON.stringify({ nick: 'いゔる', user: { username: 'ivuru' } }), {
        status: 200,
      });
    }
    return new Response('{}', { status: 200 });
  });
  const cardRequests: unknown[] = [];
  const runtime = await startAchievementNotificationRuntime({
    logger,
    store: fake.store,
    discordBotToken: 'token',
    guildId: 'guild-1',
    resolveChannelId: async () => 'channel-1',
    fetchImpl,
    fetchCardPng: async (input) => {
      cardRequests.push(input);
      return TEST_CARD_PNG;
    },
    now: () => new Date('2026-11-18T04:00:00.000Z'),
  });
  await runtime.close();
  assert.deepEqual(fake.sent, ['unlock-1']);
  assert.equal(cardRequests.length, 1);
  const post = calls.find((call) => call.url.includes('/channels/channel-1/messages'));
  assert.ok(post);
  const form = post.init?.body;
  assert.ok(form instanceof FormData);
  const payloadJson = JSON.parse(String(form.get('payload_json'))) as {
    content: string;
    embeds: Array<{ image?: { url: string } }>;
    attachments: Array<{ id: number; filename: string }>;
  };
  assert.equal(payloadJson.content, '<@discord-1>');
  assert.equal(payloadJson.embeds[0]?.image?.url, 'attachment://achievement-card.png');
  assert.deepEqual(payloadJson.attachments, [{ id: 0, filename: 'achievement-card.png' }]);
  const file = form.get('files[0]');
  assert.ok(file instanceof Blob);
  assert.equal(file.size, TEST_CARD_PNG.length);
  assert.equal(file.type, 'image/png');
});

test('カード取得が null や例外でも従来の JSON 投稿にフォールバックして sent にする', async () => {
  const { logger } = createLogger();
  const fake = createStore([createRow({ id: 'unlock-null' }), createRow({ id: 'unlock-throw' })]);
  const { fetchImpl, calls } = createFetch((url) => {
    if (url.includes('/members/')) {
      return new Response(JSON.stringify({ user: { username: 'ivuru' } }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  });
  let cardCall = 0;
  const runtime = await startAchievementNotificationRuntime({
    logger,
    store: fake.store,
    discordBotToken: 'token',
    guildId: 'guild-1',
    resolveChannelId: async () => 'channel-1',
    fetchImpl,
    fetchCardPng: async () => {
      cardCall += 1;
      if (cardCall === 1) return null;
      throw new Error('card boom');
    },
  });
  await runtime.close();
  assert.deepEqual(fake.sent.sort(), ['unlock-null', 'unlock-throw']);
  const posts = calls.filter((call) => call.url.includes('/channels/channel-1/messages'));
  assert.equal(posts.length, 2);
  for (const post of posts) {
    assert.equal(typeof post.init?.body, 'string');
    const body = JSON.parse(String(post.init?.body)) as {
      embeds: Array<{ image?: unknown }>;
    };
    assert.equal(body.embeds[0]?.image, undefined);
  }
});

test('isDiscordRoutedRank: 既定 (master) では master 以上だけ Discord 行き', () => {
  assert.equal(isDiscordRoutedRank('bronze', 'master'), false);
  assert.equal(isDiscordRoutedRank('silver', 'master'), false);
  assert.equal(isDiscordRoutedRank('gold', 'master'), false);
  assert.equal(isDiscordRoutedRank('master', 'master'), true);
  assert.equal(isDiscordRoutedRank('diamond', 'master'), true);
  assert.equal(isDiscordRoutedRank('legend', 'master'), true);
});

test('isDiscordRoutedRank: 最低ランク設定に従う', () => {
  assert.equal(isDiscordRoutedRank('gold', 'gold'), true);
  assert.equal(isDiscordRoutedRank('silver', 'gold'), false);
  assert.equal(isDiscordRoutedRank('legend', 'legend'), true);
  assert.equal(isDiscordRoutedRank('diamond', 'legend'), false);
  assert.equal(isDiscordRoutedRank('bronze', 'bronze'), true);
});

test('isDiscordRoutedRank: beginner は最下段で、既存の順序は不変 (#1005)', () => {
  assert.equal(ACHIEVEMENT_RANK_ORDER['beginner'], -1);
  assert.equal(ACHIEVEMENT_RANK_ORDER['bronze'], 0);
  assert.equal(ACHIEVEMENT_RANK_ORDER['legend'], 5);
  assert.equal(isDiscordRoutedRank('beginner', 'master'), false);
  assert.equal(isDiscordRoutedRank('beginner', 'bronze'), false);
  assert.equal(isDiscordRoutedRank('beginner', 'beginner'), true);
  assert.equal(isDiscordRoutedRank('bronze', 'beginner'), true);
  // 未知ランクは最低ランクが beginner でも送らない (claim SQL の
  // ELSE -2 と一致)。
  assert.equal(isDiscordRoutedRank('unknown-value', 'beginner'), false);
});

test('isDiscordRoutedRank: 未知・未設定は安全側 (未知ランクは送らない、未設定は master 扱い)', () => {
  assert.equal(isDiscordRoutedRank('platinum', 'master'), false);
  assert.equal(isDiscordRoutedRank(null, 'master'), false);
  assert.equal(isDiscordRoutedRank(undefined, 'master'), false);
  assert.equal(isDiscordRoutedRank('gold', null), false);
  assert.equal(isDiscordRoutedRank('master', null), true);
  assert.equal(isDiscordRoutedRank('master', undefined), true);
  assert.equal(isDiscordRoutedRank('master', 'unknown-value'), true);
});

test('バッジ画像は生成カードより優先して Embed 画像になる (#1854)', () => {
  const payload = {
    code: 'total-xp-100',
    name: '最初の一歩',
    tier: 'master',
    xpReward: 100,
    unlockedAt: '2026-11-18T03:00:00.000Z',
  };
  const withBoth = buildAchievementNotificationMessage({
    displayName: 'いゔる',
    discordUserId: 'discord-1',
    payload,
    badgeImageUrl: 'https://example.com/badge.webp',
    cardFileName: ACHIEVEMENT_CARD_FILENAME,
  });
  const embedWithBoth = withBoth.embeds[0] as { image?: { url: string } };
  assert.equal(embedWithBoth.image?.url, 'https://example.com/badge.webp');

  const badgeOnly = buildAchievementNotificationMessage({
    displayName: 'いゔる',
    discordUserId: 'discord-1',
    payload,
    badgeImageUrl: 'https://example.com/badge.webp',
  });
  const embedBadgeOnly = badgeOnly.embeds[0] as { image?: { url: string } };
  assert.equal(embedBadgeOnly.image?.url, 'https://example.com/badge.webp');
});

test('バッジ画像が解決できたらカードを取得せず JSON 投稿でバッジ画像を送る (#1854)', async () => {
  const { logger } = createLogger();
  const fake = createStore([createRow()]);
  const badgeRequests: string[] = [];
  fake.store.resolveBadgeImageUrl = async (achievementId) => {
    badgeRequests.push(achievementId);
    return 'https://example.com/badge.webp';
  };
  const { fetchImpl, calls } = createFetch((url) => {
    if (url.includes('/members/')) {
      return new Response(JSON.stringify({ nick: 'いゔる', user: { username: 'ivuru' } }), {
        status: 200,
      });
    }
    return new Response('{}', { status: 200 });
  });
  let cardCalls = 0;
  const runtime = await startAchievementNotificationRuntime({
    logger,
    store: fake.store,
    discordBotToken: 'token',
    guildId: 'guild-1',
    resolveChannelId: async () => 'channel-1',
    fetchImpl,
    fetchCardPng: async () => {
      cardCalls += 1;
      return TEST_CARD_PNG;
    },
    now: () => new Date('2026-11-18T04:00:00.000Z'),
  });
  await runtime.close();
  assert.deepEqual(fake.sent, ['unlock-1']);
  assert.deepEqual(badgeRequests, ['ach_total_xp_100']);
  assert.equal(cardCalls, 0);
  const post = calls.find((call) => call.url.includes('/channels/channel-1/messages'));
  assert.ok(post);
  assert.equal(typeof post.init?.body, 'string');
  const body = JSON.parse(String(post.init?.body)) as {
    embeds: Array<{ image?: { url: string } }>;
  };
  assert.equal(body.embeds[0]?.image?.url, 'https://example.com/badge.webp');
});

test('バッジ画像の解決が失敗したら生成カードにフォールバックする (#1854)', async () => {
  const { logger } = createLogger();
  const fake = createStore([createRow()]);
  fake.store.resolveBadgeImageUrl = async () => {
    throw new Error('badge boom');
  };
  const { fetchImpl, calls } = createFetch((url) => {
    if (url.includes('/members/')) {
      return new Response(JSON.stringify({ user: { username: 'ivuru' } }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  });
  let cardCalls = 0;
  const runtime = await startAchievementNotificationRuntime({
    logger,
    store: fake.store,
    discordBotToken: 'token',
    guildId: 'guild-1',
    resolveChannelId: async () => 'channel-1',
    fetchImpl,
    fetchCardPng: async () => {
      cardCalls += 1;
      return TEST_CARD_PNG;
    },
  });
  await runtime.close();
  assert.deepEqual(fake.sent, ['unlock-1']);
  assert.equal(cardCalls, 1);
  const post = calls.find((call) => call.url.includes('/channels/channel-1/messages'));
  assert.ok(post);
  assert.ok(post.init?.body instanceof FormData);
});

test('バッジ画像が https でない場合は使わず生成カードにフォールバックする (#1854)', async () => {
  const { logger } = createLogger();
  const fake = createStore([createRow()]);
  fake.store.resolveBadgeImageUrl = async () => 'http://example.com/badge.webp';
  const { fetchImpl, calls } = createFetch((url) => {
    if (url.includes('/members/')) {
      return new Response(JSON.stringify({ user: { username: 'ivuru' } }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  });
  let cardCalls = 0;
  const runtime = await startAchievementNotificationRuntime({
    logger,
    store: fake.store,
    discordBotToken: 'token',
    guildId: 'guild-1',
    resolveChannelId: async () => 'channel-1',
    fetchImpl,
    fetchCardPng: async () => {
      cardCalls += 1;
      return TEST_CARD_PNG;
    },
  });
  await runtime.close();
  assert.deepEqual(fake.sent, ['unlock-1']);
  assert.equal(cardCalls, 1);
  const post = calls.find((call) => call.url.includes('/channels/channel-1/messages'));
  assert.ok(post);
  const form = post.init?.body;
  assert.ok(form instanceof FormData);
  const payloadJson = JSON.parse(String(form.get('payload_json'))) as {
    embeds: Array<{ image?: { url: string } }>;
  };
  assert.equal(payloadJson.embeds[0]?.image?.url, 'attachment://achievement-card.png');
});
