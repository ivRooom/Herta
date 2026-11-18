import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import type { Logger } from '@herta/logger';
import {
  buildAchievementNotificationMessage,
  normalizeAchievementScanIntervalSeconds,
  parseAchievementPayload,
  startAchievementNotificationRuntime,
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
  assert.equal(parseAchievementPayload('{"code":1}'), null);
  assert.equal(parseAchievementPayload('not-json'), null);
  assert.equal(verifyAchievementPayloadHash(PAYLOAD_JSON, PAYLOAD_HASH), true);
  assert.equal(verifyAchievementPayloadHash(PAYLOAD_JSON, '0'.repeat(64)), false);
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
