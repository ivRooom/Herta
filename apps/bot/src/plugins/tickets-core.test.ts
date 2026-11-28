import { createHmac } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  buildTicketActionEmbed,
  buildTicketAttachmentPayload,
  buildTicketAttachmentSkipNote,
  buildTicketCreatePayload,
  buildTicketCreatedEmbed,
  buildTicketErasureCreatePayload,
  buildTicketCreatedSuccessEmbed,
  buildTicketIntroEmbed,
  buildTicketMessageBody,
  buildTicketMessagePayload,
  buildTicketPanelEmbed,
  buildTicketRequest,
  buildTicketThreadPayload,
  classifyTicketResponse,
  deriveTicketEventId,
  downloadTicketAttachment,
  hasSupportedTicketAttachmentMagic,
  isTicketCategory,
  normalizeTicketsConfig,
  planTicketAttachmentTransfers,
  resolveTicketBridgeConfig,
  ticketCategoryColor,
  ticketCategoryLabel,
  ticketRetryDelayMs,
  TicketAttachmentByteBudget,
  TicketAttachmentIntakeLimiter,
  TICKET_ACCEPTANCE_MESSAGE,
  TICKET_ATTACHMENT_MAX_BYTES,
  TICKET_ATTACHMENT_MESSAGE_MAX_BYTES,
  TICKET_ATTACHMENTS_PATH,
  TICKET_BODY_MAX_LENGTH,
  TICKET_CATEGORY_COLORS,
  TICKET_ERASURE_BODY,
  TICKET_ERASURE_SUBJECT,
  TICKET_SUBJECT_MAX_LENGTH,
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

  it('erasure create は requestId を冪等キーにし、理由を body に含めない (#750 T2)', () => {
    const payload = buildTicketErasureCreatePayload({
      requestId: '3f6b0e62-9d4c-4d3f-9f6e-2f5a1b8c7d90',
      discordUserId: '222222222222222222',
      requesterName: 'requester',
    });
    expect(payload.kind).toBe('create');
    expect(payload.sourceEventId).toBe(
      'ticket-erasure-create:3f6b0e62-9d4c-4d3f-9f6e-2f5a1b8c7d90',
    );
    expect(payload.eventId).toBe(deriveTicketEventId(payload.sourceEventId));
    // 起票前はチケットIDが無いため、相関キーとして requestId が入る。
    expect(payload.ticketId).toBe('3f6b0e62-9d4c-4d3f-9f6e-2f5a1b8c7d90');
    const parsed = JSON.parse(payload.body) as Record<string, unknown>;
    expect(parsed).toEqual({
      discordUserId: '222222222222222222',
      requesterName: 'requester',
      category: 'privacy',
      subject: TICKET_ERASURE_SUBJECT,
      body: TICKET_ERASURE_BODY,
      erasureRequestId: '3f6b0e62-9d4c-4d3f-9f6e-2f5a1b8c7d90',
    });
    expect('reason' in parsed).toBe(false);
    expect(TICKET_ERASURE_SUBJECT.length).toBeLessThanOrEqual(TICKET_SUBJECT_MAX_LENGTH);
    expect(TICKET_ERASURE_BODY.length).toBeLessThanOrEqual(TICKET_BODY_MAX_LENGTH);
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

  it('長い本文でも注記は切り詰めで脱落しない (注記分を予約して本文を詰める)', () => {
    const noteA = buildTicketAttachmentSkipNote('a.png', 'too_large');
    const noteB = buildTicketAttachmentSkipNote('b.png', 'unsupported_format');
    const body = buildTicketMessageBody('あ'.repeat(5000), [noteA, noteB]);
    expect(body.length).toBe(TICKET_BODY_MAX_LENGTH);
    expect(body).toContain(noteA);
    expect(body.endsWith(noteB)).toBe(true);
  });
});

/** 中央ディレクトリ付きの最小 ZIP を組み立てるテスト用ヘルパー (deflate 指定も可)。 */
function buildZipBytes(
  entries: Array<{ name: string; data: Uint8Array; deflate?: boolean }>,
): Uint8Array {
  const encoder = new TextEncoder();
  const pushU16 = (arr: number[], value: number) => {
    arr.push(value & 0xff, (value >> 8) & 0xff);
  };
  const pushU32 = (arr: number[], value: number) => {
    arr.push(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff);
  };
  const parts: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const stored = entry.deflate ? new Uint8Array(deflateRawSync(entry.data)) : entry.data;
    const method = entry.deflate ? 8 : 0;
    const local: number[] = [];
    pushU32(local, 0x04034b50);
    pushU16(local, 20);
    pushU16(local, 0);
    pushU16(local, method);
    pushU16(local, 0);
    pushU16(local, 0);
    pushU32(local, 0);
    pushU32(local, stored.length);
    pushU32(local, entry.data.length);
    pushU16(local, nameBytes.length);
    pushU16(local, 0);
    parts.push(new Uint8Array(local), nameBytes, stored);
    const central: number[] = [];
    pushU32(central, 0x02014b50);
    pushU16(central, 20);
    pushU16(central, 20);
    pushU16(central, 0);
    pushU16(central, method);
    pushU16(central, 0);
    pushU16(central, 0);
    pushU32(central, 0);
    pushU32(central, stored.length);
    pushU32(central, entry.data.length);
    pushU16(central, nameBytes.length);
    pushU16(central, 0);
    pushU16(central, 0);
    pushU16(central, 0);
    pushU16(central, 0);
    pushU32(central, 0);
    pushU32(central, offset);
    centrals.push(new Uint8Array(central), nameBytes);
    offset += local.length + nameBytes.length + stored.length;
  }
  const cdOffset = offset;
  const cdSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const eocd: number[] = [];
  pushU32(eocd, 0x06054b50);
  pushU16(eocd, 0);
  pushU16(eocd, 0);
  pushU16(eocd, entries.length);
  pushU16(eocd, entries.length);
  pushU32(eocd, cdSize);
  pushU32(eocd, cdOffset);
  pushU16(eocd, 0);
  const all = [...parts, ...centrals, new Uint8Array(eocd)];
  const out = new Uint8Array(all.reduce((sum, part) => sum + part.length, 0));
  let position = 0;
  for (const part of all) {
    out.set(part, position);
    position += part.length;
  }
  return out;
}

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

  it('申告サイズの合計が1メッセージ上限を超える分は message_too_large で落とす', () => {
    const twentyMiB = 20 * 1024 * 1024;
    const files = [0, 1, 2].map((index) => ({
      name: `big${index}.png`,
      url: `https://cdn.example.test/${index}`,
      size: twentyMiB,
    }));
    const plan = planTicketAttachmentTransfers(files);
    // 20MiB × 2 = 40MiB は上限 (50MiB) 内、3件目で超える。
    expect(plan.transfer.map((file) => file.name)).toEqual(['big0.png', 'big1.png']);
    expect(plan.skipped).toEqual([{ name: 'big2.png', reason: 'message_too_large' }]);
    expect(TICKET_ATTACHMENT_MESSAGE_MAX_BYTES).toBe(50 * 1024 * 1024);
    expect(buildTicketAttachmentSkipNote('big2.png', 'message_too_large')).toContain('50MB');
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

  it('大きなメディアを前方に格納した DOCX も中央ディレクトリで判定する', () => {
    // word/document.xml のローカルヘッダが先頭 64KiB の外にある構成。
    // 先頭走査だけの判定では取りこぼす。[Content_Types].xml は実際の
    // DOCX と同様に deflate 圧縮して格納する。
    const docx = buildZipBytes([
      {
        name: '[Content_Types].xml',
        data: new TextEncoder().encode(
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
            '<Default Extension="xml" ContentType="application/xml"/>' +
            '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
            '</Types>',
        ),
        deflate: true,
      },
      { name: 'word/media/image1.png', data: new Uint8Array(70_000) },
      { name: 'word/document.xml', data: new TextEncoder().encode('<w:document/>') },
    ]);
    expect(hasSupportedTicketAttachmentMagic(docx)).toBe(true);
    const plainZip = buildZipBytes([
      { name: 'readme.txt', data: new TextEncoder().encode('hello') },
    ]);
    expect(hasSupportedTicketAttachmentMagic(plainZip)).toBe(false);
  });

  it('主パートのエントリ名だけを持つ通常 ZIP は Office と誤認しない', () => {
    // 展開したファイルを寄せ集めた ZIP: word/document.xml はあるが、
    // パッケージのメタデータ ([Content_Types].xml) が無い。
    const noMetadata = buildZipBytes([
      { name: 'word/document.xml', data: new TextEncoder().encode('<w:document/>') },
    ]);
    expect(hasSupportedTicketAttachmentMagic(noMetadata)).toBe(false);
    // [Content_Types].xml があっても主パートの Override 宣言が無ければ対象外。
    const noOverride = buildZipBytes([
      {
        name: '[Content_Types].xml',
        data: new TextEncoder().encode(
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
            '<Default Extension="xml" ContentType="application/xml"/>' +
            '</Types>',
        ),
      },
      { name: 'word/document.xml', data: new TextEncoder().encode('<w:document/>') },
    ]);
    expect(hasSupportedTicketAttachmentMagic(noOverride)).toBe(false);
  });

  it('主パートが1025件目以降にある XLSX も中央ディレクトリの範囲で判定する', () => {
    // 件数上限で走査を止めると主パートに届かない構成。
    const fillers = Array.from({ length: 1030 }, (_, index) => ({
      name: `xl/media/filler${index}.bin`,
      data: new Uint8Array(0),
    }));
    const xlsx = buildZipBytes([
      {
        name: '[Content_Types].xml',
        data: new TextEncoder().encode(
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
            '</Types>',
        ),
      },
      ...fillers,
      { name: 'xl/workbook.xml', data: new TextEncoder().encode('<workbook/>') },
    ]);
    expect(hasSupportedTicketAttachmentMagic(xlsx)).toBe(true);
  });

  it('サンプル境界で分断されるマルチバイト文字を含むテキストを通す', () => {
    // 'あ' は UTF-8 で3バイト。8192 バイトのサンプル境界が文字の途中に来る。
    const text = 'あ'.repeat(3000);
    expect(hasSupportedTicketAttachmentMagic(new TextEncoder().encode(text))).toBe(true);
    // 不正な UTF-8 は引き続き落とす。
    expect(hasSupportedTicketAttachmentMagic(new Uint8Array([0x61, 0xc3, 0x28, 0x62]))).toBe(false);
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

  it('同一バイトでも添付 ID が違えば冪等キーが分かれ、同じ添付では一致する', () => {
    const bytes = new Uint8Array([9, 9, 9]);
    const base = {
      ticketId: 'TK-0123456789AB',
      discordMessageId: '555555555555555555',
      bytes,
    };
    const first = buildTicketAttachmentPayload({
      ...base,
      fileName: 'before.txt',
      attachmentId: '700000000000000001',
    });
    const second = buildTicketAttachmentPayload({
      ...base,
      fileName: 'after.txt',
      attachmentId: '700000000000000002',
    });
    expect(first.sourceEventId).not.toBe(second.sourceEventId);
    expect(first.eventId).not.toBe(second.eventId);
    const replay = buildTicketAttachmentPayload({
      ...base,
      fileName: 'before.txt',
      attachmentId: '700000000000000001',
    });
    expect(replay.sourceEventId).toBe(first.sourceEventId);
    expect(replay.eventId).toBe(first.eventId);
  });
});

describe('downloadTicketAttachment', () => {
  it('宣言サイズが上限超過の応答は too_large とし、body を cancel する', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(10));
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetchImpl = (async () =>
      new Response(stream, {
        status: 200,
        headers: { 'content-length': String(TICKET_ATTACHMENT_MAX_BYTES + 1) },
      })) as typeof fetch;
    await expect(
      downloadTicketAttachment({ name: 'a.png', url: 'https://cdn.example.test/a' }, fetchImpl),
    ).resolves.toEqual({ ok: false, reason: 'too_large' });
    expect(cancelled).toBe(true);
  });

  it('HTTP エラーは download_failed とし、body を cancel する', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(10));
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetchImpl = (async () => new Response(stream, { status: 404 })) as typeof fetch;
    await expect(
      downloadTicketAttachment({ name: 'a.png', url: 'https://cdn.example.test/a' }, fetchImpl),
    ).resolves.toEqual({ ok: false, reason: 'download_failed' });
    expect(cancelled).toBe(true);
  });

  it('通信失敗は download_failed に倒す', async () => {
    const fetchImpl = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    await expect(
      downloadTicketAttachment({ name: 'a.png', url: 'https://cdn.example.test/a' }, fetchImpl),
    ).resolves.toEqual({ ok: false, reason: 'download_failed' });
  });

  it('Content-Length が無い応答でも、上限を超えた時点で読み取りを中断し too_large を返す', async () => {
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls > 30) {
          controller.close();
          return;
        }
        controller.enqueue(new Uint8Array(1024 * 1024));
      },
    });
    const fetchImpl = (async () => new Response(stream, { status: 200 })) as typeof fetch;
    await expect(
      downloadTicketAttachment({ name: 'big.bin', url: 'https://cdn.example.test/big' }, fetchImpl),
    ).resolves.toEqual({ ok: false, reason: 'too_large' });
    // 25MiB = 25 チャンク分を超えたところで打ち切る (全 30 チャンクを読み切らない)。
    expect(pulls).toBeLessThan(30);
  });

  it('Content-Length が無い小さな応答は実体を返す', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('hello '));
        controller.enqueue(new TextEncoder().encode('world'));
        controller.close();
      },
    });
    const fetchImpl = (async () => new Response(stream, { status: 200 })) as typeof fetch;
    const result = await downloadTicketAttachment(
      { name: 'a.txt', url: 'https://cdn.example.test/a' },
      fetchImpl,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(new TextDecoder().decode(result.bytes)).toBe('hello world');
  });
});

describe('TicketAttachmentByteBudget', () => {
  it('合計上限の範囲内だけ予約でき、失敗した予約は消費しない', () => {
    const budget = new TicketAttachmentByteBudget(100);
    expect(budget.tryReserve(60)).toBe(true);
    expect(budget.tryReserve(41)).toBe(false);
    expect(budget.tryReserve(40)).toBe(true);
    expect(budget.tryReserve(1)).toBe(false);
  });

  it('既定の上限は1メッセージ合計上限と一致する', () => {
    const budget = new TicketAttachmentByteBudget();
    expect(budget.tryReserve(TICKET_ATTACHMENT_MESSAGE_MAX_BYTES)).toBe(true);
    expect(budget.tryReserve(1)).toBe(false);
  });
});

describe('TicketAttachmentIntakeLimiter', () => {
  it('同時実行数が上限を超えず、全タスクが完了する', async () => {
    const limiter = new TicketAttachmentIntakeLimiter(2);
    let active = 0;
    let maxActive = 0;
    let completed = 0;
    const tasks = Array.from({ length: 6 }, () =>
      limiter.run(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
        completed += 1;
      }),
    );
    await Promise.all(tasks);
    expect(maxActive).toBe(2);
    expect(completed).toBe(6);
  });

  it('タスクが失敗してもスロットを解放し、後続が進む', async () => {
    const limiter = new TicketAttachmentIntakeLimiter(1);
    await expect(
      limiter.run(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    await expect(limiter.run(async () => 'ok')).resolves.toBe('ok');
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

describe('Embed 化 (第2段 E1〜E3)', () => {
  it('カテゴリ色は4カテゴリで一意に定義される', () => {
    const colors = Object.values(TICKET_CATEGORY_COLORS);
    expect(colors).toHaveLength(4);
    expect(new Set(colors).size).toBe(4);
    expect(ticketCategoryColor('discord')).toBe(TICKET_CATEGORY_COLORS.discord);
    expect(ticketCategoryColor('privacy')).toBe(TICKET_CATEGORY_COLORS.privacy);
  });

  it('パネル Embed は有効カテゴリの説明フィールドだけを併記する', () => {
    const embed = buildTicketPanelEmbed(['discord', 'privacy']);
    expect(embed.title).toBe('🎫 問い合わせチケット');
    expect(embed.color).toBeDefined();
    expect(embed.fields?.map((field) => field.name)).toEqual([
      'Discord全般',
      'プライバシー・データ削除',
    ]);
    expect(embed.fields?.every((field) => field.value.length > 0)).toBe(true);
  });

  it('パネル Embed は全カテゴリ有効なら4フィールドになる', () => {
    const embed = buildTicketPanelEmbed(['discord', 'game_server', 'privacy', 'general']);
    expect(embed.fields).toHaveLength(4);
  });

  it('スレッド冒頭 Embed はタイトル=番号+件名、フィールドにカテゴリ・状態・起票者・Webリンクを持つ', () => {
    const embed = buildTicketIntroEmbed({
      ticketId: 'TK-0123456789AB',
      category: 'game_server',
      subject: '接続できません',
      requesterId: '222222222222222222',
      url: 'https://example.test/tickets/TK-0123456789AB',
    });
    expect(embed.title).toBe('🎫 TK-0123456789AB 接続できません');
    expect(embed.color).toBe(TICKET_CATEGORY_COLORS.game_server);
    expect(embed.fields).toEqual([
      { name: 'カテゴリ', value: 'ゲーム・サーバー', inline: true },
      { name: '状態', value: '受理', inline: true },
      { name: '起票者', value: '<@222222222222222222>', inline: true },
      { name: 'Web', value: '[閲覧・返信はこちら](https://example.test/tickets/TK-0123456789AB)' },
    ]);
  });

  it('スレッド冒頭 Embed は URL が無ければ Web フィールドを出さない', () => {
    const embed = buildTicketIntroEmbed({
      ticketId: 'TK-0123456789AB',
      category: 'general',
      subject: '相談',
      requesterId: '222222222222222222',
      url: null,
    });
    expect(embed.fields?.some((field) => field.name === 'Web')).toBe(false);
    expect(embed.fields).toHaveLength(3);
  });

  it('起票の運用通知 Embed はカテゴリ色と件名・スレッドを持つ', () => {
    const embed = buildTicketCreatedEmbed({
      ticketId: 'TK-0123456789AB',
      category: 'privacy',
      subject: '削除について',
      threadId: '444444444444444444',
    });
    expect(embed.title).toBe('🎫 新しいチケット TK-0123456789AB');
    expect(embed.color).toBe(TICKET_CATEGORY_COLORS.privacy);
    expect(embed.fields).toContainEqual({ name: '件名', value: '削除について' });
    expect(embed.fields).toContainEqual({
      name: 'スレッド',
      value: '<#444444444444444444>',
      inline: true,
    });
  });

  it('起票成功 Embed (E3) はチケット番号とスレッドメンションを持つ', () => {
    const embed = buildTicketCreatedSuccessEmbed({
      ticketId: 'TK-0123456789AB',
      category: 'discord',
      threadId: '444444444444444444',
    });
    expect(embed.title).toBe('🎫 チケット TK-0123456789AB を作成しました');
    expect(embed.description).toContain('<#444444444444444444>');
    expect(embed.color).toBe(TICKET_CATEGORY_COLORS.discord);
  });

  it('ボタン結果通知 Embed は3アクションでタイトルと実行者を持つ', () => {
    for (const [action, titlePart] of [
      ['claim', '担当希望'],
      ['close', 'クローズ依頼'],
      ['reopen', '再オープン依頼'],
    ] as const) {
      const embed = buildTicketActionEmbed({
        action,
        actorId: '111111111111111111',
        ticketId: 'TK-0123456789AB',
      });
      expect(embed.title).toContain(titlePart);
      expect(embed.title).toContain('TK-0123456789AB');
      expect(embed.fields).toContainEqual({
        name: '実行者',
        value: '<@111111111111111111>',
        inline: true,
      });
    }
  });

  it('クローズ通知 Embed はアーカイブされる旨を引き継ぐ', () => {
    const embed = buildTicketActionEmbed({
      action: 'close',
      actorId: '111111111111111111',
      ticketId: 'TK-0123456789AB',
    });
    expect(embed.description).toContain('アーカイブされます');
  });
});

describe('受理メッセージ (一次受け)', () => {
  it('確定文面と一致する (worker 側の写しと同一文面であること)', () => {
    expect(TICKET_ACCEPTANCE_MESSAGE).toBe(
      'お問い合わせを受け付けました。担当者が確認のうえ、こちらのスレッドで回答します。内容によっては、回答まで1週間ほどかかる場合があります。恐れ入りますが、しばらくお待ちください。',
    );
  });
});
