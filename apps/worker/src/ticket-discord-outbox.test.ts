import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTicketAcceptanceMessage,
  buildTicketDiscordMessage,
  buildTicketThreadCreatedNotification,
  buildTicketThreadIntroMessage,
  classifyDiscordPostStatus,
  deriveTicketAttachmentEventId,
  deriveTicketThreadEventId,
  fetchDiscordBotUserId,
  findAcceptanceMessageId,
  findDeliveredMessageId,
  findTicketThreadByName,
  normalizeTicketScanIntervalSeconds,
  normalizeTicketThreadCreateConfig,
  parseTicketOutboxPayload,
  payloadDeclaresInternal,
  startTicketDiscordPollerRuntime,
  textContainsOutboxMarker,
  ticketAttachmentPlaceholder,
  ticketOutboxMarker,
  ticketThreadName,
  TICKET_ACCEPTANCE_MESSAGE,
  type TicketDiscordOutboxStore,
  type TicketOutboxRow,
  type TicketThreadCreateDeps,
  type TicketThreadLinkInput,
  type TicketThreadLinkRef,
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

test('message_added の文面: 長い本文でも添付プレースホルダは切り詰めで脱落しない', () => {
  const parsed = parseTicketOutboxPayload('message_added', {
    ...MESSAGE_PAYLOAD,
    body: 'あ'.repeat(4000),
  });
  assert.ok(parsed);
  const longName = 'x'.repeat(200);
  const placeholders = [
    ticketAttachmentPlaceholder({
      id: '1',
      fileName: `${longName}-a.png`,
      contentType: 'image/png',
      sizeBytes: 10,
      scanStatus: 'infected',
    }),
    ticketAttachmentPlaceholder({
      id: '2',
      fileName: `${longName}-b.png`,
      contentType: 'image/png',
      sizeBytes: 10,
      scanStatus: 'infected',
    }),
  ];
  const body = buildTicketDiscordMessage('11', parsed, placeholders);
  const description = String(body.embeds[0]?.['description']);
  assert.ok(description.length <= 4096);
  for (const line of placeholders) {
    assert.ok(description.includes(line), `プレースホルダが脱落している: ${line.slice(0, 40)}`);
  }
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

const ATTACHMENT_ID = '123e4567-e89b-42d3-a456-426614174000';
const ATTACHMENT_PAYLOAD = {
  ...MESSAGE_PAYLOAD,
  attachments: [
    {
      id: ATTACHMENT_ID,
      fileName: 'shot.png',
      contentType: 'image/png',
      sizeBytes: 12,
      scanStatus: 'clean',
    },
    {
      id: '123e4567-e89b-42d3-a456-426614174001',
      fileName: 'evil.png',
      contentType: 'image/png',
      sizeBytes: 10,
      scanStatus: 'infected',
    },
    {
      id: 'not-a-uuid',
      fileName: 'x.png',
      contentType: 'image/png',
      sizeBytes: 1,
      scanStatus: 'clean',
    },
  ],
};

test('message_added payload の添付メタを検証して取り込む (不正な要素は落とす)', () => {
  const parsed = parseTicketOutboxPayload('message_added', ATTACHMENT_PAYLOAD);
  assert.equal(parsed?.kind, 'message_added');
  if (parsed?.kind !== 'message_added') return;
  assert.equal(parsed.payload.attachments?.length, 2);
  assert.equal(parsed.payload.attachments?.[0]?.scanStatus, 'clean');
  assert.equal(parsed.payload.attachments?.[1]?.scanStatus, 'infected');
});

test('clean 以外の添付プレースホルダ文', () => {
  const base = {
    id: ATTACHMENT_ID,
    fileName: 'a.png',
    contentType: 'image/png',
    sizeBytes: 1,
  } as const;
  assert.match(ticketAttachmentPlaceholder({ ...base, scanStatus: 'pending' }), /スキャン中/);
  assert.match(ticketAttachmentPlaceholder({ ...base, scanStatus: 'error' }), /スキャン中/);
  assert.match(ticketAttachmentPlaceholder({ ...base, scanStatus: 'infected' }), /削除されました/);
});

test('添付 download の eventId は outbox と添付ごとに決定的', () => {
  assert.equal(
    deriveTicketAttachmentEventId('ticket-attachment-download:7:x'),
    deriveTicketAttachmentEventId('ticket-attachment-download:7:x'),
  );
  assert.notEqual(
    deriveTicketAttachmentEventId('ticket-attachment-download:7:x'),
    deriveTicketAttachmentEventId('ticket-attachment-download:8:x'),
  );
});

test('clean 添付は files 付きで投稿し、infected はプレースホルダになる (footer マーカー維持)', async () => {
  const row: TicketOutboxRow = {
    id: '7',
    ticketId: 'TK-ABCDEF012345',
    kind: 'message_added',
    payload: ATTACHMENT_PAYLOAD,
    payloadHash: 'hash',
    attempts: 0,
  };
  let postedForm: FormData | null = null;
  let ackedMessageId: string | null = null;
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const target = String(url);
    if (target.endsWith('/users/@me')) {
      return new Response(JSON.stringify({ id: BOT_USER_ID }), { status: 200 });
    }
    if (target.includes('api.example.test')) {
      assert.match(target, new RegExp(`/v1/herta/tickets/attachments/${ATTACHMENT_ID}$`));
      const headers = new Headers(init?.headers);
      assert.ok(headers.get('X-IVRM-Signature'));
      assert.ok(headers.get('X-IVRM-Event-Id'));
      return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { status: 200 });
    }
    if (target.includes(`/channels/${THREAD_ID}/messages`) && (init?.method ?? 'GET') === 'GET') {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (target.includes(`/channels/${THREAD_ID}/messages`)) {
      postedForm = init?.body as FormData;
      return new Response(JSON.stringify({ id: '300000000000000099' }), { status: 200 });
    }
    throw new Error(`unexpected fetch: ${target}`);
  }) as typeof fetch;
  const store: TicketDiscordOutboxStore = {
    async claim() {
      return [row];
    },
    async ackSent(_id, discordMessageId) {
      ackedMessageId = discordMessageId;
    },
    async ackFailed() {
      throw new Error('ackFailed must not be called');
    },
    async close() {},
  };
  const logger = { error() {}, warn() {}, info() {}, debug() {} };
  const runtime = await startTicketDiscordPollerRuntime({
    logger: logger as never,
    store,
    discordBotToken: 'token',
    fetchImpl,
    attachmentBridge: { apiBaseUrl: 'https://api.example.test', secret: 'bridge-secret' },
  });
  await runtime.close();
  assert.equal(ackedMessageId, '300000000000000099');
  assert.ok(postedForm);
  const form = postedForm as FormData;
  const payloadJson = JSON.parse(String(form.get('payload_json'))) as {
    embeds: Array<{ description: string; footer: { text: string } }>;
  };
  assert.equal(payloadJson.embeds[0]?.footer.text, 'ticket-outbox:7');
  assert.match(payloadJson.embeds[0]?.description ?? '', /削除されました/);
  const file = form.get('files[0]');
  assert.ok(file instanceof Blob);
  assert.equal((file as Blob).size, 4);
});

test('ブリッジ未設定なら clean 添付もプレースホルダで送る (実体は送らない)', async () => {
  const row: TicketOutboxRow = {
    id: '8',
    ticketId: 'TK-ABCDEF012345',
    kind: 'message_added',
    payload: {
      ...MESSAGE_PAYLOAD,
      attachments: [ATTACHMENT_PAYLOAD.attachments[0]],
    },
    payloadHash: 'hash',
    attempts: 0,
  };
  let postedJson: { embeds: Array<{ description: string }> } | null = null;
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const target = String(url);
    if (target.endsWith('/users/@me')) {
      return new Response(JSON.stringify({ id: BOT_USER_ID }), { status: 200 });
    }
    if (target.includes(`/channels/${THREAD_ID}/messages`) && (init?.method ?? 'GET') === 'GET') {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (target.includes(`/channels/${THREAD_ID}/messages`)) {
      postedJson = JSON.parse(String(init?.body)) as {
        embeds: Array<{ description: string }>;
      };
      return new Response(JSON.stringify({ id: '300000000000000098' }), { status: 200 });
    }
    throw new Error(`unexpected fetch: ${target}`);
  }) as typeof fetch;
  const store: TicketDiscordOutboxStore = {
    async claim() {
      return [row];
    },
    async ackSent() {},
    async ackFailed() {
      throw new Error('ackFailed must not be called');
    },
    async close() {},
  };
  const logger = { error() {}, warn() {}, info() {}, debug() {} };
  const runtime = await startTicketDiscordPollerRuntime({
    logger: logger as never,
    store,
    discordBotToken: 'token',
    fetchImpl,
  });
  await runtime.close();
  const posted = postedJson as { embeds: Array<{ description: string }> } | null;
  assert.ok(posted);
  assert.match(posted.embeds[0]?.description ?? '', /取得設定がないため/);
});

// ---- thread_create (WC-S4) ----

const GUILD_ID = '900000000000000001';
const OTHER_GUILD_ID = '900000000000000002';
const PANEL_CHANNEL_ID = '200000000000000010';
const OTHER_PANEL_CHANNEL_ID = '200000000000000013';
const NOTIFY_CHANNEL_ID = '200000000000000011';
const STAFF_ROLE_ID = '200000000000000012';
const REQUESTER_ID = '100000000000000002';
const CREATED_THREAD_ID = '200000000000000099';
const INTRO_MESSAGE_ID = '300000000000000099';

const THREAD_CREATE_PAYLOAD = {
  ticketId: 'TK-ABCDEF012345',
  requesterDiscordUserId: REQUESTER_ID,
  category: 'game_server',
  subject: 'サーバーに入れません',
  body: '昨夜から接続できません。',
  url: 'https://example.test/tickets#t=token',
  source: 'web',
};

const TICKETS_CONFIG = {
  enabled: true,
  panelChannelId: PANEL_CHANNEL_ID,
  staffRoleIds: [STAFF_ROLE_ID],
  notifyChannelId: NOTIFY_CHANNEL_ID,
  notifyStaffOnCreate: true,
};

test('thread_create payload を検証して受理する (discordThreadId は不要)', () => {
  const parsed = parseTicketOutboxPayload('thread_create', THREAD_CREATE_PAYLOAD);
  assert.equal(parsed?.kind, 'thread_create');
  if (parsed?.kind !== 'thread_create') return;
  assert.equal(parsed.payload.requesterDiscordUserId, REQUESTER_ID);
  assert.equal(parsed.payload.category, 'game_server');
  assert.equal(parsed.payload.subject, 'サーバーに入れません');
  assert.equal(parsed.payload.url, 'https://example.test/tickets#t=token');

  const withoutUrl = { ...THREAD_CREATE_PAYLOAD };
  delete (withoutUrl as Record<string, unknown>)['url'];
  const parsedWithoutUrl = parseTicketOutboxPayload('thread_create', withoutUrl);
  assert.equal(parsedWithoutUrl?.kind, 'thread_create');
  if (parsedWithoutUrl?.kind !== 'thread_create') return;
  assert.equal(parsedWithoutUrl.payload.url, undefined);
});

test('thread_create payload の不正値は null', () => {
  assert.equal(
    parseTicketOutboxPayload('thread_create', { ...THREAD_CREATE_PAYLOAD, category: 'bogus' }),
    null,
  );
  assert.equal(
    parseTicketOutboxPayload('thread_create', {
      ...THREAD_CREATE_PAYLOAD,
      requesterDiscordUserId: 'abc',
    }),
    null,
  );
  assert.equal(
    parseTicketOutboxPayload('thread_create', { ...THREAD_CREATE_PAYLOAD, subject: '' }),
    null,
  );
  assert.equal(
    parseTicketOutboxPayload('thread_create', {
      ...THREAD_CREATE_PAYLOAD,
      subject: 'x'.repeat(161),
    }),
    null,
  );
  assert.equal(
    parseTicketOutboxPayload('thread_create', { ...THREAD_CREATE_PAYLOAD, body: '' }),
    null,
  );
  assert.equal(
    parseTicketOutboxPayload('thread_create', {
      ...THREAD_CREATE_PAYLOAD,
      url: 'http://example.test/x',
    }),
    null,
  );
  // 既存 kind は引き続き discordThreadId が必須。
  const { discordThreadId: _dropped, ...messageWithoutThread } = MESSAGE_PAYLOAD;
  assert.equal(parseTicketOutboxPayload('message_added', messageWithoutThread), null);
});

test('thread_create 用 config 正規化 (bot の normalizeTicketsConfig と同じ規則)', () => {
  const empty = normalizeTicketThreadCreateConfig({});
  assert.equal(empty.enabled, true);
  assert.equal(empty.panelChannelId, null);
  assert.equal(empty.notifyChannelId, null);
  assert.equal(empty.notifyStaffOnCreate, true);
  assert.deepEqual(empty.staffRoleIds, []);

  const config = normalizeTicketThreadCreateConfig({
    enabled: false,
    panelChannelId: PANEL_CHANNEL_ID,
    staffRoleIds: [STAFF_ROLE_ID, STAFF_ROLE_ID, 'bogus'],
    notifyChannelId: NOTIFY_CHANNEL_ID,
    notifyStaffOnCreate: false,
  });
  assert.equal(config.enabled, false);
  assert.equal(config.panelChannelId, PANEL_CHANNEL_ID);
  assert.deepEqual(config.staffRoleIds, [STAFF_ROLE_ID]);
  assert.equal(config.notifyChannelId, NOTIFY_CHANNEL_ID);
  assert.equal(config.notifyStaffOnCreate, false);
});

test('同名スレッド検索: 同じパネル配下の決定的命名だけに一致する', () => {
  const threads = [
    {
      id: '200000000000000050',
      parent_id: OTHER_PANEL_CHANNEL_ID,
      name: '🎫 TK-ABCDEF012345 別件',
    },
    {
      id: CREATED_THREAD_ID,
      parent_id: PANEL_CHANNEL_ID,
      name: '🎫 TK-ABCDEF012345 サーバーに入れません',
    },
    {
      id: '200000000000000051',
      parent_id: PANEL_CHANNEL_ID,
      name: '🎫 TK-999999999999 他のチケット',
    },
  ];
  assert.equal(
    findTicketThreadByName(threads, PANEL_CHANNEL_ID, 'TK-ABCDEF012345'),
    CREATED_THREAD_ID,
  );
  assert.equal(findTicketThreadByName(threads, PANEL_CHANNEL_ID, 'TK-000000000000'), null);
  assert.equal(findTicketThreadByName('not-an-array', PANEL_CHANNEL_ID, 'TK-ABCDEF012345'), null);
  const parsedForName = parseTicketOutboxPayload('thread_create', THREAD_CREATE_PAYLOAD);
  assert.ok(parsedForName);
  if (parsedForName?.kind !== 'thread_create') return;
  assert.equal(ticketThreadName(parsedForName.payload), '🎫 TK-ABCDEF012345 サーバーに入れません');
});

test('intro 投稿の形式: bot と同じ Embed・ボタン・運用通知', () => {
  const parsed = parseTicketOutboxPayload('thread_create', THREAD_CREATE_PAYLOAD);
  assert.ok(parsed);
  if (parsed?.kind !== 'thread_create') return;
  const intro = buildTicketThreadIntroMessage('7', parsed.payload);
  const first = intro.embeds[0]!;
  assert.equal(first['title'], '🎫 TK-ABCDEF012345 サーバーに入れません');
  assert.equal(first['color'], 0x57f287);
  const fields = first['fields'] as Array<{ name: string; value: string }>;
  assert.equal(fields[0]?.value, 'ゲーム・サーバー');
  assert.equal(fields[1]?.value, '受理');
  assert.equal(fields[2]?.value, `<@${REQUESTER_ID}>`);
  assert.match(fields[3]?.value ?? '', /閲覧・返信はこちら/);
  const bodyEmbed = intro.embeds[1]!;
  assert.equal(bodyEmbed['description'], '昨夜から接続できません。');
  assert.deepEqual(bodyEmbed['footer'], { text: 'ticket-outbox:7' });
  const buttons = (intro.components?.[0]?.['components'] ?? []) as Array<{ custom_id: string }>;
  assert.deepEqual(
    buttons.map((button) => button.custom_id),
    [
      'herta:tickets:v1:action:claim',
      'herta:tickets:v1:action:close',
      'herta:tickets:v1:action:reopen',
    ],
  );
  assert.deepEqual(intro.allowed_mentions, { parse: [], users: [REQUESTER_ID] });

  const notification = buildTicketThreadCreatedNotification(parsed.payload, CREATED_THREAD_ID, {
    notifyStaffOnCreate: true,
    staffRoleIds: [STAFF_ROLE_ID],
  });
  assert.equal(notification.content, `<@&${STAFF_ROLE_ID}>`);
  assert.deepEqual(notification.allowed_mentions, { parse: [], roles: [STAFF_ROLE_ID] });
  assert.equal(notification.embeds[0]?.['title'], '🎫 新しいチケット TK-ABCDEF012345');

  const silent = buildTicketThreadCreatedNotification(parsed.payload, CREATED_THREAD_ID, {
    notifyStaffOnCreate: false,
    staffRoleIds: [STAFF_ROLE_ID],
  });
  assert.equal(silent.content, undefined);
  assert.deepEqual(silent.allowed_mentions, { parse: [] });
});

test('受理メッセージの文面: bot と同一の固定文面で、メンション無効の平文', () => {
  // bot の tickets-core の TICKET_ACCEPTANCE_MESSAGE と同一文面であることを、
  // 両側のテストで同じリテラルに固定する。
  assert.equal(
    TICKET_ACCEPTANCE_MESSAGE,
    'お問い合わせを受け付けました。担当者が確認のうえ、こちらのスレッドで回答します。内容によっては、回答まで1週間ほどかかる場合があります。恐れ入りますが、しばらくお待ちください。',
  );
  const body = buildTicketAcceptanceMessage();
  assert.equal(body.content, TICKET_ACCEPTANCE_MESSAGE);
  assert.deepEqual(body.embeds, []);
  assert.deepEqual(body.allowed_mentions, { parse: [] });
});

test('受理メッセージの既送検出: Bot 本人の完全一致投稿だけを検出する', () => {
  const messages = [
    {
      id: '300000000000000071',
      author: { id: OTHER_USER_ID },
      content: TICKET_ACCEPTANCE_MESSAGE,
    },
    { id: '300000000000000072', author: { id: BOT_USER_ID }, content: '別の文面' },
    {
      id: '300000000000000073',
      author: { id: BOT_USER_ID },
      content: TICKET_ACCEPTANCE_MESSAGE,
    },
  ];
  assert.equal(findAcceptanceMessageId(messages, BOT_USER_ID), '300000000000000073');
  assert.equal(findAcceptanceMessageId(messages.slice(0, 2), BOT_USER_ID), null);
  assert.equal(findAcceptanceMessageId(messages, null), null);
  assert.equal(findAcceptanceMessageId('not-an-array', BOT_USER_ID), null);
});

interface RecordedCall {
  url: string;
  method: string;
  body: unknown;
  headers: Headers;
}

function createThreadCreateFetch(
  options: {
    memberStatusByGuild?: Record<string, number>;
    activeThreads?: unknown[];
    threadHistory?: unknown[];
    linkStatus?: number;
    introMessageId?: string;
  } = {},
): { fetchImpl: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const target = String(url);
    const method = init?.method ?? 'GET';
    let body: unknown = null;
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    calls.push({ url: target, method, body, headers: new Headers(init?.headers) });
    if (target.endsWith('/users/@me')) {
      return new Response(JSON.stringify({ id: BOT_USER_ID }), { status: 200 });
    }
    const memberMatch = /\/guilds\/(\d+)\/members\//.exec(target);
    if (memberMatch) {
      const status = options.memberStatusByGuild?.[memberMatch[1]!] ?? 200;
      return new Response(status === 200 ? '{}' : 'no', { status });
    }
    if (target.includes('/threads/active')) {
      return new Response(JSON.stringify({ threads: options.activeThreads ?? [] }), {
        status: 200,
      });
    }
    if (/\/channels\/\d+\/threads$/.test(target) && method === 'POST') {
      return new Response(JSON.stringify({ id: CREATED_THREAD_ID }), { status: 200 });
    }
    if (target.includes('/thread-members/') && method === 'PUT') {
      return new Response(null, { status: 204 });
    }
    if (target.includes('/v1/herta/tickets/thread')) {
      return new Response('{}', { status: options.linkStatus ?? 200 });
    }
    if (target.includes('/messages?limit=') && method === 'GET') {
      return new Response(JSON.stringify(options.threadHistory ?? []), { status: 200 });
    }
    if (/\/channels\/\d+\/messages$/.test(target) && method === 'POST') {
      return new Response(JSON.stringify({ id: options.introMessageId ?? INTRO_MESSAGE_ID }), {
        status: 200,
      });
    }
    throw new Error(`unexpected fetch: ${method} ${target}`);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function createRecordingStore(row: TicketOutboxRow) {
  const ackedSent: Array<{ id: string; messageId: string }> = [];
  const ackedFailed: Array<{ id: string; error: string; permanent: boolean }> = [];
  let claimCalls = 0;
  const store: TicketDiscordOutboxStore = {
    async claim() {
      claimCalls += 1;
      return claimCalls === 1 ? [row] : [];
    },
    async ackSent(id, messageId) {
      ackedSent.push({ id, messageId });
    },
    async ackFailed(id, error, permanent) {
      ackedFailed.push({ id, error, permanent });
    },
    async close() {},
  };
  return { store, ackedSent, ackedFailed };
}

function createFakeThreadCreateDeps(
  input: {
    candidates?: Array<{ guildId: string; config: unknown }>;
    existingLink?: TicketThreadLinkRef | null;
  } = {},
): { deps: TicketThreadCreateDeps; savedLinks: TicketThreadLinkInput[] } {
  const savedLinks: TicketThreadLinkInput[] = [];
  const deps: TicketThreadCreateDeps = {
    bridge: { apiBaseUrl: 'https://api.example.test', secret: 'bridge-secret' },
    async listGuildCandidates() {
      return input.candidates ?? [{ guildId: GUILD_ID, config: TICKETS_CONFIG }];
    },
    async findLinkByTicketId() {
      return input.existingLink ?? null;
    },
    async saveLink(link) {
      savedLinks.push(link);
    },
  };
  return { deps, savedLinks };
}

const THREAD_CREATE_ROW: TicketOutboxRow = {
  id: '7',
  ticketId: 'TK-ABCDEF012345',
  kind: 'thread_create',
  payload: THREAD_CREATE_PAYLOAD,
  payloadHash: 'hash',
  attempts: 0,
};

const TEST_LOGGER = { error() {}, warn() {}, info() {}, debug() {} };

test('thread_create 正常系: 作成→依頼者追加→intro→受理→リンク保存→/thread→通知→ack', async () => {
  const { fetchImpl, calls } = createThreadCreateFetch();
  const { store, ackedSent, ackedFailed } = createRecordingStore(THREAD_CREATE_ROW);
  const { deps, savedLinks } = createFakeThreadCreateDeps();
  const runtime = await startTicketDiscordPollerRuntime({
    logger: TEST_LOGGER as never,
    store,
    discordBotToken: 'token',
    fetchImpl,
    threadCreate: deps,
  });
  await runtime.close();

  assert.deepEqual(ackedFailed, []);
  assert.deepEqual(ackedSent, [{ id: '7', messageId: INTRO_MESSAGE_ID }]);

  const createCall = calls.find((call) => /\/channels\/\d+\/threads$/.test(call.url));
  assert.ok(createCall);
  assert.equal(createCall.url, `https://discord.com/api/v10/channels/${PANEL_CHANNEL_ID}/threads`);
  assert.deepEqual(createCall.body, {
    name: '🎫 TK-ABCDEF012345 サーバーに入れません',
    type: 12,
    invitable: false,
  });
  assert.ok(
    calls.some(
      (call) =>
        call.method === 'PUT' &&
        call.url.includes(`/channels/${CREATED_THREAD_ID}/thread-members/${REQUESTER_ID}`),
    ),
  );
  const introCall = calls.find(
    (call) =>
      call.method === 'POST' && call.url.endsWith(`/channels/${CREATED_THREAD_ID}/messages`),
  );
  assert.ok(introCall);
  const introBody = introCall.body as {
    embeds: Array<{ title?: string; footer?: { text: string } }>;
  };
  assert.equal(introBody.embeds[0]?.title, '🎫 TK-ABCDEF012345 サーバーに入れません');
  assert.equal(introBody.embeds[1]?.footer?.text, 'ticket-outbox:7');

  // 受理メッセージ (一次受け) が intro の直後に別メッセージで投稿される。
  const threadMessageCalls = calls.filter(
    (call) =>
      call.method === 'POST' && call.url.endsWith(`/channels/${CREATED_THREAD_ID}/messages`),
  );
  assert.equal(threadMessageCalls.length, 2);
  assert.equal(threadMessageCalls[0], introCall);
  const acceptanceBody = threadMessageCalls[1]?.body as {
    content?: string;
    embeds: unknown[];
    allowed_mentions: unknown;
  };
  assert.equal(acceptanceBody.content, TICKET_ACCEPTANCE_MESSAGE);
  assert.deepEqual(acceptanceBody.embeds, []);
  assert.deepEqual(acceptanceBody.allowed_mentions, { parse: [] });

  assert.deepEqual(savedLinks, [
    {
      ticketId: 'TK-ABCDEF012345',
      guildId: GUILD_ID,
      channelId: PANEL_CHANNEL_ID,
      threadId: CREATED_THREAD_ID,
      requesterId: REQUESTER_ID,
    },
  ]);
  const linkCall = calls.find((call) => call.url.includes('/v1/herta/tickets/thread'));
  assert.ok(linkCall);
  assert.deepEqual(linkCall.body, {
    ticketId: 'TK-ABCDEF012345',
    discordChannelId: PANEL_CHANNEL_ID,
    discordThreadId: CREATED_THREAD_ID,
  });
  assert.ok(linkCall.headers.get('X-IVRM-Signature'));
  assert.equal(
    linkCall.headers.get('X-IVRM-Event-Id'),
    deriveTicketThreadEventId(`ticket-thread:TK-ABCDEF012345:${CREATED_THREAD_ID}`),
  );

  const notifyCall = calls.find(
    (call) =>
      call.method === 'POST' && call.url.endsWith(`/channels/${NOTIFY_CHANNEL_ID}/messages`),
  );
  assert.ok(notifyCall);
  assert.equal((notifyCall.body as { content?: string }).content, `<@&${STAFF_ROLE_ID}>`);
});

test('thread_create 冪等: 同名スレッドと intro マーカー・受理メッセージがあれば作り直さず通知もしない', async () => {
  const existingIntroId = '300000000000000055';
  const { fetchImpl, calls } = createThreadCreateFetch({
    activeThreads: [
      {
        id: CREATED_THREAD_ID,
        parent_id: PANEL_CHANNEL_ID,
        name: '🎫 TK-ABCDEF012345 サーバーに入れません',
      },
    ],
    threadHistory: [
      {
        id: existingIntroId,
        author: { id: BOT_USER_ID },
        content: '',
        embeds: [{ footer: { text: 'ticket-outbox:7' } }],
      },
      {
        id: '300000000000000056',
        author: { id: BOT_USER_ID },
        content: TICKET_ACCEPTANCE_MESSAGE,
        embeds: [],
      },
    ],
  });
  const { store, ackedSent, ackedFailed } = createRecordingStore(THREAD_CREATE_ROW);
  const { deps, savedLinks } = createFakeThreadCreateDeps();
  const runtime = await startTicketDiscordPollerRuntime({
    logger: TEST_LOGGER as never,
    store,
    discordBotToken: 'token',
    fetchImpl,
    threadCreate: deps,
  });
  await runtime.close();

  assert.deepEqual(ackedFailed, []);
  assert.deepEqual(ackedSent, [{ id: '7', messageId: existingIntroId }]);
  assert.equal(
    calls.some((call) => /\/channels\/\d+\/threads$/.test(call.url) && call.method === 'POST'),
    false,
  );
  assert.equal(
    calls.some((call) => call.method === 'POST' && call.url.includes('/messages')),
    false,
  );
  // リンク保存と /thread 配送は冪等なので行われる。
  assert.equal(savedLinks.length, 1);
  assert.ok(calls.some((call) => call.url.includes('/v1/herta/tickets/thread')));
});

test('thread_create 冪等: intro 済みで受理メッセージが無ければ受理メッセージだけを投稿する', async () => {
  const existingIntroId = '300000000000000055';
  const { fetchImpl, calls } = createThreadCreateFetch({
    activeThreads: [
      {
        id: CREATED_THREAD_ID,
        parent_id: PANEL_CHANNEL_ID,
        name: '🎫 TK-ABCDEF012345 サーバーに入れません',
      },
    ],
    threadHistory: [
      {
        id: existingIntroId,
        author: { id: BOT_USER_ID },
        content: '',
        embeds: [{ footer: { text: 'ticket-outbox:7' } }],
      },
    ],
  });
  const { store, ackedSent, ackedFailed } = createRecordingStore(THREAD_CREATE_ROW);
  const { deps, savedLinks } = createFakeThreadCreateDeps();
  const runtime = await startTicketDiscordPollerRuntime({
    logger: TEST_LOGGER as never,
    store,
    discordBotToken: 'token',
    fetchImpl,
    threadCreate: deps,
  });
  await runtime.close();

  assert.deepEqual(ackedFailed, []);
  assert.deepEqual(ackedSent, [{ id: '7', messageId: existingIntroId }]);
  const threadMessageCalls = calls.filter(
    (call) =>
      call.method === 'POST' && call.url.endsWith(`/channels/${CREATED_THREAD_ID}/messages`),
  );
  assert.equal(threadMessageCalls.length, 1);
  assert.equal(
    (threadMessageCalls[0]?.body as { content?: string }).content,
    TICKET_ACCEPTANCE_MESSAGE,
  );
  // intro を今回投稿していないため運用通知は出ない。
  assert.equal(
    calls.some(
      (call) =>
        call.method === 'POST' && call.url.endsWith(`/channels/${NOTIFY_CHANNEL_ID}/messages`),
    ),
    false,
  );
  assert.equal(savedLinks.length, 1);
  assert.ok(calls.some((call) => call.url.includes('/v1/herta/tickets/thread')));
});

test('thread_create 冪等: 保存済みリンクがあれば Guild 解決と作成をスキップする', async () => {
  const { fetchImpl, calls } = createThreadCreateFetch();
  const { store, ackedSent, ackedFailed } = createRecordingStore(THREAD_CREATE_ROW);
  const { deps, savedLinks } = createFakeThreadCreateDeps({
    existingLink: { guildId: GUILD_ID, channelId: PANEL_CHANNEL_ID, threadId: CREATED_THREAD_ID },
  });
  const runtime = await startTicketDiscordPollerRuntime({
    logger: TEST_LOGGER as never,
    store,
    discordBotToken: 'token',
    fetchImpl,
    threadCreate: deps,
  });
  await runtime.close();

  assert.deepEqual(ackedFailed, []);
  assert.deepEqual(ackedSent, [{ id: '7', messageId: INTRO_MESSAGE_ID }]);
  assert.equal(
    calls.some((call) => call.url.includes('/members/')),
    false,
  );
  assert.equal(
    calls.some((call) => call.url.includes('/threads/active')),
    false,
  );
  assert.equal(savedLinks.length, 0);
  // intro はまだ無いため投稿され、運用通知も出る。
  assert.ok(
    calls.some(
      (call) =>
        call.method === 'POST' && call.url.endsWith(`/channels/${NOTIFY_CHANNEL_ID}/messages`),
    ),
  );
});

test('thread_create Guild 特定: 依頼者が所属する Guild を選ぶ', async () => {
  const { fetchImpl, calls } = createThreadCreateFetch({
    memberStatusByGuild: { [GUILD_ID]: 404, [OTHER_GUILD_ID]: 200 },
  });
  const { store, ackedSent, ackedFailed } = createRecordingStore(THREAD_CREATE_ROW);
  const { deps, savedLinks } = createFakeThreadCreateDeps({
    candidates: [
      { guildId: GUILD_ID, config: TICKETS_CONFIG },
      {
        guildId: OTHER_GUILD_ID,
        config: { ...TICKETS_CONFIG, panelChannelId: OTHER_PANEL_CHANNEL_ID },
      },
    ],
  });
  const runtime = await startTicketDiscordPollerRuntime({
    logger: TEST_LOGGER as never,
    store,
    discordBotToken: 'token',
    fetchImpl,
    threadCreate: deps,
  });
  await runtime.close();

  assert.deepEqual(ackedFailed, []);
  assert.deepEqual(ackedSent, [{ id: '7', messageId: INTRO_MESSAGE_ID }]);
  assert.equal(savedLinks[0]?.guildId, OTHER_GUILD_ID);
  assert.equal(savedLinks[0]?.channelId, OTHER_PANEL_CHANNEL_ID);
  assert.ok(
    calls.some(
      (call) =>
        call.url === `https://discord.com/api/v10/channels/${OTHER_PANEL_CHANNEL_ID}/threads`,
    ),
  );
});

test('thread_create: 依頼者が全 Guild 未所属なら恒久 failed', async () => {
  const { fetchImpl, calls } = createThreadCreateFetch({
    memberStatusByGuild: { [GUILD_ID]: 404 },
  });
  const { store, ackedSent, ackedFailed } = createRecordingStore(THREAD_CREATE_ROW);
  const { deps } = createFakeThreadCreateDeps();
  const runtime = await startTicketDiscordPollerRuntime({
    logger: TEST_LOGGER as never,
    store,
    discordBotToken: 'token',
    fetchImpl,
    threadCreate: deps,
  });
  await runtime.close();

  assert.deepEqual(ackedSent, []);
  assert.deepEqual(ackedFailed, [
    { id: '7', error: 'ticket_requester_not_in_guild', permanent: true },
  ]);
  assert.equal(
    calls.some((call) => /\/channels\/\d+\/threads$/.test(call.url)),
    false,
  );
});

test('thread_create: パネル未設定 (候補なし) は恒久 failed', async () => {
  const { fetchImpl } = createThreadCreateFetch();
  const { store, ackedFailed } = createRecordingStore(THREAD_CREATE_ROW);
  const { deps } = createFakeThreadCreateDeps({ candidates: [] });
  const runtime = await startTicketDiscordPollerRuntime({
    logger: TEST_LOGGER as never,
    store,
    discordBotToken: 'token',
    fetchImpl,
    threadCreate: deps,
  });
  await runtime.close();
  assert.deepEqual(ackedFailed, [
    { id: '7', error: 'ticket_panel_not_configured', permanent: true },
  ]);
});

test('thread_create: 通知 OFF / 通知先なしではメンションも通知も出ない', async () => {
  // notifyStaffOnCreate=false: 通知は出すがメンションしない。
  {
    const { fetchImpl, calls } = createThreadCreateFetch();
    const { store, ackedFailed } = createRecordingStore(THREAD_CREATE_ROW);
    const { deps } = createFakeThreadCreateDeps({
      candidates: [
        { guildId: GUILD_ID, config: { ...TICKETS_CONFIG, notifyStaffOnCreate: false } },
      ],
    });
    const runtime = await startTicketDiscordPollerRuntime({
      logger: TEST_LOGGER as never,
      store,
      discordBotToken: 'token',
      fetchImpl,
      threadCreate: deps,
    });
    await runtime.close();
    assert.deepEqual(ackedFailed, []);
    const notifyCall = calls.find(
      (call) =>
        call.method === 'POST' && call.url.endsWith(`/channels/${NOTIFY_CHANNEL_ID}/messages`),
    );
    assert.ok(notifyCall);
    assert.equal((notifyCall.body as { content?: string }).content, undefined);
    assert.deepEqual((notifyCall.body as { allowed_mentions: unknown }).allowed_mentions, {
      parse: [],
    });
  }
  // notifyChannelId=null: 通知自体を送らない。
  {
    const { fetchImpl, calls } = createThreadCreateFetch();
    const { store, ackedSent, ackedFailed } = createRecordingStore(THREAD_CREATE_ROW);
    const { deps } = createFakeThreadCreateDeps({
      candidates: [{ guildId: GUILD_ID, config: { ...TICKETS_CONFIG, notifyChannelId: null } }],
    });
    const runtime = await startTicketDiscordPollerRuntime({
      logger: TEST_LOGGER as never,
      store,
      discordBotToken: 'token',
      fetchImpl,
      threadCreate: deps,
    });
    await runtime.close();
    assert.deepEqual(ackedFailed, []);
    assert.deepEqual(ackedSent, [{ id: '7', messageId: INTRO_MESSAGE_ID }]);
    assert.equal(
      calls.some((call) => call.method === 'POST' && call.url.includes(NOTIFY_CHANNEL_ID)),
      false,
    );
  }
});

test('thread_create: /thread の conflict は恒久 failed、5xx は再試行', async () => {
  {
    const { fetchImpl } = createThreadCreateFetch({ linkStatus: 409 });
    const { store, ackedSent, ackedFailed } = createRecordingStore(THREAD_CREATE_ROW);
    const { deps } = createFakeThreadCreateDeps();
    const runtime = await startTicketDiscordPollerRuntime({
      logger: TEST_LOGGER as never,
      store,
      discordBotToken: 'token',
      fetchImpl,
      threadCreate: deps,
    });
    await runtime.close();
    assert.deepEqual(ackedSent, []);
    assert.deepEqual(ackedFailed, [
      { id: '7', error: 'ticket_thread_link_conflict', permanent: true },
    ]);
  }
  {
    const { fetchImpl } = createThreadCreateFetch({ linkStatus: 500 });
    const { store, ackedSent, ackedFailed } = createRecordingStore(THREAD_CREATE_ROW);
    const { deps } = createFakeThreadCreateDeps();
    const runtime = await startTicketDiscordPollerRuntime({
      logger: TEST_LOGGER as never,
      store,
      discordBotToken: 'token',
      fetchImpl,
      threadCreate: deps,
    });
    await runtime.close();
    assert.deepEqual(ackedSent, []);
    assert.deepEqual(ackedFailed, [
      { id: '7', error: 'discord_post_failed_500', permanent: false },
    ]);
  }
});

test('thread_create: 依存未設定なら恒久 failed (fetch は呼ばない)', async () => {
  let fetchCalls = 0;
  const fetchImpl = (async () => {
    fetchCalls += 1;
    throw new Error('must not be called');
  }) as typeof fetch;
  const { store, ackedFailed } = createRecordingStore(THREAD_CREATE_ROW);
  const runtime = await startTicketDiscordPollerRuntime({
    logger: TEST_LOGGER as never,
    store,
    discordBotToken: 'token',
    fetchImpl,
  });
  await runtime.close();
  assert.equal(fetchCalls, 0);
  assert.deepEqual(ackedFailed, [
    { id: '7', error: 'ticket_thread_create_unavailable', permanent: true },
  ]);
});

test('thread_create: internal payload は送信せず恒久 failed', async () => {
  let fetchCalls = 0;
  const fetchImpl = (async () => {
    fetchCalls += 1;
    throw new Error('must not be called');
  }) as typeof fetch;
  const row: TicketOutboxRow = {
    ...THREAD_CREATE_ROW,
    payload: { ...THREAD_CREATE_PAYLOAD, internal: true },
  };
  const { store, ackedFailed } = createRecordingStore(row);
  const { deps } = createFakeThreadCreateDeps();
  const runtime = await startTicketDiscordPollerRuntime({
    logger: TEST_LOGGER as never,
    store,
    discordBotToken: 'token',
    fetchImpl,
    threadCreate: deps,
  });
  await runtime.close();
  assert.equal(fetchCalls, 0);
  assert.deepEqual(ackedFailed, [{ id: '7', error: 'ticket_payload_internal', permanent: true }]);
});
