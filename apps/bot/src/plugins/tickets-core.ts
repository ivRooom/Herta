import { createHash, createHmac } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import type { Logger } from '@herta/logger';

/**
 * ivrm-web チケット連携 (contracts v1 / Herta #749 S3) の送信モジュール。
 *
 * Discord の起票・スレッド紐付け・返信を ivrm-web apps/api の Herta 連携
 * エンドポイントへ届ける。署名は契約 v1 の現行形式
 * `HMAC(secret, "METHOD\nPATH\ntimestamp\neventId\nbody")` (hex) で、
 * secret は env `HERTA_TICKET_SECRET` (Web 側 SSM `/ivrm/api/herta-ticket-secret`
 * と同値)。未設定なら連携自体を無効とし、起票は fail-closed で案内する。
 *
 * 配送は作成だけが同期的 (ticketId と閲覧 URL がスレッド作成に必要なため) で、
 * 紐付けと返信は outbox (tickets-outbox-repository) 経由の永続配送にする。
 * eventId は sourceEventId から決定的に導出する UUID で、再送でも変わらない。
 */

export const TICKET_CREATE_PATH = '/v1/herta/tickets';
export const TICKET_THREAD_PATH = '/v1/herta/tickets/thread';
export const TICKET_MESSAGES_PATH = '/v1/herta/tickets/messages';
export const TICKET_ATTACHMENTS_PATH = '/v1/herta/tickets/attachments';
export const TICKET_REQUEST_PATHS = {
  create: TICKET_CREATE_PATH,
  thread: TICKET_THREAD_PATH,
  message: TICKET_MESSAGES_PATH,
  attachment: TICKET_ATTACHMENTS_PATH,
} as const;

export type TicketOutboxKind = keyof typeof TICKET_REQUEST_PATHS;

const REQUEST_TIMEOUT_MS = 8_000;

/** 再送の上限回数。これを超えた行は failed として outbox に残す。 */
export const TICKET_MAX_ATTEMPTS = 12;

/** Web 側の検証上限 (契約 v1): 件名 160 字 / 本文 4000 字。 */
export const TICKET_SUBJECT_MAX_LENGTH = 160;
export const TICKET_BODY_MAX_LENGTH = 4000;

export type TicketCategory = 'discord' | 'game_server' | 'privacy' | 'general';

export const TICKET_CATEGORIES: ReadonlyArray<{ value: TicketCategory; label: string }> = [
  { value: 'discord', label: 'Discord全般' },
  { value: 'game_server', label: 'ゲーム・サーバー' },
  { value: 'privacy', label: 'プライバシー・データ削除' },
  { value: 'general', label: 'その他' },
];

export function isTicketCategory(value: unknown): value is TicketCategory {
  return TICKET_CATEGORIES.some((category) => category.value === value);
}

export function ticketCategoryLabel(category: TicketCategory): string {
  return TICKET_CATEGORIES.find((entry) => entry.value === category)?.label ?? 'その他';
}

/**
 * Discord Embed のプレーンオブジェクト表現 (discord.js の APIEmbed 互換)。
 * bot プラグインの送信型 (TicketMessageOptions) と worker poller
 * (ticket-discord-outbox) の embeds はどちらもこの形に揃える。
 */
export interface TicketEmbed {
  title?: string;
  description?: string;
  color?: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: { text: string };
}

/**
 * カテゴリ別の Embed カラー (第2段 E1/E2)。poller 側 Embed はカテゴリを
 * 持たないため色なしだが、タイトル形式 (🎫 + チケット番号) とこの色系統を
 * bot 側の正本として統一する。
 */
export const TICKET_CATEGORY_COLORS: Record<TicketCategory, number> = {
  discord: 0x5865f2,
  game_server: 0x57f287,
  privacy: 0xed4245,
  general: 0xfee75c,
};

/** パネルなどカテゴリに紐付かない Embed の既定色 (Discord blurple)。 */
export const TICKET_EMBED_DEFAULT_COLOR = 0x5865f2;

export function ticketCategoryColor(category: TicketCategory): number {
  return TICKET_CATEGORY_COLORS[category];
}

/** パネルに併記するカテゴリ説明 (どんな時に使うか)。 */
export const TICKET_CATEGORY_DESCRIPTIONS: Record<TicketCategory, string> = {
  discord: 'Bot・コマンドの不具合、Discord サーバーの使い方など',
  game_server: 'ゲームサーバーへの接続・障害、参加申請など',
  privacy: '個人情報の開示・削除の請求など',
  general: 'どのカテゴリにも当てはまらない相談',
};

export function ticketCategoryDescription(category: TicketCategory): string {
  return TICKET_CATEGORY_DESCRIPTIONS[category];
}

/** 起票直後の状態ラベル (Web 側の初期状態 received に対応)。 */
export const TICKET_INITIAL_STATUS_LABEL = '受理';

/** パネル Embed。カテゴリごとの説明をフィールドに併記する (E1)。 */
export function buildTicketPanelEmbed(enabledCategories: readonly TicketCategory[]): TicketEmbed {
  return {
    title: '🎫 問い合わせチケット',
    description:
      '運営への問い合わせは、下のボタンからカテゴリを選んで作成できます。\n作成すると、あなたと運営だけが見られる非公開スレッドでやり取りが始まります。',
    color: TICKET_EMBED_DEFAULT_COLOR,
    fields: enabledCategories.map((category) => ({
      name: ticketCategoryLabel(category),
      value: ticketCategoryDescription(category),
    })),
  };
}

/** スレッド冒頭サマリ Embed (E1)。タイトルは poller と同じく 🎫 + 番号 + 件名。 */
export function buildTicketIntroEmbed(input: {
  ticketId: string;
  category: TicketCategory;
  subject: string;
  requesterId: string;
  url: string | null;
}): TicketEmbed {
  return {
    title: `🎫 ${input.ticketId} ${input.subject}`,
    description: 'このスレッド内のメッセージは Web のチケットにも反映されます。',
    color: ticketCategoryColor(input.category),
    fields: [
      { name: 'カテゴリ', value: ticketCategoryLabel(input.category), inline: true },
      { name: '状態', value: TICKET_INITIAL_STATUS_LABEL, inline: true },
      { name: '起票者', value: `<@${input.requesterId}>`, inline: true },
      ...(input.url ? [{ name: 'Web', value: `[閲覧・返信はこちら](${input.url})` }] : []),
    ],
  };
}

/** 起票の運用通知 Embed (E1)。ロールメンションは content 側に残す。 */
export function buildTicketCreatedEmbed(input: {
  ticketId: string;
  category: TicketCategory;
  subject: string;
  threadId: string;
}): TicketEmbed {
  return {
    title: `🎫 新しいチケット ${input.ticketId}`,
    color: ticketCategoryColor(input.category),
    fields: [
      { name: 'カテゴリ', value: ticketCategoryLabel(input.category), inline: true },
      { name: '件名', value: input.subject },
      { name: 'スレッド', value: `<#${input.threadId}>`, inline: true },
    ],
  };
}

/** 起票成功の Ephemeral 応答 Embed (E3)。他の Ephemeral は平文のまま。 */
export function buildTicketCreatedSuccessEmbed(input: {
  ticketId: string;
  category: TicketCategory;
  threadId: string;
}): TicketEmbed {
  return {
    title: `🎫 チケット ${input.ticketId} を作成しました`,
    description: `スレッド <#${input.threadId}> で運営とやり取りできます。`,
    color: ticketCategoryColor(input.category),
    fields: [
      { name: 'カテゴリ', value: ticketCategoryLabel(input.category), inline: true },
      { name: '状態', value: TICKET_INITIAL_STATUS_LABEL, inline: true },
    ],
  };
}

export type TicketActionKind = 'claim' | 'close' | 'reopen';

const TICKET_ACTION_EMBED_META: Record<
  TicketActionKind,
  { emoji: string; title: string; color: number; note: string }
> = {
  claim: {
    emoji: '🙋',
    title: '担当希望',
    color: 0x57f287,
    note: 'Web側の担当者設定は Admin で行ってください。',
  },
  close: {
    emoji: '🔒',
    title: 'クローズ依頼',
    color: 0xed4245,
    note: 'Web側の状態変更は Admin で行ってください。このスレッドはアーカイブされます（再オープンボタンで戻せます）。',
  },
  reopen: {
    emoji: '🔓',
    title: '再オープン依頼',
    color: 0x5865f2,
    note: 'Web側の状態変更は Admin で行ってください。',
  },
};

/** スレッド内ボタンの結果通知 Embed (E1)。 */
export function buildTicketActionEmbed(input: {
  action: TicketActionKind;
  actorId: string;
  ticketId: string;
}): TicketEmbed {
  const meta = TICKET_ACTION_EMBED_META[input.action];
  return {
    title: `${meta.emoji} ${meta.title}（${input.ticketId}）`,
    description: meta.note,
    color: meta.color,
    fields: [
      { name: 'チケット', value: input.ticketId, inline: true },
      { name: '実行者', value: `<@${input.actorId}>`, inline: true },
    ],
  };
}

export interface TicketsPluginConfig {
  enabled: boolean;
  panelChannelId: string | null;
  staffRoleIds: string[];
  notifyChannelId: string | null;
  notifyStaffOnCreate: boolean;
  enabledCategories: TicketCategory[];
}

const SNOWFLAKE_PATTERN = /^\d+$/;

export function normalizeTicketsConfig(value: unknown): TicketsPluginConfig {
  const source = isRecord(value) ? value : {};
  const categoryFlags: Array<[TicketCategory, unknown, boolean]> = [
    ['discord', source.categoryDiscordEnabled, true],
    ['game_server', source.categoryGameServerEnabled, true],
    ['privacy', source.categoryPrivacyEnabled, true],
    ['general', source.categoryGeneralEnabled, true],
  ];
  return {
    enabled: source.enabled === undefined ? true : source.enabled === true,
    panelChannelId: snowflakeOrNull(source.panelChannelId),
    staffRoleIds: Array.isArray(source.staffRoleIds)
      ? [
          ...new Set(
            source.staffRoleIds.filter(
              (id): id is string => typeof id === 'string' && SNOWFLAKE_PATTERN.test(id),
            ),
          ),
        ].slice(0, 10)
      : [],
    notifyChannelId: snowflakeOrNull(source.notifyChannelId),
    notifyStaffOnCreate:
      source.notifyStaffOnCreate === undefined ? true : source.notifyStaffOnCreate === true,
    enabledCategories: categoryFlags
      .filter(([, flag, fallback]) => (flag === undefined ? fallback : flag === true))
      .map(([category]) => category),
  };
}

export interface TicketBridgeConfig {
  /** ivrm-web apps/api のベースURL (末尾スラッシュなし)。例: https://api.ivrm.jp */
  apiBaseUrl: string;
  /** ivrm-web の `HERTA_TICKET_SECRET` と同じ値を設定する HMAC 共有鍵。 */
  secret: string;
}

/**
 * `IVRM_WEB_API_BASE_URL` と `HERTA_TICKET_SECRET` が両方そろった場合のみ有効。
 * どちらか欠ければ null を返し、起票は fail-closed の案内だけを返す
 * (Web 側も secret 未設定時は 503 で止まる設計で対になっている)。
 */
export function resolveTicketBridgeConfig(
  env: Partial<Record<string, string | undefined>>,
): TicketBridgeConfig | null {
  const rawUrl = env['IVRM_WEB_API_BASE_URL']?.trim();
  const secret = env['HERTA_TICKET_SECRET']?.trim();
  if (!rawUrl || !secret) return null;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' && url.hostname !== 'localhost') return null;
    if (url.username || url.password || url.search || url.hash) return null;
    return { apiBaseUrl: rawUrl.replace(/\/+$/, ''), secret };
  } catch {
    return null;
  }
}

/**
 * sourceEventId から envelope の eventId (UUID) を決定的に導出する。
 * Web 側は X-IVRM-Event-Id に UUID 形式を要求するため、Activity XP emitter と
 * 同じく SHA-256 の先頭16バイトに version 5 / variant ビットを立てる。
 */
export function deriveTicketEventId(sourceEventId: string): string {
  const digest = createHash('sha256').update(`herta-ticket-event:${sourceEventId}`).digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface TicketSignedRequest {
  url: string;
  init: { method: 'POST'; headers: Record<string, string>; body: string };
}

/** 契約 v1 の canonical 文字列で署名する。ネットワークI/Oを含まない。 */
export function buildTicketRequest(
  config: TicketBridgeConfig,
  path: string,
  eventId: string,
  body: string,
  timestamp: string,
): TicketSignedRequest {
  const signature = createHmac('sha256', config.secret)
    .update(['POST', path, timestamp, eventId, body].join('\n'))
    .digest('hex');
  return {
    url: `${config.apiBaseUrl}${path}`,
    init: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-IVRM-Timestamp': timestamp,
        'X-IVRM-Event-Id': eventId,
        'X-IVRM-Signature': signature,
      },
      body,
    },
  };
}

export interface TicketCreatePayload {
  sourceEventId: string;
  eventId: string;
  body: string;
}

/**
 * 起票 body を作る。キーは契約 v1 の create-request の範囲だけにし、
 * 契約に無いフィールドは足さない。channel/thread は起票時点では未確定のため
 * 送らず、作成後の /thread で紐付ける。
 */
export function buildTicketCreatePayload(input: {
  /** モーダル送信インタラクションのID。起票ごとに一意で、冪等キーの種にする。 */
  submissionId: string;
  discordUserId: string;
  requesterName?: string | null;
  category: TicketCategory;
  subject: string;
  body: string;
}): TicketCreatePayload {
  const sourceEventId = `ticket-create:${input.submissionId}`;
  const body = JSON.stringify({
    discordUserId: input.discordUserId,
    ...(input.requesterName ? { requesterName: input.requesterName } : {}),
    category: input.category,
    subject: input.subject,
    body: input.body,
  });
  return { sourceEventId, eventId: deriveTicketEventId(sourceEventId), body };
}

export interface TicketOutboxPayload {
  sourceEventId: string;
  eventId: string;
  kind: TicketOutboxKind;
  ticketId: string;
  body: string;
}

/** スレッド紐付け (/thread) の outbox payload。Discord メッセージIDが冪等キー。 */
export function buildTicketThreadPayload(input: {
  ticketId: string;
  discordChannelId: string;
  discordThreadId: string;
}): TicketOutboxPayload {
  const sourceEventId = `ticket-thread:${input.ticketId}:${input.discordThreadId}`;
  const body = JSON.stringify({
    ticketId: input.ticketId,
    discordChannelId: input.discordChannelId,
    discordThreadId: input.discordThreadId,
  });
  return {
    sourceEventId,
    eventId: deriveTicketEventId(sourceEventId),
    kind: 'thread',
    ticketId: input.ticketId,
    body,
  };
}

/**
 * 返信取込 (/messages) の outbox payload。Discord メッセージIDが冪等キー。
 * 契約 v1 の message-request に authorKind は無い (サーバー側がチケット正本
 * から導出する) ため、Herta 側の申告フィールドは一切足さない。
 */
export function buildTicketMessagePayload(input: {
  ticketId: string;
  authorDiscordUserId: string;
  discordMessageId: string;
  body: string;
}): TicketOutboxPayload {
  const sourceEventId = `ticket-msg:${input.discordMessageId}`;
  const body = JSON.stringify({
    ticketId: input.ticketId,
    authorDiscordUserId: input.authorDiscordUserId,
    discordMessageId: input.discordMessageId,
    body: input.body,
  });
  return {
    sourceEventId,
    eventId: deriveTicketEventId(sourceEventId),
    kind: 'message',
    ticketId: input.ticketId,
    body,
  };
}

export interface TicketAttachmentRef {
  /** Discord 添付 ID。冪等キーの一意化に使う (無い場合は内容ハッシュで代替する)。 */
  id?: string | null;
  name: string;
  url: string;
  /** Discord が申告するバイト数 (無い場合は null)。実体の上限判定はダウンロード後に再確認する。 */
  size?: number | null;
  contentType?: string | null;
}

/**
 * 本文末尾への付記。第2段 (b) からは CDN URL を記録しない (署名付きで
 * 失効するため)。転送できなかった添付だけ、理由付きの注記を付ける。
 * 本文は契約上限 (4000字) を超えないよう切り詰めるが、注記が脱落すると
 * 「添付が届いていない理由」が Web 側から消えるため、注記分を先に
 * 予約して本文側を詰める。
 */
export function buildTicketMessageBody(content: string, notes: readonly string[]): string {
  const suffix = notes.length > 0 ? notes.map((note) => `\n${note}`).join('') : '';
  const base = content.trim();
  const combined = `${base}${suffix}`;
  if (combined.length <= TICKET_BODY_MAX_LENGTH) return combined;
  if (suffix.length >= TICKET_BODY_MAX_LENGTH) {
    // 注記だけで上限を超える場合 (通常は到達しない) は注記側を切り詰める。
    return `${suffix.slice(0, TICKET_BODY_MAX_LENGTH - 1)}…`;
  }
  const baseLimit = TICKET_BODY_MAX_LENGTH - suffix.length;
  return `${base.slice(0, baseLimit - 1)}…${suffix}`;
}

// --- 添付ファイル転送 (第2段 (b) / Herta #1013) -------------------------------
//
// Discord CDN の URL は署名付きで失効するため、参照ではなく取込時点で
// 実体をダウンロードし、署名付き upload エンドポイントへ outbox 経由で
// 転送する。上限と形式判定は Web 側 (ivrm-web #1883) と同じ: 25MB/ファイル、
// 10件/メッセージ、形式はマジックバイトで判定する (ここでは転送可否の
// 事前判定のみで、正本の判定は API 側が同じ規則で再実施する)。

/** 添付1件の上限バイト数 (Web 側のハードリミットと同値)。 */
export const TICKET_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
/** 1メッセージあたりの転送上限件数。 */
export const TICKET_ATTACHMENT_MAX_FILES = 10;
/**
 * 1メッセージあたりの添付合計バイト数の上限。payload は base64 化して
 * outbox へ原子的に積むため、転送対象の実体を全てメモリに保持する。
 * 1件上限 (25MiB) × 10件をそのまま許すと1メッセージで約333MiB の
 * base64 を保持しかねないため、合計は 50MiB (= 1件上限の2件分) で
 * 頭打ちにする。実像の添付はスクリーンショット数枚程度であり、50MiB
 * あれば通常の利用では不足しない。
 */
export const TICKET_ATTACHMENT_MESSAGE_MAX_BYTES = 50 * 1024 * 1024;
/**
 * 添付取込 (ダウンロード〜payload 化) の同時実行数の上限。同時取込が
 * 保持する base64 は最大で 本数 × TICKET_ATTACHMENT_MESSAGE_MAX_BYTES
 * 分に bound される (2本なら約133MiB)。
 */
export const TICKET_ATTACHMENT_DOWNLOAD_CONCURRENCY = 2;

export type TicketAttachmentSkipReason =
  'too_large' | 'message_too_large' | 'too_many' | 'unsupported_format' | 'download_failed';

export interface TicketAttachmentPlan {
  transfer: TicketAttachmentRef[];
  skipped: Array<{ name: string; reason: TicketAttachmentSkipReason }>;
}

/**
 * 転送計画: 件数と申告サイズだけで決まる振り分け。形式と実サイズは
 * ダウンロード後に再判定する (申告サイズが無い添付もここでは通す)。
 * 申告サイズが分かる範囲では、1メッセージ合計の上限を超える分も
 * ここで落とす (無駄なダウンロード自体を避けるため)。実サイズでの
 * 最終判定は TicketAttachmentByteBudget がダウンロード後に行う。
 */
export function planTicketAttachmentTransfers(
  attachments: readonly TicketAttachmentRef[],
): TicketAttachmentPlan {
  const transfer: TicketAttachmentRef[] = [];
  const skipped: TicketAttachmentPlan['skipped'] = [];
  let declaredTotalBytes = 0;
  attachments.forEach((file, index) => {
    if (index >= TICKET_ATTACHMENT_MAX_FILES) {
      skipped.push({ name: file.name, reason: 'too_many' });
    } else if (typeof file.size === 'number' && file.size > TICKET_ATTACHMENT_MAX_BYTES) {
      skipped.push({ name: file.name, reason: 'too_large' });
    } else if (
      typeof file.size === 'number' &&
      declaredTotalBytes + file.size > TICKET_ATTACHMENT_MESSAGE_MAX_BYTES
    ) {
      skipped.push({ name: file.name, reason: 'message_too_large' });
    } else {
      if (typeof file.size === 'number') declaredTotalBytes += file.size;
      transfer.push(file);
    }
  });
  return { transfer, skipped };
}

/**
 * 1メッセージ分の添付実体の保持量を数える予算。申告サイズは信用でき
 * ないため、ダウンロードした実バイト数で予約し、合計上限を超える分は
 * payload 化せずスキップ注記に回す (原子的な enqueue 自体は維持する)。
 */
export class TicketAttachmentByteBudget {
  private usedBytes = 0;

  constructor(private readonly limitBytes: number = TICKET_ATTACHMENT_MESSAGE_MAX_BYTES) {}

  /** 予約できたら true。できなければ何も記録せず false。 */
  tryReserve(bytes: number): boolean {
    if (this.usedBytes + bytes > this.limitBytes) return false;
    this.usedBytes += bytes;
    return true;
  }
}

/**
 * 非同期タスクの同時実行数を制限するセマフォ。添付取込は実体をメモリ
 * に保持するため、メッセージイベントが重なっても保持量が際限なく
 * 増えないよう本数で bound する。待機側は実体をまだ持たない。
 */
export class TicketAttachmentIntakeLimiter {
  private activeCount = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly maxConcurrent: number = TICKET_ATTACHMENT_DOWNLOAD_CONCURRENCY) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.activeCount < this.maxConcurrent) {
      this.activeCount += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(() => {
        this.activeCount += 1;
        resolve();
      });
    });
  }

  private release(): void {
    this.activeCount -= 1;
    const next = this.waiters.shift();
    if (next) next();
  }
}

function asciiAt(bytes: Uint8Array, offset: number, text: string): boolean {
  if (bytes.length < offset + text.length) return false;
  for (let i = 0; i < text.length; i += 1) {
    if (bytes[offset + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

function startsWithBytes(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.length < prefix.length) return false;
  return prefix.every((byte, index) => bytes[index] === byte);
}

const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_HEADER_SIGNATURE = 0x04034b50;

interface ZipCentralDirectoryEntry {
  name: string;
  /** 圧縮方式 (0 = 無圧縮 / 8 = deflate)。 */
  method: number;
  compressedSize: number;
  localHeaderOffset: number;
}

/**
 * ZIP の中央ディレクトリ (末尾側) を読み、エントリのメタデータを返す。
 * 走査範囲は EOCD が宣言する中央ディレクトリの実範囲 (オフセット +
 * サイズ) とエントリ総数で bound する。件数に固定上限を置くと、主
 * パートが後方にある正当な Office 文書 (多数の埋め込みメディア等) を
 * 取りこぼすため、上限は範囲側で担保する。ローカルヘッダの並び順や
 * 格納位置に依存しないため、大きなメディアを前方に格納した文書でも
 * 主パートに届く。EOCD が見つからない・範囲が実データを超える・構造
 * が壊れている場合は null (判定側は対象外に倒す)。
 */
function readZipCentralDirectory(bytes: Uint8Array): ZipCentralDirectoryEntry[] | null {
  if (bytes.length < 22) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // EOCD は末尾から最大で (コメント上限 64KiB + 固定長 22 バイト) の範囲にある。
  const searchFloor = Math.max(0, bytes.length - (65_536 + 22));
  let eocdOffset = -1;
  for (let offset = bytes.length - 22; offset >= searchFloor; offset -= 1) {
    if (view.getUint32(offset, true) === ZIP_EOCD_SIGNATURE) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) return null;
  const entryCount = view.getUint16(eocdOffset + 10, true);
  const directorySize = view.getUint32(eocdOffset + 12, true);
  const directoryOffset = view.getUint32(eocdOffset + 16, true);
  if (directoryOffset > bytes.length || directorySize > bytes.length - directoryOffset) {
    return null;
  }
  const directoryEnd = directoryOffset + directorySize;
  const entries: ZipCentralDirectoryEntry[] = [];
  let offset = directoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > directoryEnd) break;
    if (view.getUint32(offset, true) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) break;
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const nameStart = offset + 46;
    const recordEnd = nameStart + nameLength + extraLength + commentLength;
    if (recordEnd > directoryEnd) break;
    entries.push({
      name: Buffer.from(bytes.subarray(nameStart, nameStart + nameLength)).toString('utf8'),
      method: view.getUint16(offset + 10, true),
      compressedSize: view.getUint32(offset + 20, true),
      localHeaderOffset: view.getUint32(offset + 42, true),
    });
    offset = recordEnd;
  }
  return entries;
}

/** [Content_Types].xml の展開後サイズの上限 (パッケージメタデータは小さい)。 */
const ZIP_CONTENT_TYPES_MAX_BYTES = 1024 * 1024;

/**
 * 中央ディレクトリのメタデータから1エントリの実データを取り出す。
 * 対応する圧縮方式は無圧縮と deflate のみで、それ以外・範囲外・展開
 * 失敗は null。展開サイズには上限を置き、zip 爆弾を避ける。
 */
function readZipEntryData(
  bytes: Uint8Array,
  entries: readonly ZipCentralDirectoryEntry[],
  targetName: string,
): Uint8Array | null {
  const entry = entries.find((candidate) => candidate.name === targetName);
  if (!entry) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const localOffset = entry.localHeaderOffset;
  if (localOffset + 30 > bytes.length) return null;
  if (view.getUint32(localOffset, true) !== ZIP_LOCAL_HEADER_SIGNATURE) return null;
  const nameLength = view.getUint16(localOffset + 26, true);
  const extraLength = view.getUint16(localOffset + 28, true);
  const dataStart = localOffset + 30 + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > bytes.length) return null;
  const raw = bytes.subarray(dataStart, dataEnd);
  if (entry.method === 0) return raw;
  if (entry.method === 8) {
    try {
      return new Uint8Array(inflateRawSync(raw, { maxOutputLength: ZIP_CONTENT_TYPES_MAX_BYTES }));
    } catch {
      return null;
    }
  }
  return null;
}

/** Office (OOXML) の主パート。これらがパッケージの主文書として宣言されているかを見る。 */
const OFFICE_MAIN_PART_NAMES = ['word/document.xml', 'xl/workbook.xml', 'ppt/presentation.xml'];

/**
 * ZIP が Office (OOXML) パッケージかどうかを判定する。主パートの
 * エントリ名が存在するだけでは、展開したファイルを寄せ集めた通常の
 * ZIP と区別できないため、パッケージの正本メタデータである
 * [Content_Types].xml が実在し、その主パートを Override として宣言
 * していることまで確認する。最終的な正本判定は Web API 側が担う。
 */
function isOfficeOpenXmlPackage(bytes: Uint8Array): boolean {
  const entries = readZipCentralDirectory(bytes);
  if (!entries) return false;
  const mainPart = OFFICE_MAIN_PART_NAMES.find((name) =>
    entries.some((entry) => entry.name === name),
  );
  if (!mainPart) return false;
  const contentTypes = readZipEntryData(bytes, entries, '[Content_Types].xml');
  if (!contentTypes) return false;
  const text = new TextDecoder('utf-8').decode(contentTypes);
  return text.includes(`PartName="/${mainPart}"`);
}

/**
 * UTF-8 妥当性判定。先頭サンプルだけを fatal デコードすると、サンプル
 * 境界で分断されたマルチバイト文字を不正と誤判定するため、デコーダの
 * 状態を保持したまま全量を流し込み、実終端でのみ flush する。
 */
function isValidUtf8(bytes: Uint8Array): boolean {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const CHUNK_BYTES = 8192;
  try {
    for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
      decoder.decode(bytes.subarray(offset, Math.min(offset + CHUNK_BYTES, bytes.length)), {
        stream: true,
      });
    }
    decoder.decode();
    return true;
  } catch {
    return false;
  }
}

/**
 * 転送対象形式のマジックバイト判定 (API 側の正本判定と同じ対象範囲:
 * 画像 / PDF / Office (docx/xlsx/pptx) / テキスト / 音声 / 動画)。
 * 実行ファイル・通常の zip 等は対象外として false を返す。
 */
export function hasSupportedTicketAttachmentMagic(bytes: Uint8Array): boolean {
  if (asciiAt(bytes, 0, '%PDF-')) return true;
  if (startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return true;
  if (startsWithBytes(bytes, [0xff, 0xd8, 0xff])) return true;
  if (asciiAt(bytes, 0, 'GIF87a') || asciiAt(bytes, 0, 'GIF89a')) return true;
  if (asciiAt(bytes, 0, 'RIFF') && asciiAt(bytes, 8, 'WEBP')) return true;
  if (asciiAt(bytes, 4, 'ftyp')) return true;
  if (startsWithBytes(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return true;
  if (asciiAt(bytes, 0, 'RIFF') && asciiAt(bytes, 8, 'WAVE')) return true;
  if (asciiAt(bytes, 0, 'OggS')) return true;
  if (asciiAt(bytes, 0, 'fLaC')) return true;
  if (asciiAt(bytes, 0, 'ID3')) return true;
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0) return true;
  if (startsWithBytes(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    // zip そのものは対象外。Office (OOXML) パッケージだけを通す。
    // 主パートの有無は中央ディレクトリから引き、パッケージの
    // メタデータ ([Content_Types].xml の Override 宣言) まで確認する。
    return isOfficeOpenXmlPackage(bytes);
  }
  if (
    asciiAt(bytes, 0, 'MZ') ||
    startsWithBytes(bytes, [0x7f, 0x45, 0x4c, 0x46]) ||
    asciiAt(bytes, 0, '#!')
  ) {
    return false;
  }
  // テキスト (UTF-8 として読め、制御文字がほぼ無いもの) は対象。
  const sample = bytes.subarray(0, 8192);
  if (sample.includes(0)) return false;
  return isValidUtf8(bytes);
}

/** 転送できなかった添付をメッセージ本文へ残す注記 (捏造しない: 理由をそのまま書く)。 */
export function buildTicketAttachmentSkipNote(
  name: string,
  reason: TicketAttachmentSkipReason,
): string {
  switch (reason) {
    case 'too_large':
      return `[添付] ${name}（25MBを超えるため Web へ転送されませんでした）`;
    case 'message_too_large':
      return `[添付] ${name}（1メッセージの添付合計が上限（50MB）を超えるため Web へ転送されませんでした）`;
    case 'too_many':
      return `[添付] ${name}（1メッセージ10件を超えるため Web へ転送されませんでした）`;
    case 'unsupported_format':
      return `[添付] ${name}（対応していない形式のため Web へ転送されませんでした）`;
    case 'download_failed':
      return `[添付] ${name}（取得に失敗したため Web へ転送されませんでした）`;
  }
}

/**
 * ダウンロード結果。サイズ超過は取得失敗と区別する (注記で理由が
 * 変わるため)。download_failed は通信・読み取りの失敗専用。
 */
export type TicketAttachmentDownloadResult =
  { ok: true; bytes: Uint8Array } | { ok: false; reason: 'too_large' | 'download_failed' };

/** 読まない応答の body を解放する (接続リソースを保持し続けないため)。 */
async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // 解放の失敗は無視する (結果は既に決まっている)。
  }
}

/**
 * CDN から実体を取得する。転送は取込時点の一度きりで、URL はどこにも
 * 保存しない。読まずに破棄する応答は body を cancel してから返す。
 */
export async function downloadTicketAttachment(
  file: TicketAttachmentRef,
  fetchImpl: typeof fetch = fetch,
): Promise<TicketAttachmentDownloadResult> {
  let response: Response;
  try {
    response = await fetchImpl(file.url, {
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return { ok: false, reason: 'download_failed' };
  }
  if (!response.ok) {
    await cancelResponseBody(response);
    return { ok: false, reason: 'download_failed' };
  }
  const declared = Number(response.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > TICKET_ATTACHMENT_MAX_BYTES) {
    await cancelResponseBody(response);
    return { ok: false, reason: 'too_large' };
  }
  // Content-Length が無い応答でも上限を守るため、読みながら累積バイト数を
  // 数え、超過した時点で読み取りを中断する (全量取得後の判定では、超過分
  // の帯域とバッファを消費してしまい上限の意味がない)。
  const reader = response.body?.getReader();
  if (!reader) {
    const buffer = await response.arrayBuffer().catch(() => null);
    if (!buffer || buffer.byteLength === 0) return { ok: false, reason: 'download_failed' };
    if (buffer.byteLength > TICKET_ATTACHMENT_MAX_BYTES) {
      return { ok: false, reason: 'too_large' };
    }
    return { ok: true, bytes: new Uint8Array(buffer) };
  }
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    let done = false;
    while (!done) {
      const chunk = await reader.read();
      done = chunk.done;
      if (chunk.value) {
        totalBytes += chunk.value.byteLength;
        if (totalBytes > TICKET_ATTACHMENT_MAX_BYTES) {
          await reader.cancel().catch(() => undefined);
          return { ok: false, reason: 'too_large' };
        }
        chunks.push(chunk.value);
      }
    }
  } catch {
    return { ok: false, reason: 'download_failed' };
  }
  if (totalBytes === 0) return { ok: false, reason: 'download_failed' };
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

/**
 * 添付 upload (/v1/herta/tickets/attachments) の outbox payload。
 * sourceEventId はメッセージIDと Discord 添付 ID から決定的にし、同じ
 * 添付の再観測では同じ eventId (= Web 側の冪等キー) になる。内容ハッシュ
 * だけだと、同一メッセージ内の同一バイト添付 (別ファイル) が同じキーに
 * 衝突して1件脱落するため、添付 ID を必ず含める。添付 ID が無い場合のみ
 * 内容ハッシュで代替する。なお sourceEventId は Herta 内の outbox 一意
 * キー専用で、Web 側へ送られる Event-Id は deriveTicketEventId が常に
 * UUID 形式へ導出するため、この形式変更は Web 側の検証に触れない。
 * 転送形式は base64 JSON: 署名が body 全体の HMAC のため、multipart の
 * ような正規形の無い形式は契約 v1 の署名方式と整合しない。
 */
export function buildTicketAttachmentPayload(input: {
  ticketId: string;
  discordMessageId: string;
  attachmentId?: string | null;
  fileName: string;
  contentType?: string | null;
  bytes: Uint8Array;
}): TicketOutboxPayload {
  const digest = createHash('sha256').update(input.bytes).digest('hex').slice(0, 16);
  const sourceEventId = input.attachmentId
    ? `ticket-attach:${input.discordMessageId}:${input.attachmentId}`
    : `ticket-attach:${input.discordMessageId}:${digest}`;
  const body = JSON.stringify({
    ticketId: input.ticketId,
    discordMessageId: input.discordMessageId,
    fileName: input.fileName,
    ...(input.contentType ? { contentType: input.contentType } : {}),
    contentBase64: Buffer.from(input.bytes).toString('base64'),
  });
  return {
    sourceEventId,
    eventId: deriveTicketEventId(sourceEventId),
    kind: 'attachment',
    ticketId: input.ticketId,
    body,
  };
}

export type TicketDeliveryOutcome = 'sent' | 'dropped' | 'auth_failure' | 'retryable';

/**
 * Web 側応答の分類。
 * - 201 (created) / 200 (idempotent replay・duplicate) → 送信完了
 * - 401 は署名不整合 = 設定異常なので送信を止めて明示する
 * - 403 は messages 経路の actor 判定 (依頼者でも担当者でもない投稿者) など
 *   その行限りの恒久拒否として破棄する (行を残して理由を記録)
 * - 409 / 422 も恒久扱いで破棄。それ以外 (5xx・404等) とネットワーク失敗は再送
 */
export function classifyTicketResponse(status: number): TicketDeliveryOutcome {
  if (status === 200 || status === 201) return 'sent';
  if (status === 401) return 'auth_failure';
  if (status === 403 || status === 409 || status === 413 || status === 422) return 'dropped';
  return 'retryable';
}

/** 再送までの指数バックオフ (30秒から倍増、上限1時間)。Activity XP と同じ形。 */
export function ticketRetryDelayMs(attempts: number): number {
  const exponent = Math.min(Math.max(attempts - 1, 0), 10);
  return Math.min(30_000 * 2 ** exponent, 60 * 60 * 1000);
}

export interface TicketCreateResult {
  ticketId: string;
  created: boolean;
  url: string | null;
}

export type TicketCreateOutcome =
  | { kind: 'created'; result: TicketCreateResult }
  | { kind: 'unavailable' }
  | { kind: 'rejected'; status: number }
  | { kind: 'retryable'; status?: number; error?: string };

/**
 * 起票だけは同期で送る (ticketId と閲覧 URL がスレッド作成に必要なため)。
 * eventId は呼び出し側が決定的に導出したものを渡し、同一送信の再試行では
 * Web 側の冪等 replay (200 / created=false / url=null) が返る。
 */
export async function sendTicketCreate(
  config: TicketBridgeConfig,
  payload: TicketCreatePayload,
  logger: Logger,
): Promise<TicketCreateOutcome> {
  const request = buildTicketRequest(
    config,
    TICKET_CREATE_PATH,
    payload.eventId,
    payload.body,
    new Date().toISOString(),
  );
  let response: Response;
  try {
    response = await fetch(request.url, {
      ...request.init,
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    logger.warn({ err: error, eventId: payload.eventId }, 'チケット作成リクエストに失敗しました');
    return {
      kind: 'retryable',
      error: error instanceof Error ? error.message : String(error),
    };
  }
  if (response.status === 503) return { kind: 'unavailable' };
  if (response.status === 200 || response.status === 201) {
    const parsed = (await response.json().catch(() => null)) as {
      ticketId?: unknown;
      created?: unknown;
      url?: unknown;
    } | null;
    if (!parsed || typeof parsed.ticketId !== 'string') {
      return { kind: 'retryable', status: response.status, error: 'invalid_create_response' };
    }
    return {
      kind: 'created',
      result: {
        ticketId: parsed.ticketId,
        created: parsed.created === true,
        url: typeof parsed.url === 'string' ? parsed.url : null,
      },
    };
  }
  const outcome = classifyTicketResponse(response.status);
  if (outcome === 'dropped' || outcome === 'auth_failure') {
    return { kind: 'rejected', status: response.status };
  }
  return { kind: 'retryable', status: response.status };
}

/**
 * outbox の1行分を送信し、応答分類を返す。例外は投げず、ネットワーク失敗は
 * retryable として扱う (呼び出し側のループを止めないため)。
 */
export async function sendTicketOutboxPayload(
  config: TicketBridgeConfig,
  payload: Pick<TicketOutboxPayload, 'kind' | 'eventId' | 'body'>,
  logger: Logger,
): Promise<{ outcome: TicketDeliveryOutcome; status?: number; error?: string }> {
  const request = buildTicketRequest(
    config,
    TICKET_REQUEST_PATHS[payload.kind],
    payload.eventId,
    payload.body,
    new Date().toISOString(),
  );
  try {
    const response = await fetch(request.url, {
      ...request.init,
      redirect: 'error',
      // 添付 (最大25MBの base64) は通常の契約リクエストより長く見積もる。
      signal: AbortSignal.timeout(payload.kind === 'attachment' ? 120_000 : REQUEST_TIMEOUT_MS),
    });
    return { outcome: classifyTicketResponse(response.status), status: response.status };
  } catch (error) {
    logger.warn({ err: error, eventId: payload.eventId }, 'チケット配送リクエストに失敗しました');
    return {
      outcome: 'retryable',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function snowflakeOrNull(value: unknown): string | null {
  return typeof value === 'string' && SNOWFLAKE_PATTERN.test(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
