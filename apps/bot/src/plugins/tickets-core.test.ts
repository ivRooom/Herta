import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildTicketCreatePayload,
  buildTicketMessageBody,
  buildTicketMessagePayload,
  buildTicketRequest,
  buildTicketThreadPayload,
  classifyTicketResponse,
  deriveTicketEventId,
  isTicketCategory,
  normalizeTicketsConfig,
  resolveTicketBridgeConfig,
  ticketCategoryLabel,
  ticketRetryDelayMs,
  TICKET_BODY_MAX_LENGTH,
} from './tickets-core.js';

const bridge = { apiBaseUrl: 'https://api.example.test', secret: 'test-secret' };

describe('buildTicketRequest', () => {
  it('契約 v1 の canonical 文字列 (METHOD\\nPATH\\ntimestamp\\neventId\\nbody) で署名する', () => {
    const body = '{"ticketId":"TK-0123456789AB"}';
    const request = buildTicketRequest(
      bridge,
      '/v1/herta/tickets/thread',
      '11111111-1111-5111-8111-111111111111',
      body,
      '2026-11-25T00:00:00.000Z',
    );
    const expected = createHmac('sha256', 'test-secret')
      .update(
        [
          'POST',
          '/v1/herta/tickets/thread',
          '2026-11-25T00:00:00.000Z',
          '11111111-1111-5111-8111-111111111111',
          body,
        ].join('\n'),
      )
      .digest('hex');
    expect(request.url).toBe('https://api.example.test/v1/herta/tickets/thread');
    expect(request.init.headers['X-IVRM-Signature']).toBe(expected);
    expect(request.init.headers['X-IVRM-Event-Id']).toBe('11111111-1111-5111-8111-111111111111');
    expect(request.init.body).toBe(body);
  });
});

describe('deriveTicketEventId', () => {
  it('決定的で UUID 形式 (version 5 / variant) を返す', () => {
    const first = deriveTicketEventId('ticket-msg:123456789012345678');
    const second = deriveTicketEventId('ticket-msg:123456789012345678');
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(deriveTicketEventId('ticket-msg:999')).not.toBe(first);
  });
});

describe('カテゴリ写像', () => {
  it('契約の4分類だけを受け付ける', () => {
    expect(isTicketCategory('discord')).toBe(true);
    expect(isTicketCategory('game_server')).toBe(true);
    expect(isTicketCategory('privacy')).toBe(true);
    expect(isTicketCategory('general')).toBe(true);
    expect(isTicketCategory('other')).toBe(false);
    expect(isTicketCategory('')).toBe(false);
    expect(isTicketCategory(null)).toBe(false);
  });

  it('日本語ラベルを返す', () => {
    expect(ticketCategoryLabel('discord')).toBe('Discord全般');
    expect(ticketCategoryLabel('game_server')).toBe('ゲーム・サーバー');
    expect(ticketCategoryLabel('privacy')).toBe('プライバシー・データ削除');
    expect(ticketCategoryLabel('general')).toBe('その他');
  });
});

describe('payload builders', () => {
  it('create は契約キーのみで組み立て、submissionId から冪等キーを導出する', () => {
    const payload = buildTicketCreatePayload({
      submissionId: '1234567890123456789',
      discordUserId: '222222222222222222',
      requesterName: 'requester',
      category: 'privacy',
      subject: '削除について',
      body: '本文です',
    });
    expect(payload.sourceEventId).toBe('ticket-create:1234567890123456789');
    expect(payload.eventId).toBe(deriveTicketEventId(payload.sourceEventId));
    expect(JSON.parse(payload.body)).toEqual({
      discordUserId: '222222222222222222',
      requesterName: 'requester',
      category: 'privacy',
      subject: '削除について',
      body: '本文です',
    });
  });

  it('thread は ticketId と Discord ID の組だけを送る', () => {
    const payload = buildTicketThreadPayload({
      ticketId: 'TK-0123456789AB',
      discordChannelId: '333333333333333333',
      discordThreadId: '444444444444444444',
    });
    expect(payload.kind).toBe('thread');
    expect(JSON.parse(payload.body)).toEqual({
      ticketId: 'TK-0123456789AB',
      discordChannelId: '333333333333333333',
      discordThreadId: '444444444444444444',
    });
  });

  it('message は authorKind を含まない (サーバー側が正本から導出する)', () => {
    const payload = buildTicketMessagePayload({
      ticketId: 'TK-0123456789AB',
      authorDiscordUserId: '222222222222222222',
      discordMessageId: '555555555555555555',
      body: '返信です',
    });
    expect(payload.kind).toBe('message');
    const parsed = JSON.parse(payload.body) as Record<string, unknown>;
    expect(parsed).toEqual({
      ticketId: 'TK-0123456789AB',
      authorDiscordUserId: '222222222222222222',
      discordMessageId: '555555555555555555',
      body: '返信です',
    });
    expect('authorKind' in parsed).toBe(false);
    expect('staffRoleIds' in parsed).toBe(false);
  });
});

describe('buildTicketMessageBody', () => {
  it('添付は参照 (ファイル名とURL) を本文末尾へ付記する', () => {
    const body = buildTicketMessageBody('スクリーンショットです', [
      { name: 'error.png', url: 'https://cdn.discordapp.com/attachments/1/2/error.png' },
    ]);
    expect(body).toBe(
      'スクリーンショットです\n[添付] error.png: https://cdn.discordapp.com/attachments/1/2/error.png',
    );
  });

  it('添付が無ければ本文そのまま', () => {
    expect(buildTicketMessageBody('  本文  ', [])).toBe('本文');
  });

  it('契約上限を超える場合は付記込みで切り詰める', () => {
    const body = buildTicketMessageBody('あ'.repeat(5000), [
      { name: 'a.png', url: 'https://example.test/a.png' },
    ]);
    expect(body.length).toBe(TICKET_BODY_MAX_LENGTH);
  });
});

describe('classifyTicketResponse', () => {
  it('200/201 は sent、401 は auth_failure、403/409/422 は dropped、それ以外は retryable', () => {
    expect(classifyTicketResponse(200)).toBe('sent');
    expect(classifyTicketResponse(201)).toBe('sent');
    expect(classifyTicketResponse(401)).toBe('auth_failure');
    expect(classifyTicketResponse(403)).toBe('dropped');
    expect(classifyTicketResponse(409)).toBe('dropped');
    expect(classifyTicketResponse(422)).toBe('dropped');
    expect(classifyTicketResponse(500)).toBe('retryable');
    expect(classifyTicketResponse(503)).toBe('retryable');
  });
});

describe('ticketRetryDelayMs', () => {
  it('30秒から倍増し1時間で頭打ちになる', () => {
    expect(ticketRetryDelayMs(1)).toBe(30_000);
    expect(ticketRetryDelayMs(2)).toBe(60_000);
    expect(ticketRetryDelayMs(3)).toBe(120_000);
    expect(ticketRetryDelayMs(20)).toBe(3_600_000);
  });
});

describe('resolveTicketBridgeConfig', () => {
  it('URL と secret がそろった場合のみ有効', () => {
    expect(
      resolveTicketBridgeConfig({
        IVRM_WEB_API_BASE_URL: 'https://api.example.test/',
        HERTA_TICKET_SECRET: 'secret',
      }),
    ).toEqual({ apiBaseUrl: 'https://api.example.test', secret: 'secret' });
    expect(
      resolveTicketBridgeConfig({ IVRM_WEB_API_BASE_URL: 'https://api.example.test' }),
    ).toBeNull();
    expect(resolveTicketBridgeConfig({ HERTA_TICKET_SECRET: 'secret' })).toBeNull();
    expect(resolveTicketBridgeConfig({})).toBeNull();
    expect(
      resolveTicketBridgeConfig({
        IVRM_WEB_API_BASE_URL: 'http://api.example.test',
        HERTA_TICKET_SECRET: 'secret',
      }),
    ).toBeNull();
  });
});

describe('normalizeTicketsConfig', () => {
  it('既定値と snowflake 検証・カテゴリ有効化を適用する', () => {
    const config = normalizeTicketsConfig({
      panelChannelId: '123456789012345678',
      staffRoleIds: ['111', 'abc', '111', 42],
      notifyChannelId: 'not-a-snowflake',
      categoryPrivacyEnabled: false,
    });
    expect(config.enabled).toBe(true);
    expect(config.panelChannelId).toBe('123456789012345678');
    expect(config.staffRoleIds).toEqual(['111']);
    expect(config.notifyChannelId).toBeNull();
    expect(config.enabledCategories).toEqual(['discord', 'game_server', 'general']);
  });

  it('未設定なら全カテゴリ有効', () => {
    expect(normalizeTicketsConfig(undefined).enabledCategories).toEqual([
      'discord',
      'game_server',
      'privacy',
      'general',
    ]);
  });
});
