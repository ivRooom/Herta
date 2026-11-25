import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTicketDiscordMessage,
  classifyDiscordPostStatus,
  fetchDiscordBotUserId,
  findDeliveredMessageId,
  normalizeTicketScanIntervalSeconds,
  parseTicketOutboxPayload,
  payloadDeclaresInternal,
  startTicketDiscordPollerRuntime,
  textContainsOutboxMarker,
  ticketOutboxMarker,
  type TicketDiscordOutboxStore,
} from './ticket-discord-outbox.js';

const BOT_USER_ID = '100000000000000001';
const OTHER_USER_ID = '100000000000000009';

const THREAD_ID = '200000000000000002';
const MESSAGE_PAYLOAD = {
  ticketId: 'TK-ABCDEF012345',
  discordThreadId: THREAD_ID,
  messageId: 42,
  authorKind: 'staff',
  authorDiscordUserId: '100000000000000002',
  body: 'Webからの担当者返信',
  source: 'web',
};

test('message_added payload を検証して受理する', () => {
  const parsed = parseTicketOutboxPayload('message_added', MESSAGE_PAYLOAD);
  assert.equal(parsed?.kind, 'message_added');
  if (parsed?.kind !== 'message_added') return;
  assert.equal(parsed.payload.body, 'Webからの担当者返信');
  assert.equal(parsed.payload.discordThreadId, THREAD_ID);
  assert.equal(parsed.payload.authorKind, 'staff');
});

test('status_changed payload を検証して受理する', () => {
  const parsed = parseTicketOutboxPayload('status_changed', {
    ticketId: 'TK-ABCDEF012345',
    discordThreadId: THREAD_ID,
    from: 'in_progress',
    to: 'resolved',
    source: 'web',
  });
  assert.equal(parsed?.kind, 'status_changed');
  if (parsed?.kind !== 'status_changed') return;
  assert.equal(parsed.payload.to, 'resolved');
});

test('不正な payload は null (恒久 failed 行き)', () => {
  assert.equal(parseTicketOutboxPayload('message_added', null), null);
  assert.equal(parseTicketOutboxPayload('message_added', { ...MESSAGE_PAYLOAD, body: '' }), null);
  assert.equal(
    parseTicketOutboxPayload('message_added', { ...MESSAGE_PAYLOAD, body: 'x'.repeat(4001) }),
    null,
  );
  assert.equal(
    parseTicketOutboxPayload('message_added', { ...MESSAGE_PAYLOAD, discordThreadId: 'abc' }),
    null,
  );
  assert.equal(
    parseTicketOutboxPayload('message_added', { ...MESSAGE_PAYLOAD, authorKind: 'bot' }),
    null,
  );
  assert.equal(
    parseTicketOutboxPayload('message_added', { ...MESSAGE_PAYLOAD, ticketId: 'XX-1' }),
    null,
  );
  assert.equal(
    parseTicketOutboxPayload('status_changed', {
      ticketId: 'TK-ABCDEF012345',
      discordThreadId: THREAD_ID,
      from: 'in_progress',
      to: 'bogus',
    }),
    null,
  );
  assert.equal(parseTicketOutboxPayload('unknown_kind', MESSAGE_PAYLOAD), null);
});

test('internal 宣言の検出', () => {
  assert.equal(payloadDeclaresInternal({ internal: true }), true);
  assert.equal(payloadDeclaresInternal({ internal: false }), false);
  assert.equal(payloadDeclaresInternal(MESSAGE_PAYLOAD), false);
  assert.equal(payloadDeclaresInternal(null), false);
});

test('message_added の文面: 本文とマーカー、メンション無効', () => {
  const parsed = parseTicketOutboxPayload('message_added', MESSAGE_PAYLOAD);
  assert.ok(parsed);
  const body = buildTicketDiscordMessage('7', parsed);
  const embed = body.embeds[0]!;
  assert.equal(embed['description'], 'Webからの担当者返信');
  assert.match(String(embed['title']), /運営/);
  assert.deepEqual(embed['footer'], { text: 'ticket-outbox:7' });
  assert.deepEqual(body.allowed_mentions, { parse: [] });
});

test('status_changed の文面: 日本語ラベルで案内する', () => {
  const parsed = parseTicketOutboxPayload('status_changed', {
    ticketId: 'TK-ABCDEF012345',
    discordThreadId: THREAD_ID,
    from: 'received',
    to: 'in_progress',
  });
  assert.ok(parsed);
  const body = buildTicketDiscordMessage('9', parsed);
  assert.equal(body.embeds[0]?.['description'], '状態が「受理」から「確認中」に変更されました。');
});

test('Discord 応答の分類', () => {
  assert.equal(classifyDiscordPostStatus(200), 'success');
  assert.equal(classifyDiscordPostStatus(201), 'success');
  assert.equal(classifyDiscordPostStatus(400), 'permanent');
  assert.equal(classifyDiscordPostStatus(403), 'permanent');
  assert.equal(classifyDiscordPostStatus(404), 'permanent');
  assert.equal(classifyDiscordPostStatus(401), 'retryable');
  assert.equal(classifyDiscordPostStatus(429), 'retryable');
  assert.equal(classifyDiscordPostStatus(500), 'retryable');
  assert.equal(classifyDiscordPostStatus(503), 'retryable');
});

test('二重投稿検出: Bot 本人の footer マーカーと content マーカー', () => {
  const messages = [
    { id: '300000000000000001', author: { id: BOT_USER_ID }, content: '通常の投稿', embeds: [] },
    {
      id: '300000000000000002',
      author: { id: BOT_USER_ID },
      content: '',
      embeds: [{ footer: { text: ticketOutboxMarker('7') } }],
    },
    {
      id: '300000000000000003',
      author: { id: BOT_USER_ID },
      content: `再送 ${ticketOutboxMarker('8')}`,
      embeds: [],
    },
  ];
  assert.equal(findDeliveredMessageId(messages, '7', BOT_USER_ID), '300000000000000002');
  assert.equal(findDeliveredMessageId(messages, '8', BOT_USER_ID), '300000000000000003');
  assert.equal(findDeliveredMessageId(messages, '9', BOT_USER_ID), null);
  assert.equal(findDeliveredMessageId('not-an-array', '7', BOT_USER_ID), null);
  assert.equal(findDeliveredMessageId([], '7', BOT_USER_ID), null);
});

test('二重投稿検出: ID の前方一致では誤認しない (ticket-outbox:7 と 70)', () => {
  assert.equal(textContainsOutboxMarker('ticket-outbox:70', '7'), false);
  assert.equal(textContainsOutboxMarker('ticket-outbox:7', '7'), true);
  assert.equal(textContainsOutboxMarker('再送 ticket-outbox:7 です', '7'), true);
  const messages = [
    {
      id: '300000000000000010',
      author: { id: BOT_USER_ID },
      content: '',
      embeds: [{ footer: { text: ticketOutboxMarker('70') } }],
    },
    {
      id: '300000000000000011',
      author: { id: BOT_USER_ID },
      content: `転記 ${ticketOutboxMarker('70')}`,
      embeds: [],
    },
  ];
  assert.equal(findDeliveredMessageId(messages, '7', BOT_USER_ID), null);
  assert.equal(findDeliveredMessageId(messages, '70', BOT_USER_ID), '300000000000000010');
});

test('二重投稿検出: 他者の投稿や Bot ID 不明では配送済みにしない', () => {
  const messages = [
    {
      id: '300000000000000020',
      author: { id: OTHER_USER_ID },
      content: '',
      embeds: [{ footer: { text: ticketOutboxMarker('7') } }],
    },
    {
      id: '300000000000000021',
      content: `引用 ${ticketOutboxMarker('7')}`,
      embeds: [],
    },
  ];
  assert.equal(findDeliveredMessageId(messages, '7', BOT_USER_ID), null);
  assert.equal(findDeliveredMessageId(messages, '7', null), null);
  assert.equal(findDeliveredMessageId(messages, '7', undefined), null);
});

test('Bot 本人 ID を /users/@me から取得する', async () => {
  const fetchImpl = (async (url: string | URL | Request) => {
    assert.match(String(url), /\/users\/@me$/);
    return new Response(JSON.stringify({ id: BOT_USER_ID }), { status: 200 });
  }) as typeof fetch;
  assert.equal(await fetchDiscordBotUserId({ fetchImpl, token: 'token' }), BOT_USER_ID);
  const failingFetch = (async () =>
    new Response('nope', { status: 401 })) as unknown as typeof fetch;
  await assert.rejects(
    fetchDiscordBotUserId({ fetchImpl: failingFetch, token: 'token' }),
    /discord_bot_user_failed_401/,
  );
});

test('初回スキャンが失敗してもタイマーが設置され再試行される', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  try {
    let claimCalls = 0;
    const store: TicketDiscordOutboxStore = {
      async claim() {
        claimCalls += 1;
        if (claimCalls === 1) throw new Error('claim_failed_once');
        return [];
      },
      async ackSent() {},
      async ackFailed() {},
      async close() {},
    };
    const logger = {
      error() {},
      warn() {},
      info() {},
      debug() {},
    };
    const runtime = await startTicketDiscordPollerRuntime({
      logger: logger as never,
      store,
      discordBotToken: 'token',
      scanIntervalSeconds: 15,
    });
    assert.equal(claimCalls, 1);
    t.mock.timers.tick(15_000);
    assert.equal(claimCalls, 2);
    await runtime.close();
  } finally {
    t.mock.timers.reset();
  }
});

test('スキャン間隔の正規化 (既定60秒、15〜600秒)', () => {
  assert.equal(normalizeTicketScanIntervalSeconds(undefined), 60);
  assert.equal(normalizeTicketScanIntervalSeconds(30), 30);
  assert.equal(normalizeTicketScanIntervalSeconds(1), 15);
  assert.equal(normalizeTicketScanIntervalSeconds(9999), 600);
  assert.equal(normalizeTicketScanIntervalSeconds(Number.NaN), 60);
});
