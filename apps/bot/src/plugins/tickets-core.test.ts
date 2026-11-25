import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildTicketAttachmentPayload,
  buildTicketAttachmentSkipNote,
  buildTicketCreatePayload,
  buildTicketMessageBody,
  buildTicketMessagePayload,
  buildTicketRequest,
  buildTicketThreadPayload,
  classifyTicketResponse,
  deriveTicketEventId,
  downloadTicketAttachmentBytes,
  hasSupportedTicketAttachmentMagic,
  isTicketCategory,
  normalizeTicketsConfig,
  planTicketAttachmentTransfers,
  resolveTicketBridgeConfig,
  ticketCategoryLabel,
  ticketRetryDelayMs,
  TICKET_ATTACHMENT_MAX_BYTES,
  TICKET_ATTACHMENTS_PATH,
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
  it('第2段 (b): CDN URL は記録せず、転送できなかった添付の注記だけを付記する', () => {
    const body = buildTicketMessageBody('スクリーンショットです', [
      buildTicketAttachmentSkipNote('error.png', 'unsupported_format'),
    ]);
    expect(body).toBe(
      'スクリーンショットです\n[添付] error.png（対応していない形式のため Web へ転送されませんでした）',
    );
    expect(body).not.toContain('cdn.discordapp.com');
  });

  it('注記が無ければ本文そのまま', () => {
    expect(buildTicketMessageBody('  本文  ', [])).toBe('本文');
  });

  it('契約上限を超える場合は付記込みで切り詰める', () => {
    const body = buildTicketMessageBody('あ'.repeat(5000), [
      buildTicketAttachmentSkipNote('a.png', 'too_large'),
    ]);
    expect(body.length).toBe(TICKET_BODY_MAX_LENGTH);
  });
});

describe('planTicketAttachmentTransfers', () => {
  it('25MB超の申告サイズと11件目以降は転送対象から外す', () => {
    const files = Array.from({ length: 12 }, (_, index) => ({
      name: `f${index}.png`,
      url: `https://cdn.example.test/${index}`,
      size: 100,
    }));
    files[0] = { ...files[0]!, size: TICKET_ATTACHMENT_MAX_BYTES + 1 };
    const plan = planTicketAttachmentTransfers(files);
    expect(plan.transfer.length).toBe(9);
    expect(plan.skipped).toEqual([
      { name: 'f0.png', reason: 'too_large' },
      { name: 'f10.png', reason: 'too_many' },
      { name: 'f11.png', reason: 'too_many' },
    ]);
  });
});

describe('hasSupportedTicketAttachmentMagic', () => {
  it('画像・PDF・音声・動画のマジックを通し、実行ファイルと通常zipを落とす', () => {
    expect(
      hasSupportedTicketAttachmentMagic(
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
    ).toBe(true);
    expect(hasSupportedTicketAttachmentMagic(new TextEncoder().encode('%PDF-1.7'))).toBe(true);
    expect(
      hasSupportedTicketAttachmentMagic(new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70])),
    ).toBe(true);
    expect(hasSupportedTicketAttachmentMagic(new TextEncoder().encode('ID3'))).toBe(true);
    expect(hasSupportedTicketAttachmentMagic(new Uint8Array([0x4d, 0x5a, 0x90, 0]))).toBe(false);
    expect(
      hasSupportedTicketAttachmentMagic(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3])),
    ).toBe(false);
  });
});

describe('buildTicketAttachmentPayload', () => {
  it('kind=attachment で base64 JSON を作り、eventId は決定的', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const first = buildTicketAttachmentPayload({
      ticketId: 'TK-0123456789AB',
      discordMessageId: '555555555555555555',
      fileName: 'a.png',
      bytes,
    });
    const second = buildTicketAttachmentPayload({
      ticketId: 'TK-0123456789AB',
      discordMessageId: '555555555555555555',
      fileName: 'a.png',
      bytes,
    });
    expect(first.kind).toBe('attachment');
    expect(first.eventId).toBe(second.eventId);
    expect(first.sourceEventId).toBe(second.sourceEventId);
    const parsed = JSON.parse(first.body) as Record<string, unknown>;
    expect(parsed['ticketId']).toBe('TK-0123456789AB');
    expect(parsed['discordMessageId']).toBe('555555555555555555');
    expect(Buffer.from(parsed['contentBase64'] as string, 'base64')).toEqual(Buffer.from(bytes));
    expect(TICKET_ATTACHMENTS_PATH).toBe('/v1/herta/tickets/attachments');
  });
});

describe('downloadTicketAttachmentBytes', () => {
  it('上限超過の応答は null に倒す', async () => {
    const fetchImpl = (async () =>
      new Response(new Uint8Array(10), {
        status: 200,
        headers: { 'content-length': String(TICKET_ATTACHMENT_MAX_BYTES + 1) },
      })) as typeof fetch;
    await expect(
      downloadTicketAttachmentBytes(
        { name: 'a.png', url: 'https://cdn.example.test/a' },
        fetchImpl,
      ),
    ).resolves.toBeNull();
  });

  it('HTTP エラーは null に倒す', async () => {
    const fetchImpl = (async () => new Response(null, { status: 404 })) as typeof fetch;
    await expect(
      downloadTicketAttachmentBytes(
        { name: 'a.png', url: 'https://cdn.example.test/a' },
        fetchImpl,
      ),
    ).resolves.toBeNull();
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
