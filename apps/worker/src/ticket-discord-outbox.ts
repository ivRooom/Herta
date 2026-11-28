import { createHash, createHmac } from 'node:crypto';
import type { Logger } from '@herta/logger';
import { Pool } from 'pg';

/**
 * チケット Web→Discord 配送 (ivrm-web #823 S4 / 設計 D5)。
 *
 * ivrm-web API が Web 起源の返信・状態変更時に ivrm_services の
 * ticket_discord_outbox へ同一トランザクションで積んだ行をポーリングし、
 * 紐付け済み非公開スレッドへ Discord REST で投稿する。
 *
 * 権限モデル: この Worker はテーブルを直接 UPDATE しない。claim / ack は
 * 全て services 側の SECURITY DEFINER 関数 (claim_ticket_discord_outbox_v1 /
 * ack_ticket_discord_outbox_sent_v1 / ack_ticket_discord_outbox_failed_v1、
 * ivrm-web 0002) 経由で行う。claim が行ロック (SKIP LOCKED) と attempts
 * 加算と可視性リースを担うため、複数 Worker / 次サイクルとの二重 claim は
 * 起きない。
 *
 * at-least-once: 投稿成功と ack の間にクラッシュすると再送され得る。
 * 再送時の二重投稿を避けるため、投稿メッセージの Embed footer に
 * `ticket-outbox:<outboxId>` マーカーを埋め込み、送信前にスレッドの
 * 直近メッセージからマーカーを探す。見つかれば投稿済みとして ack する。
 * 誤認防止のため、照合は Bot 本人 (この Worker の Bot Token のユーザー)
 * の投稿に限定し、マーカーは ID 境界を伴う完全一致でのみ一致させる
 * (`ticket-outbox:7` が `ticket-outbox:70` に一致したりしない)。
 * ただし取得範囲 (直近20件) を超えた再送では検出できない制約がある。
 *
 * 内部メモは Web 側でそもそも outbox に積まれない (S1)。それでも payload に
 * internal が含まれていたら防御として送信せず恒久 failed に倒す。
 *
 * thread_create (ivrm-web #2098 / Herta #1072 の WC-S4): Web 起票された
 * チケットについて、Discord 側に専用スレッドがまだ無い状態から処理する
 * 唯一の kind。guild_plugins の tickets 設定 (Herta DB) から対象 Guild と
 * パネルチャンネルを解決し、非公開スレッドの作成 → 依頼者追加 → intro
 * 投稿 → TicketThreadLink 保存と署名付き /thread での Web リンク → 運用
 * 通知までを担う。冪等性は「スレッド名 (🎫 <TK-…> <件名>) の決定的命名＋
 * 作成前の同名スレッド検索」と「intro への ticket-outbox マーカー埋め込み」
 * 「TicketThreadLink の有無」で担保する (at-least-once の延長)。
 */

const DEFAULT_SCAN_INTERVAL_SECONDS = 60;
const MIN_SCAN_INTERVAL_SECONDS = 15;
const MAX_SCAN_INTERVAL_SECONDS = 600;
const MAX_BATCH_SIZE = 25;
export const TICKET_OUTBOX_MAX_ATTEMPTS = 5;
const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';
const REQUEST_TIMEOUT_MS = 15_000;
const DEDUP_SCAN_LIMIT = 20;
const SNOWFLAKE_PATTERN = /^[0-9]{17,20}$/;
const TICKET_ID_PATTERN = /^TK-[A-F0-9]{12}$/;

export const TICKET_STATUS_LABELS: Record<string, string> = {
  received: '受理',
  approved: '承認',
  in_progress: '確認中',
  on_hold: '保留',
  resolved: '解決',
  closed: '完了',
  rejected: '却下',
};

export type TicketOutboxKind = 'message_added' | 'status_changed' | 'thread_create';

/**
 * チケットカテゴリ4値とラベル・色は bot の tickets-core
 * (apps/bot/src/plugins/tickets-core.ts) が正本。worker からは bot の
 * コードを import できないため、同じ値をここに写す (deriveTicketEventId
 * の写しと同じ流儀)。値を変えるときは両側を揃えること。
 */
export type TicketThreadCreateCategory = 'discord' | 'game_server' | 'privacy' | 'general';

export const TICKET_THREAD_CREATE_CATEGORY_LABELS: Record<TicketThreadCreateCategory, string> = {
  discord: 'Discord全般',
  game_server: 'ゲーム・サーバー',
  privacy: 'プライバシー・データ削除',
  general: 'その他',
};

export const TICKET_THREAD_CREATE_CATEGORY_COLORS: Record<TicketThreadCreateCategory, number> = {
  discord: 0x5865f2,
  game_server: 0x57f287,
  privacy: 0xed4245,
  general: 0xfee75c,
};

function isTicketThreadCreateCategory(value: unknown): value is TicketThreadCreateCategory {
  return (
    value === 'discord' || value === 'game_server' || value === 'privacy' || value === 'general'
  );
}

export interface TicketOutboxRow {
  /** ticket_discord_outbox.id (bigint を文字列で保持) */
  id: string;
  ticketId: string;
  kind: TicketOutboxKind;
  payload: unknown;
  payloadHash: string;
  attempts: number;
}

/** 添付メタ (ivrm-web #1883 の A6 契約)。bytes は含まず、poller が署名付き download から取得する。 */
export interface TicketAttachmentMeta {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  scanStatus: 'pending' | 'clean' | 'infected' | 'error';
}

export interface TicketMessageAddedPayload {
  ticketId: string;
  discordThreadId: string;
  body: string;
  authorKind: 'requester' | 'staff';
  authorDiscordUserId?: string;
  attachments?: TicketAttachmentMeta[];
  attachmentsOnly?: boolean;
}

export interface TicketStatusChangedPayload {
  ticketId: string;
  discordThreadId: string;
  from: string;
  to: string;
}

/**
 * thread_create の payload (WC-S4)。Web 起票 (ivrm-web WC-S2) が積む形式で、
 * スレッド未作成のため discordThreadId は持たない。subject / body の上限は
 * content-schema の起票バリデーション (件名160字・本文4000字) と同じ。
 * url は Web の閲覧 URL (任意。intro Embed の Web フィールドに使う)。
 */
export interface TicketThreadCreatePayload {
  ticketId: string;
  requesterDiscordUserId: string;
  category: TicketThreadCreateCategory;
  subject: string;
  body: string;
  url?: string;
}

export type ParsedTicketPayload =
  | { kind: 'message_added'; payload: TicketMessageAddedPayload }
  | { kind: 'status_changed'; payload: TicketStatusChangedPayload }
  | { kind: 'thread_create'; payload: TicketThreadCreatePayload };

export interface TicketDiscordOutboxStore {
  claim(limit: number, maxAttempts: number): Promise<TicketOutboxRow[]>;
  ackSent(id: string, discordMessageId: string): Promise<void>;
  ackFailed(id: string, error: string, permanent: boolean, maxAttempts: number): Promise<void>;
  close(): Promise<void>;
}

export interface TicketDiscordPollerRuntime {
  scanNow(): Promise<void>;
  close(): Promise<void>;
}

/** Web API からの添付取得用の署名ブリッジ (bot と同じ HERTA_TICKET_SECRET)。未設定なら clean 添付も取得できず、プレースホルダ表示に倒す。 */
export interface TicketAttachmentBridge {
  apiBaseUrl: string;
  /** HMAC 共有鍵 (ivrm-web の HERTA_TICKET_SECRET と同値)。 */
  secret: string;
}

export interface StartTicketDiscordPollerOptions {
  logger: Logger;
  store: TicketDiscordOutboxStore;
  discordBotToken: string;
  scanIntervalSeconds?: number;
  fetchImpl?: typeof fetch;
  attachmentBridge?: TicketAttachmentBridge | null;
  /**
   * thread_create 処理の依存 (WC-S4)。Herta DB (guild_plugins /
   * TicketThreadLink) と /thread 署名ブリッジが揃う場合のみ渡す。
   * 未設定のまま thread_create 行が来たら恒久 failed に倒す (設定不備は
   * 再試行しても直らないため。Admin の再送で復旧できる)。
   */
  threadCreate?: TicketThreadCreateDeps | null;
}

const ATTACHMENT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SCAN_STATUSES = ['pending', 'clean', 'infected', 'error'] as const;

function parseAttachmentMeta(value: unknown): TicketAttachmentMeta[] {
  if (!Array.isArray(value)) return [];
  const metas: TicketAttachmentMeta[] = [];
  for (const entry of value.slice(0, 10)) {
    if (!isRecord(entry)) continue;
    const id = entry['id'];
    const fileName = entry['fileName'];
    const contentType = entry['contentType'];
    const sizeBytes = entry['sizeBytes'];
    const scanStatus = entry['scanStatus'];
    if (typeof id !== 'string' || !ATTACHMENT_ID_PATTERN.test(id)) continue;
    if (typeof fileName !== 'string' || fileName.length < 1 || fileName.length > 200) continue;
    if (typeof contentType !== 'string' || contentType.length < 1) continue;
    if (typeof sizeBytes !== 'number' || sizeBytes <= 0) continue;
    if (
      typeof scanStatus !== 'string' ||
      !(SCAN_STATUSES as readonly string[]).includes(scanStatus)
    ) {
      continue;
    }
    metas.push({
      id,
      fileName,
      contentType,
      sizeBytes,
      scanStatus: scanStatus as TicketAttachmentMeta['scanStatus'],
    });
  }
  return metas;
}

/** clean 以外の添付を Discord へ送る際のプレースホルダ文。実体は絶対に送らない。 */
export function ticketAttachmentPlaceholder(meta: TicketAttachmentMeta): string {
  if (meta.scanStatus === 'infected') {
    return `📎 ${meta.fileName}（ウイルスが検出されたため削除されました）`;
  }
  return `📎 ${meta.fileName}（スキャン中のため表示できません）`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** payload に internal 宣言があるか (内部メモの防御判定)。 */
export function payloadDeclaresInternal(payload: unknown): boolean {
  return isRecord(payload) && payload['internal'] === true;
}

/**
 * outbox payload の検証。S1 が積む形式 (message_added: ticketId /
 * discordThreadId / messageId / authorKind / authorDiscordUserId / body /
 * source、status_changed: ticketId / discordThreadId / from / to /
 * actorDiscordUserId / source) を正とし、スレッド ID は payload 内の
 * discordThreadId を正本とする。thread_create (WC-S4) はスレッド未作成の
 * 起点のため discordThreadId を持たず、依頼者・カテゴリ・件名・本文を
 * 必須とする。不正な payload は null (呼び出し側で恒久 failed)。
 */
export function parseTicketOutboxPayload(
  kind: string,
  payload: unknown,
): ParsedTicketPayload | null {
  if (!isRecord(payload)) return null;
  const ticketId = payload['ticketId'];
  if (typeof ticketId !== 'string' || !TICKET_ID_PATTERN.test(ticketId)) return null;
  if (kind === 'thread_create') {
    const requesterDiscordUserId = payload['requesterDiscordUserId'];
    const category = payload['category'];
    const subject = payload['subject'];
    const body = payload['body'];
    const url = payload['url'];
    if (
      typeof requesterDiscordUserId !== 'string' ||
      !SNOWFLAKE_PATTERN.test(requesterDiscordUserId)
    ) {
      return null;
    }
    if (!isTicketThreadCreateCategory(category)) return null;
    if (typeof subject !== 'string' || subject.length < 1 || subject.length > 160) return null;
    if (typeof body !== 'string' || body.length < 1 || body.length > 4000) return null;
    if (
      url !== undefined &&
      (typeof url !== 'string' || url.length > 1000 || !url.startsWith('https://'))
    ) {
      return null;
    }
    return {
      kind,
      payload: {
        ticketId,
        requesterDiscordUserId,
        category,
        subject,
        body,
        ...(typeof url === 'string' ? { url } : {}),
      },
    };
  }
  const discordThreadId = payload['discordThreadId'];
  if (typeof discordThreadId !== 'string' || !SNOWFLAKE_PATTERN.test(discordThreadId)) {
    return null;
  }
  if (kind === 'message_added') {
    const body = payload['body'];
    const authorKind = payload['authorKind'];
    if (typeof body !== 'string' || body.length < 1 || body.length > 4000) return null;
    if (authorKind !== 'requester' && authorKind !== 'staff') return null;
    const authorDiscordUserId = payload['authorDiscordUserId'];
    const attachments = parseAttachmentMeta(payload['attachments']);
    return {
      kind,
      payload: {
        ticketId,
        discordThreadId,
        body,
        authorKind,
        ...(typeof authorDiscordUserId === 'string' && SNOWFLAKE_PATTERN.test(authorDiscordUserId)
          ? { authorDiscordUserId }
          : {}),
        ...(attachments.length > 0 ? { attachments } : {}),
        ...(payload['attachmentsOnly'] === true ? { attachmentsOnly: true } : {}),
      },
    };
  }
  if (kind === 'status_changed') {
    const from = payload['from'];
    const to = payload['to'];
    if (typeof from !== 'string' || !(from in TICKET_STATUS_LABELS)) return null;
    if (typeof to !== 'string' || !(to in TICKET_STATUS_LABELS)) return null;
    return { kind, payload: { ticketId, discordThreadId, from, to } };
  }
  return null;
}

/** 二重投稿検出用のマーカー。Embed footer に埋め込む。 */
export function ticketOutboxMarker(outboxId: string): string {
  return `ticket-outbox:${outboxId}`;
}

export interface DiscordMessageBody {
  content?: string;
  embeds: Array<Record<string, unknown>>;
  components?: Array<Record<string, unknown>>;
  allowed_mentions: { parse: never[]; users?: string[]; roles?: string[] };
}

/** 配送メッセージの文面生成。メンションは一切許可しない。 */
export function buildTicketDiscordMessage(
  outboxId: string,
  parsed: ParsedTicketPayload,
  placeholderLines: readonly string[] = [],
): DiscordMessageBody {
  const marker = ticketOutboxMarker(outboxId);
  if (parsed.kind === 'message_added') {
    const { payload } = parsed;
    const authorLabel = payload.authorKind === 'staff' ? '運営' : '依頼者';
    // Embed 上限 (4096字) の切り詰めで添付プレースホルダが脱落すると、
    // ファイルが届いていない理由が読めなくなる。プレースホルダ分を
    // 先に予約し、本文側を詰める (短い本文は従来どおりそのまま)。
    const placeholderSuffix = placeholderLines.length > 0 ? `\n${placeholderLines.join('\n')}` : '';
    const description =
      placeholderSuffix.length >= 4096
        ? placeholderSuffix.slice(0, 4096)
        : `${payload.body.slice(0, 4096 - placeholderSuffix.length)}${placeholderSuffix}`;
    return {
      embeds: [
        {
          title: `🎫 ${payload.ticketId} への返信（${authorLabel}・Web）`,
          description,
          footer: { text: marker },
        },
      ],
      allowed_mentions: { parse: [] },
    };
  }
  if (parsed.kind !== 'status_changed') {
    // thread_create は専用ビルダー (buildTicketThreadIntroMessage) を使うため、
    // この汎用ビルダーには来ない (deliverRow で分岐済み)。
    throw new Error('ticket_message_kind_not_supported');
  }
  const { payload } = parsed;
  const fromLabel = TICKET_STATUS_LABELS[payload.from] ?? payload.from;
  const toLabel = TICKET_STATUS_LABELS[payload.to] ?? payload.to;
  return {
    embeds: [
      {
        title: `🎫 ${payload.ticketId} の状態変更`,
        description: `状態が「${fromLabel}」から「${toLabel}」に変更されました。`,
        footer: { text: marker },
      },
    ],
    allowed_mentions: { parse: [] },
  };
}

/** スレッド名の決定的命名 (bot の threads.create と同じ形式)。再送時の同名検索のキーになる。 */
export function ticketThreadName(payload: TicketThreadCreatePayload): string {
  return `🎫 ${payload.ticketId} ${payload.subject}`.slice(0, 100);
}

/**
 * 既存スレッド群 (Guild の active threads) から、このチケット用に作られた
 * スレッドを探す。チケット番号は固定長で一意なため、前方一致で誤認しない。
 */
export function findTicketThreadByName(
  threads: unknown,
  channelId: string,
  ticketId: string,
): string | null {
  if (!Array.isArray(threads)) return null;
  const prefix = `🎫 ${ticketId} `;
  const exact = `🎫 ${ticketId}`;
  for (const thread of threads) {
    if (!isRecord(thread)) continue;
    const id = thread['id'];
    const name = thread['name'];
    if (typeof id !== 'string' || !SNOWFLAKE_PATTERN.test(id)) continue;
    if (thread['parent_id'] !== channelId) continue;
    if (typeof name !== 'string') continue;
    if (name === exact || name.startsWith(prefix)) return id;
  }
  return null;
}

/**
 * thread_create の intro 投稿。bot の buildTicketIntroMessage
 * (tickets-core の buildTicketIntroEmbed＋ボタン3点) と同一形式に揃え、
 * 起票本文は2つ目の Embed で運ぶ (Web 起票では本文が Discord 側に無いため)。
 * 本文 Embed の footer に ticket-outbox マーカーを埋め込み、再送時に
 * findDeliveredMessageId で intro 済みを検出できるようにする。
 * ボタンの custom_id は bot と一致させる (押下は bot 側ハンドラが受ける)。
 */
export function buildTicketThreadIntroMessage(
  outboxId: string,
  payload: TicketThreadCreatePayload,
): DiscordMessageBody {
  const color = TICKET_THREAD_CREATE_CATEGORY_COLORS[payload.category];
  return {
    embeds: [
      {
        title: `🎫 ${payload.ticketId} ${payload.subject}`,
        description: 'このスレッド内のメッセージは Web のチケットにも反映されます。',
        color,
        fields: [
          {
            name: 'カテゴリ',
            value: TICKET_THREAD_CREATE_CATEGORY_LABELS[payload.category],
            inline: true,
          },
          { name: '状態', value: TICKET_STATUS_LABELS['received'] ?? '受理', inline: true },
          { name: '起票者', value: `<@${payload.requesterDiscordUserId}>`, inline: true },
          ...(payload.url ? [{ name: 'Web', value: `[閲覧・返信はこちら](${payload.url})` }] : []),
        ],
      },
      {
        description: payload.body.slice(0, 4096),
        color,
        footer: { text: ticketOutboxMarker(outboxId) },
      },
    ],
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 1,
            custom_id: 'herta:tickets:v1:action:claim',
            label: '担当する',
          },
          {
            type: 2,
            style: 2,
            custom_id: 'herta:tickets:v1:action:close',
            label: 'クローズ',
          },
          {
            type: 2,
            style: 2,
            custom_id: 'herta:tickets:v1:action:reopen',
            label: '再オープン',
          },
        ],
      },
    ],
    allowed_mentions: { parse: [], users: [payload.requesterDiscordUserId] },
  };
}

/**
 * thread_create の運用通知。bot の notifyTicketCreated と同じ形
 * (Embed は buildTicketCreatedEmbed 相当、ロールメンションは Embed では
 * 発火しないため content 側に残す)。
 */
export function buildTicketThreadCreatedNotification(
  payload: TicketThreadCreatePayload,
  threadId: string,
  config: Pick<TicketThreadCreateGuildConfig, 'notifyStaffOnCreate' | 'staffRoleIds'>,
): DiscordMessageBody {
  const mentionRoles =
    config.notifyStaffOnCreate && config.staffRoleIds.length > 0 ? config.staffRoleIds : [];
  return {
    ...(mentionRoles.length > 0
      ? { content: mentionRoles.map((roleId) => `<@&${roleId}>`).join(' ') }
      : {}),
    embeds: [
      {
        title: `🎫 新しいチケット ${payload.ticketId}`,
        color: TICKET_THREAD_CREATE_CATEGORY_COLORS[payload.category],
        fields: [
          {
            name: 'カテゴリ',
            value: TICKET_THREAD_CREATE_CATEGORY_LABELS[payload.category],
            inline: true,
          },
          { name: '件名', value: payload.subject },
          { name: 'スレッド', value: `<#${threadId}>`, inline: true },
        ],
      },
    ],
    allowed_mentions: mentionRoles.length > 0 ? { parse: [], roles: mentionRoles } : { parse: [] },
  };
}

export type DiscordPostClassification = 'success' | 'permanent' | 'retryable';

/**
 * Discord REST の応答分類。400/403/404 は再送しても直らない恒久失敗
 * (本文不正・権限なし・スレッド削除/アーカイブ済み)、429 と 5xx と
 * その他は再試行対象。401 は Bot Token の問題だが、行単位では
 * attempts 上限で failed に倒れるため retryable として扱う。
 */
export function classifyDiscordPostStatus(status: number): DiscordPostClassification {
  if (status >= 200 && status < 300) return 'success';
  if (status === 400 || status === 403 || status === 404) return 'permanent';
  return 'retryable';
}

/**
 * テキスト内にマーカーが ID 境界を伴って現れるか。
 * 単なる前方一致では `ticket-outbox:7` が `ticket-outbox:70` にも
 * 一致してしまうため、マーカーの前後が ID を構成する文字
 * ([0-9A-Za-z_-]) でないことを境界として要求する。
 */
export function textContainsOutboxMarker(text: string, outboxId: string): boolean {
  const marker = ticketOutboxMarker(outboxId);
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^0-9A-Za-z_-])${escaped}(?![0-9A-Za-z_-])`).test(text);
}

/**
 * 直近メッセージ群からマーカー付きの既送メッセージを探す。
 * 他者の投稿に同じ文字列があっても配送済みとはみなさないため、
 * 投稿者 (author.id) が Bot 本人と一致するメッセージだけを対象にする。
 * Bot 本人の ID が分からない場合は安全側に倒して null (未配送扱い)。
 */
export function findDeliveredMessageId(
  messages: unknown,
  outboxId: string,
  botUserId: string | null | undefined,
): string | null {
  if (!Array.isArray(messages)) return null;
  if (!botUserId) return null;
  for (const message of messages) {
    if (!isRecord(message)) continue;
    const id = message['id'];
    if (typeof id !== 'string') continue;
    const author = message['author'];
    if (!isRecord(author) || author['id'] !== botUserId) continue;
    if (
      typeof message['content'] === 'string' &&
      textContainsOutboxMarker(message['content'], outboxId)
    ) {
      return id;
    }
    const embeds = message['embeds'];
    if (!Array.isArray(embeds)) continue;
    for (const embed of embeds) {
      if (!isRecord(embed)) continue;
      const footer = embed['footer'];
      if (
        isRecord(footer) &&
        typeof footer['text'] === 'string' &&
        textContainsOutboxMarker(footer['text'], outboxId)
      ) {
        return id;
      }
    }
  }
  return null;
}

/** Bot Token のユーザー (Bot 本人) の ID を Discord REST から取得する。 */
export async function fetchDiscordBotUserId(input: {
  fetchImpl: typeof fetch;
  token: string;
}): Promise<string> {
  const response = await input.fetchImpl(`${DISCORD_API_BASE_URL}/users/@me`, {
    headers: { Authorization: `Bot ${input.token}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`discord_bot_user_failed_${response.status}`);
  }
  const user = (await response.json()) as { id?: unknown };
  if (typeof user.id !== 'string' || !SNOWFLAKE_PATTERN.test(user.id)) {
    throw new Error('discord_bot_user_missing_id');
  }
  return user.id;
}

export function normalizeTicketScanIntervalSeconds(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_SCAN_INTERVAL_SECONDS;
  return Math.max(
    MIN_SCAN_INTERVAL_SECONDS,
    Math.min(MAX_SCAN_INTERVAL_SECONDS, Math.trunc(value)),
  );
}

function resolveErrorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}

async function fetchRecentThreadMessages(input: {
  fetchImpl: typeof fetch;
  token: string;
  threadId: string;
}): Promise<unknown> {
  const response = await input.fetchImpl(
    `${DISCORD_API_BASE_URL}/channels/${input.threadId}/messages?limit=${DEDUP_SCAN_LIMIT}`,
    {
      headers: { Authorization: `Bot ${input.token}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );
  if (!response.ok) {
    throw new Error(`discord_history_failed_${response.status}`);
  }
  return (await response.json()) as unknown;
}

async function postDiscordThreadMessage(input: {
  fetchImpl: typeof fetch;
  token: string;
  threadId: string;
  body: DiscordMessageBody;
}): Promise<string> {
  const response = await input.fetchImpl(
    `${DISCORD_API_BASE_URL}/channels/${input.threadId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bot ${input.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input.body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );
  const classification = classifyDiscordPostStatus(response.status);
  if (classification !== 'success') {
    throw new TicketDiscordPostError(response.status, classification);
  }
  const message = (await response.json()) as { id?: unknown };
  if (typeof message.id !== 'string' || !SNOWFLAKE_PATTERN.test(message.id)) {
    throw new Error('discord_post_missing_message_id');
  }
  return message.id;
}

/** sourceEventId から eventId (UUID v5 形式) を決定的に導出する。bot の tickets-core と同じ方式。 */
function deriveTicketEventIdV5(sourceEventId: string): string {
  const digest = createHash('sha256').update(`herta-ticket-event:${sourceEventId}`).digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function deriveTicketAttachmentEventId(sourceEventId: string): string {
  return deriveTicketEventIdV5(sourceEventId);
}

/** /thread リンクの eventId。bot の buildTicketThreadPayload と同じ sourceEventId を使う。 */
export function deriveTicketThreadEventId(sourceEventId: string): string {
  return deriveTicketEventIdV5(sourceEventId);
}

export const TICKET_ATTACHMENT_DOWNLOAD_PATH = '/v1/herta/tickets/attachments';

/**
 * clean な添付の実体を署名付き download エンドポイントから取得する。
 * 署名は契約 v1 と同じ canonical (METHOD\nPATH\ntimestamp\neventId\nbody、
 * GET の body は空文字列)。失敗は例外 (呼び出し側で再試行に倒す)。
 */
export async function fetchTicketAttachmentBytes(input: {
  fetchImpl: typeof fetch;
  bridge: TicketAttachmentBridge;
  attachmentId: string;
  outboxId: string;
}): Promise<Uint8Array> {
  const path = `${TICKET_ATTACHMENT_DOWNLOAD_PATH}/${input.attachmentId}`;
  const timestamp = new Date().toISOString();
  const eventId = deriveTicketAttachmentEventId(
    `ticket-attachment-download:${input.outboxId}:${input.attachmentId}`,
  );
  const signature = createHmac('sha256', input.bridge.secret)
    .update(['GET', path, timestamp, eventId, ''].join('\n'))
    .digest('hex');
  const response = await input.fetchImpl(`${input.bridge.apiBaseUrl}${path}`, {
    headers: {
      'X-IVRM-Timestamp': timestamp,
      'X-IVRM-Event-Id': eventId,
      'X-IVRM-Signature': signature,
    },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    throw new Error(`ticket_attachment_download_failed_${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

export interface TicketDiscordFile {
  name: string;
  contentType: string;
  bytes: Uint8Array;
}

/** files 付き投稿 (multipart)。payload_json 側の footer マーカーは JSON 投稿と同一。 */
async function postDiscordThreadMessageWithFiles(input: {
  fetchImpl: typeof fetch;
  token: string;
  threadId: string;
  body: DiscordMessageBody;
  files: readonly TicketDiscordFile[];
}): Promise<string> {
  const form = new FormData();
  form.set('payload_json', JSON.stringify(input.body));
  input.files.forEach((file, index) => {
    form.set(
      `files[${index}]`,
      new Blob([new Uint8Array(file.bytes)], { type: file.contentType }),
      file.name,
    );
  });
  const response = await input.fetchImpl(
    `${DISCORD_API_BASE_URL}/channels/${input.threadId}/messages`,
    {
      method: 'POST',
      headers: { Authorization: `Bot ${input.token}` },
      body: form,
      signal: AbortSignal.timeout(60_000),
    },
  );
  const classification = classifyDiscordPostStatus(response.status);
  if (classification !== 'success') {
    throw new TicketDiscordPostError(response.status, classification);
  }
  const message = (await response.json()) as { id?: unknown };
  if (typeof message.id !== 'string' || !SNOWFLAKE_PATTERN.test(message.id)) {
    throw new Error('discord_post_missing_message_id');
  }
  return message.id;
}

export class TicketDiscordPostError extends Error {
  readonly status: number;
  readonly classification: Exclude<DiscordPostClassification, 'success'>;
  constructor(status: number, classification: Exclude<DiscordPostClassification, 'success'>) {
    super(`discord_post_failed_${status}`);
    this.name = 'TicketDiscordPostError';
    this.status = status;
    this.classification = classification;
  }
}

export async function startTicketDiscordPollerRuntime(
  options: StartTicketDiscordPollerOptions,
): Promise<TicketDiscordPollerRuntime> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const intervalMs = normalizeTicketScanIntervalSeconds(options.scanIntervalSeconds) * 1_000;
  let timer: NodeJS.Timeout | undefined;
  let activeCycle: Promise<void> | null = null;
  let closed = false;
  let cachedBotUserId: string | null = null;

  const resolveBotUserId = async (): Promise<string> => {
    if (cachedBotUserId) return cachedBotUserId;
    cachedBotUserId = await fetchDiscordBotUserId({
      fetchImpl,
      token: options.discordBotToken,
    });
    return cachedBotUserId;
  };

  const executeThreadCreate = async (
    row: TicketOutboxRow,
    payload: TicketThreadCreatePayload,
    deps: TicketThreadCreateDeps,
  ): Promise<string> => {
    // Guild 候補 (設定) はリンク済みの場合の通知にも使うため先に解決する。
    const candidates: Array<{
      guildId: string;
      config: TicketThreadCreateGuildConfig;
      panelChannelId: string;
    }> = [];
    for (const candidate of await deps.listGuildCandidates()) {
      const config = normalizeTicketThreadCreateConfig(candidate.config);
      if (!config.enabled || !config.panelChannelId) continue;
      candidates.push({
        guildId: candidate.guildId,
        config,
        panelChannelId: config.panelChannelId,
      });
    }

    let channelId: string;
    let threadId: string;
    let config: TicketThreadCreateGuildConfig | undefined;
    const existingLink = await deps.findLinkByTicketId(payload.ticketId);
    if (existingLink) {
      // 前回試行でリンク保存まで進んでいた場合は作成をやり直さない。
      channelId = existingLink.channelId;
      threadId = existingLink.threadId;
      config = candidates.find((candidate) => candidate.guildId === existingLink.guildId)?.config;
    } else {
      if (candidates.length === 0) {
        throw new TicketThreadCreateError('ticket_panel_not_configured', true);
      }
      let resolved: (typeof candidates)[number] | null = null;
      for (const candidate of candidates) {
        const membership = await fetchGuildMembership({
          fetchImpl,
          token: options.discordBotToken,
          guildId: candidate.guildId,
          userId: payload.requesterDiscordUserId,
        });
        if (membership === 'member') {
          resolved = candidate;
          break;
        }
      }
      if (!resolved) {
        throw new TicketThreadCreateError('ticket_requester_not_in_guild', true);
      }
      config = resolved.config;
      channelId = resolved.panelChannelId;
      // 作成前に同名スレッドを探し、あれば再利用する (二重作成防止)。
      const activeThreads = await fetchActiveGuildThreads({
        fetchImpl,
        token: options.discordBotToken,
        guildId: resolved.guildId,
      });
      const foundThreadId = findTicketThreadByName(activeThreads, channelId, payload.ticketId);
      if (foundThreadId) {
        threadId = foundThreadId;
      } else {
        threadId = await createDiscordPrivateThread({
          fetchImpl,
          token: options.discordBotToken,
          channelId,
          name: ticketThreadName(payload),
        });
      }
      // 依頼者追加は bot と同じく失敗しても続行する (Staff はスレッドで対応できる)。
      await addDiscordThreadMember({
        fetchImpl,
        token: options.discordBotToken,
        threadId,
        userId: payload.requesterDiscordUserId,
      }).catch((error) => {
        options.logger.warn(
          { outboxId: row.id, ticketId: row.ticketId, errorName: resolveErrorName(error) },
          'チケット用スレッドへの依頼者追加に失敗しました (処理は続行します)',
        );
      });
      await deps.saveLink({
        ticketId: payload.ticketId,
        guildId: resolved.guildId,
        channelId,
        threadId,
        requesterId: payload.requesterDiscordUserId,
      });
    }

    // intro はマーカーで冪等化する。履歴取得に失敗した場合は送らず再試行へ
    // 倒す (二重投稿回避を優先する。既存 kind と同じ方針)。
    const botUserId = await resolveBotUserId();
    const history = await fetchRecentThreadMessages({
      fetchImpl,
      token: options.discordBotToken,
      threadId,
    });
    let introMessageId = findDeliveredMessageId(history, row.id, botUserId);
    const introAlreadyPosted = introMessageId !== null;
    if (!introMessageId) {
      introMessageId = await postDiscordThreadMessage({
        fetchImpl,
        token: options.discordBotToken,
        threadId,
        body: buildTicketThreadIntroMessage(row.id, payload),
      });
    }
    // Web 側リンクは冪等なので毎回送る (前回がリンク保存後に失敗していても収束する)。
    await postTicketThreadLink({
      fetchImpl,
      bridge: deps.bridge,
      ticketId: payload.ticketId,
      channelId,
      threadId,
    });
    // 運用通知は intro を今回投稿した場合のみ出す (再送時の二重通知を避ける)。
    // bot と同じく、通知の失敗で配送自体は失敗にしない。
    if (!introAlreadyPosted && config?.notifyChannelId) {
      await postDiscordThreadMessage({
        fetchImpl,
        token: options.discordBotToken,
        // 通知チャンネルへの投稿も同じ messages エンドポイントを使う。
        threadId: config.notifyChannelId,
        body: buildTicketThreadCreatedNotification(payload, threadId, config),
      }).catch((error) => {
        options.logger.warn(
          { outboxId: row.id, ticketId: row.ticketId, errorName: resolveErrorName(error) },
          'チケット作成の運用通知に失敗しました (処理は続行します)',
        );
      });
    }
    return introMessageId;
  };

  const deliverThreadCreate = async (
    row: TicketOutboxRow,
    payload: TicketThreadCreatePayload,
  ): Promise<void> => {
    const deps = options.threadCreate;
    if (!deps) {
      options.logger.error(
        { outboxId: row.id, ticketId: row.ticketId },
        'thread_create の依存 (Herta DB / 署名ブリッジ) が未設定のため failed にします',
      );
      await options.store.ackFailed(
        row.id,
        'ticket_thread_create_unavailable',
        true,
        TICKET_OUTBOX_MAX_ATTEMPTS,
      );
      return;
    }
    try {
      const introMessageId = await executeThreadCreate(row, payload, deps);
      await options.store.ackSent(row.id, introMessageId);
    } catch (error) {
      const permanent =
        (error instanceof TicketDiscordPostError && error.classification === 'permanent') ||
        (error instanceof TicketThreadCreateError && error.permanent);
      options.logger.warn(
        { outboxId: row.id, ticketId: row.ticketId, errorName: resolveErrorName(error), permanent },
        'チケット thread_create の処理に失敗しました',
      );
      await options.store
        .ackFailed(
          row.id,
          error instanceof Error ? error.message : 'ticket_thread_create_failed',
          permanent,
          TICKET_OUTBOX_MAX_ATTEMPTS,
        )
        .catch(() => undefined);
    }
  };

  const deliverRow = async (row: TicketOutboxRow): Promise<void> => {
    // 内部メモは積まれていない前提だが、混入していたら絶対に送らない。
    if (payloadDeclaresInternal(row.payload)) {
      options.logger.error(
        { outboxId: row.id, ticketId: row.ticketId },
        'チケット outbox に internal な payload が含まれていたため送信せず failed にします',
      );
      await options.store.ackFailed(
        row.id,
        'ticket_payload_internal',
        true,
        TICKET_OUTBOX_MAX_ATTEMPTS,
      );
      return;
    }
    const parsed = parseTicketOutboxPayload(row.kind, row.payload);
    if (!parsed) {
      options.logger.error(
        { outboxId: row.id, ticketId: row.ticketId, kind: row.kind },
        'チケット outbox の payload が解釈できないため failed にします',
      );
      await options.store.ackFailed(
        row.id,
        'ticket_payload_invalid',
        true,
        TICKET_OUTBOX_MAX_ATTEMPTS,
      );
      return;
    }
    if (parsed.kind === 'thread_create') {
      await deliverThreadCreate(row, parsed.payload);
      return;
    }
    const threadId = parsed.payload.discordThreadId;
    try {
      // 再送時の二重投稿防止: 直近メッセージにマーカーがあれば投稿済み。
      // 履歴取得や Bot 本人 ID の取得に失敗した場合は送らずに再試行へ倒す
      // (二重投稿回避を優先)。
      const botUserId = await resolveBotUserId();
      const history = await fetchRecentThreadMessages({
        fetchImpl,
        token: options.discordBotToken,
        threadId,
      });
      const alreadyDeliveredId = findDeliveredMessageId(history, row.id, botUserId);
      if (alreadyDeliveredId) {
        await options.store.ackSent(row.id, alreadyDeliveredId);
        return;
      }
      // 添付 (A6): clean は実体を取得して files 付きで送り、それ以外は
      // プレースホルダ文だけを送る (実体は絶対に転送しない)。ブリッジ
      // 未設定・取得失敗は行全体を再試行に倒し、ファイル無しの本文だけが
      // 先に届いてしまう不完全な配送を避ける。
      const attachments = parsed.kind === 'message_added' ? (parsed.payload.attachments ?? []) : [];
      const placeholderLines: string[] = [];
      const files: TicketDiscordFile[] = [];
      for (const meta of attachments) {
        if (meta.scanStatus !== 'clean') {
          placeholderLines.push(ticketAttachmentPlaceholder(meta));
          continue;
        }
        if (!options.attachmentBridge) {
          placeholderLines.push(`📎 ${meta.fileName}（添付の取得設定がないため表示できません）`);
          continue;
        }
        const bytes = await fetchTicketAttachmentBytes({
          fetchImpl,
          bridge: options.attachmentBridge,
          attachmentId: meta.id,
          outboxId: row.id,
        });
        files.push({ name: meta.fileName, contentType: meta.contentType, bytes });
      }
      const body = buildTicketDiscordMessage(row.id, parsed, placeholderLines);
      const discordMessageId =
        files.length > 0
          ? await postDiscordThreadMessageWithFiles({
              fetchImpl,
              token: options.discordBotToken,
              threadId,
              body,
              files,
            })
          : await postDiscordThreadMessage({
              fetchImpl,
              token: options.discordBotToken,
              threadId,
              body,
            });
      await options.store.ackSent(row.id, discordMessageId);
    } catch (error) {
      const permanent =
        error instanceof TicketDiscordPostError && error.classification === 'permanent';
      options.logger.warn(
        { outboxId: row.id, ticketId: row.ticketId, errorName: resolveErrorName(error), permanent },
        'チケット outbox の Discord 配送に失敗しました',
      );
      await options.store
        .ackFailed(
          row.id,
          error instanceof Error ? error.message : 'ticket_delivery_failed',
          permanent,
          TICKET_OUTBOX_MAX_ATTEMPTS,
        )
        .catch(() => undefined);
    }
  };

  const runCycle = async (): Promise<void> => {
    const rows = await options.store.claim(MAX_BATCH_SIZE, TICKET_OUTBOX_MAX_ATTEMPTS);
    for (const row of rows) {
      if (closed) return;
      await deliverRow(row);
    }
  };

  const scanNow = async (): Promise<void> => {
    if (closed) return;
    if (activeCycle) return activeCycle;
    activeCycle = runCycle().finally(() => {
      activeCycle = null;
    });
    return activeCycle;
  };

  // 初回スキャンが失敗しても Poller 自体は生かし、タイマーで再試行する。
  try {
    await scanNow();
  } catch (error) {
    options.logger.error(
      { errorName: resolveErrorName(error) },
      'チケット outbox Poller の初回スキャンに失敗しました。タイマーで再試行します',
    );
  }
  timer = setInterval(() => {
    void scanNow().catch((error) => {
      options.logger.error(
        { errorName: resolveErrorName(error) },
        'チケット outbox Poller の cycle に失敗しました',
      );
    });
  }, intervalMs);
  timer.unref();

  return {
    scanNow,
    async close() {
      closed = true;
      if (timer) clearInterval(timer);
      timer = undefined;
      await activeCycle;
      await options.store.close();
    },
  };
}

/** thread_create 固有の失敗。permanent=true は再試行しても直らない失敗 (設定・所属・競合)。 */
export class TicketThreadCreateError extends Error {
  readonly permanent: boolean;
  constructor(message: string, permanent: boolean) {
    super(message);
    this.name = 'TicketThreadCreateError';
    this.permanent = permanent;
  }
}

/**
 * guild_plugins の tickets 設定のうち thread_create が使う部分。
 * bot の normalizeTicketsConfig (tickets-core) と同じ正規化規則を写す。
 */
export interface TicketThreadCreateGuildConfig {
  enabled: boolean;
  panelChannelId: string | null;
  staffRoleIds: string[];
  notifyChannelId: string | null;
  notifyStaffOnCreate: boolean;
}

export function normalizeTicketThreadCreateConfig(value: unknown): TicketThreadCreateGuildConfig {
  const source = isRecord(value) ? value : {};
  const snowflakeOrNull = (input: unknown): string | null =>
    typeof input === 'string' && SNOWFLAKE_PATTERN.test(input) ? input : null;
  return {
    enabled: source['enabled'] === undefined ? true : source['enabled'] === true,
    panelChannelId: snowflakeOrNull(source['panelChannelId']),
    staffRoleIds: Array.isArray(source['staffRoleIds'])
      ? [
          ...new Set(
            source['staffRoleIds'].filter(
              (id): id is string => typeof id === 'string' && SNOWFLAKE_PATTERN.test(id),
            ),
          ),
        ].slice(0, 10)
      : [],
    notifyChannelId: snowflakeOrNull(source['notifyChannelId']),
    notifyStaffOnCreate:
      source['notifyStaffOnCreate'] === undefined ? true : source['notifyStaffOnCreate'] === true,
  };
}

export interface TicketThreadCreateGuildCandidate {
  guildId: string;
  /** guild_plugins.config の生 JSON。正規化は poller 側で行う。 */
  config: unknown;
}

export interface TicketThreadLinkRef {
  guildId: string;
  channelId: string;
  threadId: string;
}

export interface TicketThreadLinkInput extends TicketThreadLinkRef {
  ticketId: string;
  requesterId: string;
}

/** thread_create 処理の依存。テストではフェイクを注入する。 */
export interface TicketThreadCreateDeps {
  /** /thread リンク用の署名ブリッジ (添付取得と同じ env・同じ共有鍵)。 */
  bridge: TicketAttachmentBridge;
  /** tickets が有効な guild_plugins 行 (生 config 付き) を返す。 */
  listGuildCandidates(): Promise<TicketThreadCreateGuildCandidate[]>;
  /** 既に保存済みの TicketThreadLink (再送時の作成済み判定)。 */
  findLinkByTicketId(ticketId: string): Promise<TicketThreadLinkRef | null>;
  /** TicketThreadLink の保存 (bot の saveTicketThreadLink と同じ upsert)。 */
  saveLink(link: TicketThreadLinkInput): Promise<void>;
}

/** createTicketThreadCreateDeps が要求する Prisma クライアントの最小形状。 */
export interface TicketThreadCreatePrismaClient {
  guildPlugin: {
    findMany(args: {
      where: { pluginId: string; enabled: boolean };
      select: { guildId: true; config: true };
    }): Promise<Array<{ guildId: string; config: unknown }>>;
  };
  ticketThreadLink: {
    findUnique(args: {
      where: { ticketId: string };
      select: { guildId: true; channelId: true; threadId: true };
    }): Promise<TicketThreadLinkRef | null>;
    upsert(args: {
      where: { ticketId: string };
      create: TicketThreadLinkInput;
      update: Omit<TicketThreadLinkInput, 'ticketId'>;
    }): Promise<unknown>;
  };
}

/** Herta DB (Prisma) から thread_create の依存を組み立てる。 */
export function createTicketThreadCreateDeps(input: {
  prisma: TicketThreadCreatePrismaClient;
  bridge: TicketAttachmentBridge;
}): TicketThreadCreateDeps {
  const { prisma } = input;
  return {
    bridge: input.bridge,
    async listGuildCandidates() {
      const rows = await prisma.guildPlugin.findMany({
        where: { pluginId: 'tickets', enabled: true },
        select: { guildId: true, config: true },
      });
      return rows.map((row) => ({ guildId: row.guildId, config: row.config }));
    },
    async findLinkByTicketId(ticketId: string) {
      return prisma.ticketThreadLink.findUnique({
        where: { ticketId },
        select: { guildId: true, channelId: true, threadId: true },
      });
    },
    async saveLink(link: TicketThreadLinkInput) {
      await prisma.ticketThreadLink.upsert({
        where: { ticketId: link.ticketId },
        create: link,
        update: {
          guildId: link.guildId,
          channelId: link.channelId,
          threadId: link.threadId,
          requesterId: link.requesterId,
        },
      });
    },
  };
}

export const TICKET_THREAD_LINK_PATH = '/v1/herta/tickets/thread';

/**
 * 署名付き /thread で Web 側へスレッドをリンクする。契約 v1 の canonical
 * (POST\nPATH\ntimestamp\neventId\nbody) で署名し、eventId は bot の
 * buildTicketThreadPayload と同じ決定的導出にするため、bot 経由の配送と
 * 二重に届いても Web 側 (link_ticket_thread_v1) で冪等に収束する。
 * 409 (付け替え・横取りの conflict) は恒久失敗として扱う。
 */
export async function postTicketThreadLink(input: {
  fetchImpl: typeof fetch;
  bridge: TicketAttachmentBridge;
  ticketId: string;
  channelId: string;
  threadId: string;
}): Promise<void> {
  const body = JSON.stringify({
    ticketId: input.ticketId,
    discordChannelId: input.channelId,
    discordThreadId: input.threadId,
  });
  const timestamp = new Date().toISOString();
  const eventId = deriveTicketThreadEventId(`ticket-thread:${input.ticketId}:${input.threadId}`);
  const signature = createHmac('sha256', input.bridge.secret)
    .update(['POST', TICKET_THREAD_LINK_PATH, timestamp, eventId, body].join('\n'))
    .digest('hex');
  const response = await input.fetchImpl(`${input.bridge.apiBaseUrl}${TICKET_THREAD_LINK_PATH}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-IVRM-Timestamp': timestamp,
      'X-IVRM-Event-Id': eventId,
      'X-IVRM-Signature': signature,
    },
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.status === 409) {
    throw new TicketThreadCreateError('ticket_thread_link_conflict', true);
  }
  const classification = classifyDiscordPostStatus(response.status);
  if (classification !== 'success') {
    throw new TicketDiscordPostError(response.status, classification);
  }
}

/**
 * 依頼者が Guild のメンバーか。404 は未所属として扱う。Bot 自身が Guild に
 * 参加していない場合も 404/403 になり得るため、403 も未所属として扱い、
 * 次の候補 Guild の判定へ進める。それ以外の失敗は分類して送出する。
 */
async function fetchGuildMembership(input: {
  fetchImpl: typeof fetch;
  token: string;
  guildId: string;
  userId: string;
}): Promise<'member' | 'not_member'> {
  const response = await input.fetchImpl(
    `${DISCORD_API_BASE_URL}/guilds/${input.guildId}/members/${input.userId}`,
    {
      headers: { Authorization: `Bot ${input.token}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );
  if (response.status === 404 || response.status === 403) return 'not_member';
  const classification = classifyDiscordPostStatus(response.status);
  if (classification !== 'success') {
    throw new TicketDiscordPostError(response.status, classification);
  }
  return 'member';
}

/** Guild の active threads 一覧 (同名スレッド検索用)。 */
async function fetchActiveGuildThreads(input: {
  fetchImpl: typeof fetch;
  token: string;
  guildId: string;
}): Promise<unknown> {
  const response = await input.fetchImpl(
    `${DISCORD_API_BASE_URL}/guilds/${input.guildId}/threads/active`,
    {
      headers: { Authorization: `Bot ${input.token}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );
  if (!response.ok) {
    throw new Error(`discord_active_threads_failed_${response.status}`);
  }
  const body = (await response.json()) as { threads?: unknown };
  return body.threads;
}

/** パネルチャンネル配下に非公開スレッドを作成する (type 12 = GUILD_PRIVATE_THREAD)。 */
async function createDiscordPrivateThread(input: {
  fetchImpl: typeof fetch;
  token: string;
  channelId: string;
  name: string;
}): Promise<string> {
  const response = await input.fetchImpl(
    `${DISCORD_API_BASE_URL}/channels/${input.channelId}/threads`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bot ${input.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: input.name, type: 12, invitable: false }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );
  const classification = classifyDiscordPostStatus(response.status);
  if (classification !== 'success') {
    throw new TicketDiscordPostError(response.status, classification);
  }
  const thread = (await response.json()) as { id?: unknown };
  if (typeof thread.id !== 'string' || !SNOWFLAKE_PATTERN.test(thread.id)) {
    throw new Error('discord_thread_create_missing_id');
  }
  return thread.id;
}

/** スレッドへ依頼者を追加する。失敗の扱いは呼び出し側 (bot と同じく続行する)。 */
async function addDiscordThreadMember(input: {
  fetchImpl: typeof fetch;
  token: string;
  threadId: string;
  userId: string;
}): Promise<void> {
  const response = await input.fetchImpl(
    `${DISCORD_API_BASE_URL}/channels/${input.threadId}/thread-members/${input.userId}`,
    {
      method: 'PUT',
      headers: { Authorization: `Bot ${input.token}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );
  if (!response.ok) {
    throw new Error(`discord_thread_member_add_failed_${response.status}`);
  }
}

/**
 * ivrm_services への接続。claim / ack は全て 0002 の SECURITY DEFINER
 * 関数経由で、テーブルへの直接 UPDATE はしない (services の権限モデル)。
 */
export function createTicketDiscordOutboxStore(connectionString: string): TicketDiscordOutboxStore {
  const pool = new Pool({ connectionString, max: 2 });
  return {
    async claim(limit: number, maxAttempts: number): Promise<TicketOutboxRow[]> {
      const result = await pool.query<{ items: unknown }>(
        `SELECT public.claim_ticket_discord_outbox_v1($1::integer, $2::integer) AS items`,
        [limit, maxAttempts],
      );
      const items = result.rows[0]?.items;
      if (!Array.isArray(items)) return [];
      const rows: TicketOutboxRow[] = [];
      for (const item of items) {
        if (!isRecord(item)) continue;
        const outboxId = item['outboxId'];
        const ticketId = item['ticketId'];
        const kind = item['kind'];
        if (typeof outboxId !== 'number' && typeof outboxId !== 'string') continue;
        if (typeof ticketId !== 'string') continue;
        if (kind !== 'message_added' && kind !== 'status_changed' && kind !== 'thread_create') {
          continue;
        }
        rows.push({
          id: String(outboxId),
          ticketId,
          kind,
          payload: item['payload'],
          payloadHash: typeof item['payloadHash'] === 'string' ? item['payloadHash'] : '',
          attempts: typeof item['attempts'] === 'number' ? item['attempts'] : 0,
        });
      }
      return rows;
    },
    async ackSent(id: string, discordMessageId: string): Promise<void> {
      await pool.query(`SELECT public.ack_ticket_discord_outbox_sent_v1($1::bigint, $2::text)`, [
        id,
        discordMessageId,
      ]);
    },
    async ackFailed(
      id: string,
      error: string,
      permanent: boolean,
      maxAttempts: number,
    ): Promise<void> {
      await pool.query(
        `SELECT public.ack_ticket_discord_outbox_failed_v1($1::bigint, $2::text, $3::boolean, $4::integer)`,
        [id, error.slice(0, 500), permanent, maxAttempts],
      );
    },
    async close(): Promise<void> {
      await pool.end();
    },
  };
}
