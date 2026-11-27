import { createHmac, randomUUID } from 'node:crypto';

/**
 * VALORANT トロールガチャ (縛り) の Herta 側モジュール
 * (#1047、ivrm-web Epic #2010 の S2)。
 *
 * 判定の正本は ivrm-web の抽選エンジン (S1、PR #2018) で、この
 * モジュールは抽選も確率も持たない:
 * - `/valorant random` のエージェント確定後、Bot API
 * `POST /valorant/bot/troll/draw` へ参加者と Guild 設定を送り、
 * 返ってきた割当を表示 (Embed / ピックカード) へ合流させるだけ
 * - 署名形式は deco-gacha / submission-review と同じ
 * (`${timestamp}.${eventId}.POST.${pathname}.${body}` の
 * HMAC-SHA256)。シークレットは専用の HERTA_TROLL_BOT_SECRET
 * で、review / deco 用とは分離する
 * - API が失敗・未設定・無効化の間は fail-soft: 縛りなしで
 * 本抽選の結果をそのまま返す (deco の fail-closed とは逆で、
 * 縛りは抽選の追加レイヤーにすぎないため)
 *
 * 冪等キー: 完了済みセッション行は上書きされず、再抽選は新しい
 * 行を作る (valorant-session-repository の履歴不変性)。つまり
 * セッション行 ID そのものが「抽選世代」なので、キーには
 * 行 ID を使う。再送・再試行では同じ割当が再生される。
 */

const FETCH_TIMEOUT_MS = 5_000;
export const VALORANT_TROLL_DRAW_PATH = '/valorant/bot/troll/draw';

// ---------------------------------------------------------------------------
// 契約型 (ivrm-web valorant-troll-core.ts の値が正本)
// ---------------------------------------------------------------------------

export type ValorantTrollRarity = 'normal' | 'rare' | 'super_rare' | 'ultra_rare';
export type ValorantTrollCategory = 'troll' | 'punishment' | 'settings' | 'custom';
export type ValorantTrollRarityFilter = 'all' | 'rare_plus' | 'super_rare_plus';

export const VALORANT_TROLL_CATEGORIES: readonly ValorantTrollCategory[] = [
  'troll',
  'punishment',
  'settings',
  'custom',
];

export const VALORANT_TROLL_RARITY_LABELS: Record<ValorantTrollRarity, string> = {
  normal: 'ノーマル',
  rare: 'レア',
  super_rare: 'スーパーレア',
  ultra_rare: 'ウルトラレア',
};

export const VALORANT_TROLL_CATEGORY_LABELS: Record<ValorantTrollCategory, string> = {
  troll: 'トロール',
  punishment: '罰ゲーム',
  settings: '設定変更',
  custom: 'カスタム専用',
};

export function isValorantTrollRarity(value: unknown): value is ValorantTrollRarity {
  return value === 'normal' || value === 'rare' || value === 'super_rare' || value === 'ultra_rare';
}

export function isValorantTrollCategory(value: unknown): value is ValorantTrollCategory {
  return value === 'troll' || value === 'punishment' || value === 'settings' || value === 'custom';
}

export function isValorantTrollRarityFilter(value: unknown): value is ValorantTrollRarityFilter {
  return value === 'all' || value === 'rare_plus' || value === 'super_rare_plus';
}

/** 1人に割り当てられた縛り (S1 の応答 assignments[].troll と同形) */
export interface ValorantTroll {
  itemId: string;
  text: string;
  rarity: ValorantTrollRarity;
  category: ValorantTrollCategory;
}

// ---------------------------------------------------------------------------
// Guild 設定 (valorant プラグイン設定の一部。既定は安全側 = 無効)
// ---------------------------------------------------------------------------

export interface ValorantTrollConfig {
  /** 縛り合流のマスタースイッチ。false の間は従来表示のみ */
  enabled: boolean;
  /** 縛りを割り当てる人数 (1..5、既定2) */
  count: number;
  rarityFilter: ValorantTrollRarityFilter;
  /** 対象カテゴリ (1件以上。空指定は全カテゴリ扱い) */
  categories: ValorantTrollCategory[];
}

export const DEFAULT_VALORANT_TROLL_CONFIG: ValorantTrollConfig = {
  enabled: false,
  count: 2,
  rarityFilter: 'all',
  categories: [...VALORANT_TROLL_CATEGORIES],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** guildPlugin.config のフラットキー (trollGacha*) を正規化する */
export function normalizeValorantTrollConfig(source: Record<string, unknown>): ValorantTrollConfig {
  const categories = Array.isArray(source['trollCategories'])
    ? [
        ...new Set(
          source['trollCategories'].filter((entry): entry is ValorantTrollCategory =>
            isValorantTrollCategory(entry),
          ),
        ),
      ]
    : [];
  return {
    enabled: source['trollGachaEnabled'] === true,
    count:
      typeof source['trollCount'] === 'number' && Number.isInteger(source['trollCount'])
        ? Math.max(1, Math.min(5, source['trollCount']))
        : DEFAULT_VALORANT_TROLL_CONFIG.count,
    rarityFilter: isValorantTrollRarityFilter(source['trollRarityFilter'])
      ? source['trollRarityFilter']
      : 'all',
    categories: categories.length > 0 ? categories : [...VALORANT_TROLL_CATEGORIES],
  };
}

// ---------------------------------------------------------------------------
// Bot API クライアント (deco-gacha と同型の HMAC 署名)
// ---------------------------------------------------------------------------

export interface ValorantTrollApiConfig {
  apiBaseUrl: string;
  // ivrm-web の HERTA_TROLL_BOT_SECRET と対になる HMAC 共有鍵
  secret: string;
}

/** IVRM_WEB_API_BASE_URL / HERTA_TROLL_BOT_SECRET が揃わない場合は null (合流は不活性) */
export function resolveValorantTrollApiConfig(
  env: Partial<Record<string, string | undefined>>,
): ValorantTrollApiConfig | null {
  const rawUrl = env['IVRM_WEB_API_BASE_URL']?.trim();
  const secret = env['HERTA_TROLL_BOT_SECRET']?.trim();
  if (!rawUrl || !secret) return null;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' && url.hostname !== 'localhost') return null;
    return { apiBaseUrl: rawUrl.replace(/\/+$/, ''), secret };
  } catch {
    return null;
  }
}

export interface ValorantTrollApiRequest {
  url: string;
  init: { method: 'POST'; headers: Record<string, string>; body: string };
}

/**
 * ivrm-web 側 herta-troll-service-auth.ts と同じ署名形式で signed
 * request を構築する。ネットワークI/Oを含まないため単体テストで
 * 検証できる。
 */
export function buildValorantTrollApiRequest(
  config: ValorantTrollApiConfig,
  fields: Record<string, unknown>,
  options: { timestamp?: string; eventId?: string } = {},
): ValorantTrollApiRequest {
  const timestamp = options.timestamp ?? String(Date.now());
  const eventId = options.eventId ?? `vt-${randomUUID()}`;
  const body = JSON.stringify(fields);
  const signature = createHmac('sha256', config.secret)
    .update(`${timestamp}.${eventId}.POST.${VALORANT_TROLL_DRAW_PATH}.${body}`)
    .digest('hex');
  return {
    url: `${config.apiBaseUrl}${VALORANT_TROLL_DRAW_PATH}`,
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

/**
 * セッション行 ID から冪等キーを作る。完了済み行は不変で再抽選は
 * 新しい行になるため、行 ID = 抽選世代として一意になる。
 */
export function valorantTrollIdempotencyKey(sessionId: string): string {
  return `herta-valorant-troll:${sessionId}`;
}

export interface ValorantTrollDrawInput {
  /** 抽選を実行した Discord ユーザー (作成者またはボタンを押した管理者) */
  operatorDiscordUserId: string;
  guildId: string;
  sessionId: string;
  participants: readonly { discordUserId: string; name: string }[];
  trollOffDiscordUserIds: readonly string[];
  config: ValorantTrollConfig;
}

/** S1 の検証 (名前は非空・64文字以内) に合わせて送信フィールドを整える */
export function buildValorantTrollDrawFields(
  input: ValorantTrollDrawInput,
): Record<string, unknown> {
  return {
    discordUserId: input.operatorDiscordUserId,
    guildId: input.guildId,
    participants: input.participants.map((participant, index) => ({
      discordUserId: participant.discordUserId,
      name: participant.name.trim().slice(0, 64) || `参加者${index + 1}`,
    })),
    trollCount: input.config.count,
    rarityFilter: input.config.rarityFilter,
    categories: [...input.config.categories],
    trollOffDiscordUserIds: [...new Set(input.trollOffDiscordUserIds)],
    idempotencyKey: valorantTrollIdempotencyKey(input.sessionId),
  };
}

export interface ValorantTrollDrawSuccess {
  status: 'ok';
  drawId: string;
  alreadyDrawn: boolean;
  /** participantKey (= Discord ユーザーID) → 縛り。対象外は null */
  trollByUserId: ReadonlyMap<string, ValorantTroll | null>;
}

export type ValorantTrollDrawResult =
  ValorantTrollDrawSuccess | { status: 'unavailable'; httpStatus: number; code: string | null };

function parseTroll(value: unknown): ValorantTroll | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const itemId = value['itemId'];
  const text = value['text'];
  if (
    typeof itemId !== 'string' ||
    itemId.length === 0 ||
    typeof text !== 'string' ||
    text.length === 0 ||
    !isValorantTrollRarity(value['rarity']) ||
    !isValorantTrollCategory(value['category'])
  ) {
    return undefined;
  }
  return { itemId, text, rarity: value['rarity'], category: value['category'] };
}

/** Bot API の成功応答を検証する。形が崩れていたら null (= fail-soft 対象) */
export function parseValorantTrollDrawResponse(
  data: Record<string, unknown> | null,
): Omit<ValorantTrollDrawSuccess, 'status'> | null {
  if (!data || data['status'] !== 'ok') return null;
  const drawId = data['drawId'];
  if (typeof drawId !== 'string' || drawId.length === 0) return null;
  if (!Array.isArray(data['assignments'])) return null;
  const trollByUserId = new Map<string, ValorantTroll | null>();
  for (const entry of data['assignments']) {
    if (!isRecord(entry)) return null;
    const participantKey = entry['participantKey'];
    if (typeof participantKey !== 'string' || participantKey.length === 0) return null;
    const troll = parseTroll(entry['troll']);
    if (troll === undefined) return null;
    trollByUserId.set(participantKey, troll);
  }
  return { drawId, alreadyDrawn: data['alreadyDrawn'] === true, trollByUserId };
}

/**
 * 縛り抽選を S1 へ依頼する。HTTP エラー・タイムアウト・応答不正は
 * すべて `unavailable` として返し、呼び出し側は縛りなしで本抽選を
 * 成立させる (fail-soft)。ここでは例外を投げない。
 */
export async function drawValorantTrolls(
  config: ValorantTrollApiConfig,
  input: ValorantTrollDrawInput,
  fetcher: typeof fetch = fetch,
): Promise<ValorantTrollDrawResult> {
  const request = buildValorantTrollApiRequest(config, buildValorantTrollDrawFields(input));
  let response: Response;
  try {
    response = await fetcher(request.url, {
      ...request.init,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    return { status: 'unavailable', httpStatus: 0, code: null };
  }
  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    const code = data && typeof data['code'] === 'string' ? (data['code'] as string) : null;
    return { status: 'unavailable', httpStatus: response.status, code };
  }
  const parsed = parseValorantTrollDrawResponse(data);
  if (!parsed)
    return { status: 'unavailable', httpStatus: response.status, code: 'invalid_response' };
  return { status: 'ok', ...parsed };
}

// ---------------------------------------------------------------------------
// 表示への合流 (セッション result JSON が表示の正本)
// ---------------------------------------------------------------------------

/**
 * 完了済みセッションの result 配列へ縛りを合流させた新しい配列を返す。
 * 元の entry は変更しない。trollByUserId に無い参加者はそのまま。
 */
export function mergeValorantTrollsIntoResult(
  result: unknown,
  trollByUserId: ReadonlyMap<string, ValorantTroll | null>,
): unknown[] | null {
  if (!Array.isArray(result)) return null;
  return result.map((entry) => {
    if (!isRecord(entry) || typeof entry['userId'] !== 'string') return entry;
    if (!trollByUserId.has(entry['userId'])) return entry;
    return { ...entry, troll: trollByUserId.get(entry['userId']) ?? null };
  });
}

/** result entry の troll フィールドを検証して取り出す (表示側の型ガード) */
export function readValorantTrollFromEntry(entry: unknown): ValorantTroll | null {
  if (!isRecord(entry)) return null;
  const troll = parseTroll(entry['troll']);
  return troll ?? null;
}

// ---------------------------------------------------------------------------
// 人狼モード (#1049) の purpose 別抽選
//
// 通常合流 (S2) と違い、秘密の縛りは fail-closed: 抽選できなければ
// ゲームを開始しない。罰ゲームは結果確定後の付随処理として別キーで
// 引き、勝敗公開は止めない。キーを purpose ごとに分けるため、通常
// 抽選・人狼秘密・罰ゲームの台帳は混ざらない。
// ---------------------------------------------------------------------------

export type ValorantWerewolfDrawPurpose = 'secret' | 'punishment';

export function valorantWerewolfSecretIdempotencyKey(sessionId: string): string {
  return `herta-valorant-werewolf:${sessionId}:secret:v1`;
}

export function valorantWerewolfPunishmentIdempotencyKey(sessionId: string): string {
  return `herta-valorant-werewolf:${sessionId}:punishment:v1`;
}

export function valorantWerewolfIdempotencyKey(
  sessionId: string,
  purpose: ValorantWerewolfDrawPurpose,
): string {
  return purpose === 'secret'
    ? valorantWerewolfSecretIdempotencyKey(sessionId)
    : valorantWerewolfPunishmentIdempotencyKey(sessionId);
}

export interface ValorantWerewolfDrawInput {
  purpose: ValorantWerewolfDrawPurpose;
  /** 抽選を実行した Discord ユーザー (開始・締切を押した権限者) */
  operatorDiscordUserId: string;
  guildId: string;
  sessionId: string;
  /** 対象者は常に1人だけ (人狼本人 or 罰ゲーム対象者) */
  participant: { discordUserId: string; name: string };
  /**
   * 秘密は Guild の trollRarityFilter を使う。罰ゲームはカテゴリ内で
   * 'all' 固定 (フィルター継承でプール不足を起こさないため)。
   */
  rarityFilter: ValorantTrollRarityFilter;
}

/** S1 の検証 (名前は非空・64文字以内) に合わせて送信フィールドを整える */
export function buildValorantWerewolfDrawFields(
  input: ValorantWerewolfDrawInput,
  secretCategories: readonly ValorantTrollCategory[],
): Record<string, unknown> {
  return {
    discordUserId: input.operatorDiscordUserId,
    guildId: input.guildId,
    participants: [
      {
        discordUserId: input.participant.discordUserId,
        name: input.participant.name.trim().slice(0, 64) || '参加者1',
      },
    ],
    trollCount: 1,
    rarityFilter: input.rarityFilter,
    categories: input.purpose === 'secret' ? [...secretCategories] : ['punishment'],
    // 人狼選定後の対象者を troll-off で外すと割当が成立しないため常に空
    trollOffDiscordUserIds: [],
    idempotencyKey: valorantWerewolfIdempotencyKey(input.sessionId, input.purpose),
  };
}

export type ValorantWerewolfDrawResult =
  | { status: 'ok'; drawId: string; troll: ValorantTroll }
  | { status: 'unavailable'; httpStatus: number; code: string | null }
  | { status: 'invalid_response'; httpStatus: number };

/**
 * 人狼用の1人抽選。応答は通常の parser で検証したうえで、対象者が
 * ちょうど含まれ・縛りが null でなく・カテゴリが purpose の許可集合に
 * 入ることまで確認する。1つでも外れたら invalid_response として
 * 呼び出し側は確定に進まない (秘密抽選は fail-closed)。
 * HTTP エラーとネットワーク失敗は unavailable。
 */
export async function drawValorantWerewolfTroll(
  config: ValorantTrollApiConfig,
  input: ValorantWerewolfDrawInput,
  secretCategories: readonly ValorantTrollCategory[],
  fetcher: typeof fetch = fetch,
): Promise<ValorantWerewolfDrawResult> {
  const request = buildValorantTrollApiRequest(
    config,
    buildValorantWerewolfDrawFields(input, secretCategories),
  );
  let response: Response;
  try {
    response = await fetcher(request.url, {
      ...request.init,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    return { status: 'unavailable', httpStatus: 0, code: null };
  }
  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    const code = data && typeof data['code'] === 'string' ? (data['code'] as string) : null;
    return { status: 'unavailable', httpStatus: response.status, code };
  }
  const parsed = parseValorantTrollDrawResponse(data);
  if (!parsed) return { status: 'invalid_response', httpStatus: response.status };
  const troll = parsed.trollByUserId.get(input.participant.discordUserId);
  if (!troll) return { status: 'invalid_response', httpStatus: response.status };
  const categoryOk =
    input.purpose === 'punishment'
      ? troll.category === 'punishment'
      : secretCategories.includes(troll.category);
  if (!categoryOk) return { status: 'invalid_response', httpStatus: response.status };
  return { status: 'ok', drawId: parsed.drawId, troll };
}

/** Embed の結果行に付ける縛り表記 */
export function formatValorantTrollEmbedText(troll: ValorantTroll): string {
  const rarity = VALORANT_TROLL_RARITY_LABELS[troll.rarity];
  const category = VALORANT_TROLL_CATEGORY_LABELS[troll.category];
  return '🎭 縛り[' + rarity + ' / ' + category + '] ' + troll.text;
}

/** ピックカードの行に載せる短い縛り表記 (全文は Embed 側に残る) */
export function formatValorantTrollCardText(troll: ValorantTroll): string {
  return '縛り[' + VALORANT_TROLL_RARITY_LABELS[troll.rarity] + '] ' + troll.text;
}
