import { createHash } from 'node:crypto';
import type { Logger } from '@herta/logger';
import { Pool } from 'pg';

/**
 * アチーブメント解除通知 (Herta #925 / ivrm-web Epic #1274 H1)。
 *
 * ivrm-web API が解除時に積む ivrm_api.achievement_notification_outbox を
 * ポーリングし、Discord へ通知する。outbox の status は
 * 'pending' | 'sent' | 'failed' の3値しか取れない (0029 の CHECK) ため、
 * claim は行ロックではなく「単一 Worker + cycle の直列化」で担保する。
 * 送信と sent 化の間にクラッシュすると再送され得る (at-least-once)。
 * 冪等キーは outbox.id (= 解除記録 ID) で、payload_hash (sha256) を
 * 検証してから送信する。
 *
 * 通知の振り分け (ivrm-web #1589 / Herta #964): Discord へ送るのは
 * achievement_notification_settings.discord_min_rank (既定 master)
 * 以上のランクだけ。それ未満は Member ポータルの Web 通知ボックスが
 * 受け皿で、outbox には route='web' / status='delivered' で積まれる
 * ため、この Worker の claim 対象にはならない。route が NULL の行
 * (振り分け導入前の旧行) は claim 時に定義の rank と設定で判定する。
 * 判定に必要な列・テーブルが無い環境 (migration 0057 未適用) では
 * claim クエリ自体が失敗し、cycle は何も送らずに終わる (fail-closed)。
 */

const DEFAULT_SCAN_INTERVAL_SECONDS = 60;
const MIN_SCAN_INTERVAL_SECONDS = 15;
const MAX_SCAN_INTERVAL_SECONDS = 600;
const MAX_BATCH_SIZE = 25;
const MAX_ATTEMPTS = 5;
const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';
const REQUEST_TIMEOUT_MS = 15_000;

export interface AchievementPayload {
  code: string;
  name: string;
  tier: string;
  xpReward: number;
  unlockedAt: string;
}

export interface AchievementOutboxRow {
  id: string;
  userId: string;
  achievementId: string;
  payloadJson: string;
  payloadHash: string;
  attempts: number;
}

export interface AchievementRecipient {
  discordUserId: string;
  username: string;
}

export interface AchievementNotificationStore {
  listPending(limit: number): Promise<AchievementOutboxRow[]>;
  resolveRecipient(userId: string): Promise<AchievementRecipient | null>;
  markSent(id: string, sentAt: string): Promise<void>;
  /** attempts を加算し、上限到達時は status='failed' にする。 */
  markAttemptFailed(id: string, maxAttempts: number): Promise<void>;
  /** 検証不整合など再試行不能な行を即 'failed' にする。 */
  markPoisoned(id: string): Promise<void>;
  close(): Promise<void>;
}

export interface AchievementNotificationRuntime {
  scanNow(): Promise<void>;
  close(): Promise<void>;
}

export interface AchievementCardFetchInput {
  guildId: string;
  discordUserId: string;
  displayName: string;
  payload: AchievementPayload;
}

export interface StartAchievementNotificationRuntimeOptions {
  logger: Logger;
  store: AchievementNotificationStore;
  discordBotToken: string;
  guildId: string;
  /** 通知先チャンネルを解決する。null の間は送信しない (安全側)。 */
  resolveChannelId: () => Promise<string | null>;
  /**
   * 画像カードの取得 (Herta #965)。未指定なら従来どおりテキストのみ。
   * fail-soft が原則で、null が返ればテキスト Embed のみで送信する。
   */
  fetchCardPng?: (input: AchievementCardFetchInput) => Promise<Buffer | null>;
  scanIntervalSeconds?: number;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export function parseAchievementPayload(payloadJson: string): AchievementPayload | null {
  let value: unknown;
  try {
    value = JSON.parse(payloadJson);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record['code'] !== 'string' ||
    typeof record['name'] !== 'string' ||
    typeof record['tier'] !== 'string' ||
    typeof record['xpReward'] !== 'number' ||
    typeof record['unlockedAt'] !== 'string'
  ) {
    return null;
  }
  return {
    code: record['code'],
    name: record['name'],
    tier: record['tier'],
    xpReward: record['xpReward'],
    unlockedAt: record['unlockedAt'],
  };
}

export function verifyAchievementPayloadHash(payloadJson: string, payloadHash: string): boolean {
  const digest = createHash('sha256').update(payloadJson, 'utf8').digest('hex');
  return digest === payloadHash;
}

/** ランクの順序 (ivrm-web API 側の ACHIEVEMENT_RANK_ORDER と一致させる)。 */
export const ACHIEVEMENT_RANK_ORDER: Record<string, number> = {
  bronze: 0,
  silver: 1,
  gold: 2,
  master: 3,
  diamond: 4,
  legend: 5,
};

/** Discord へ送る最低ランクの既定値 (設定行が無い場合)。 */
export const DEFAULT_DISCORD_MIN_RANK = 'master';

/**
 * そのランクの解除を Discord へ送るか。未知のランクは送らない
 * (fail-quiet)。minRank が未知・未設定なら既定の master とみなす。
 * claim クエリ内の CASE 式はこの関数と一致させること。
 */
export function isDiscordRoutedRank(
  rank: string | null | undefined,
  minRank: string | null | undefined,
): boolean {
  const rankOrder = rank != null ? ACHIEVEMENT_RANK_ORDER[rank] : undefined;
  if (rankOrder === undefined) return false;
  const minOrder =
    minRank != null
      ? (ACHIEVEMENT_RANK_ORDER[minRank] ?? ACHIEVEMENT_RANK_ORDER[DEFAULT_DISCORD_MIN_RANK])
      : ACHIEVEMENT_RANK_ORDER[DEFAULT_DISCORD_MIN_RANK];
  return rankOrder >= (minOrder as number);
}

const TIER_PRESENTATION: Record<string, { label: string; emoji: string; color: number }> = {
  bronze: { label: 'ブロンズ', emoji: '🥉', color: 0xcd7f32 },
  silver: { label: 'シルバー', emoji: '🥈', color: 0xc0c0c0 },
  gold: { label: 'ゴールド', emoji: '🥇', color: 0xffd700 },
  master: { label: 'マスター', emoji: '💠', color: 0xa78bfa },
  diamond: { label: 'ダイヤモンド', emoji: '💎', color: 0x7dd3fc },
  legend: { label: 'レジェンド', emoji: '👑', color: 0xfb7185 },
  // 旧ティア名の後方互換 (diamond と同色)。
  platinum: { label: 'プラチナ', emoji: '💎', color: 0x7dd3fc },
};

export function tierPresentation(tier: string): { label: string; emoji: string; color: number } {
  return TIER_PRESENTATION[tier] ?? { label: tier, emoji: '🏆', color: 0x5865f2 };
}

export interface DiscordMessageBody {
  content: string;
  embeds: Array<Record<string, unknown>>;
  allowed_mentions: { users: string[] };
}

/** 画像カードを添付する際のファイル名。コンパニオン Embed の image が参照する。 */
export const ACHIEVEMENT_CARD_FILENAME = 'achievement-card.png';

/**
 * 通知本文。載せるのは公開可能な範囲のみ (名前・ティア・報酬・解除日)。
 * cardFileName があれば、コンパニオン Embed に添付カードへの image を付ける。
 */
export function buildAchievementNotificationMessage(input: {
  displayName: string;
  discordUserId: string;
  payload: AchievementPayload;
  cardFileName?: string;
}): DiscordMessageBody {
  const tier = tierPresentation(input.payload.tier);
  const unlockedDate = input.payload.unlockedAt.slice(0, 10);
  const embed: Record<string, unknown> = {
    title: `${tier.emoji} アチーブメント解除！`,
    description: `${input.displayName} さんがアチーブメント「${input.payload.name}」を解除しました！`,
    color: tier.color,
    fields: [
      { name: 'ティア', value: tier.label, inline: true },
      { name: '報酬', value: `+${input.payload.xpReward} XP`, inline: true },
      { name: '解除日', value: unlockedDate, inline: true },
    ],
  };
  if (input.cardFileName) {
    embed['image'] = { url: `attachment://${input.cardFileName}` };
  }
  return {
    content: `<@${input.discordUserId}>`,
    embeds: [embed],
    allowed_mentions: { users: [input.discordUserId] },
  };
}

export function normalizeAchievementScanIntervalSeconds(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_SCAN_INTERVAL_SECONDS;
  return Math.max(
    MIN_SCAN_INTERVAL_SECONDS,
    Math.min(MAX_SCAN_INTERVAL_SECONDS, Math.trunc(value ?? DEFAULT_SCAN_INTERVAL_SECONDS)),
  );
}

async function fetchGuildMemberDisplayName(input: {
  fetchImpl: typeof fetch;
  token: string;
  guildId: string;
  discordUserId: string;
}): Promise<string | null> {
  try {
    const response = await input.fetchImpl(
      `${DISCORD_API_BASE_URL}/guilds/${input.guildId}/members/${input.discordUserId}`,
      {
        headers: { Authorization: `Bot ${input.token}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    if (!response.ok) return null;
    const member = (await response.json()) as {
      nick?: string | null;
      user?: { global_name?: string | null; username?: string };
    };
    return member.nick ?? member.user?.global_name ?? member.user?.username ?? null;
  } catch {
    return null;
  }
}

async function postDiscordChannelMessage(input: {
  fetchImpl: typeof fetch;
  token: string;
  channelId: string;
  body: DiscordMessageBody;
}): Promise<void> {
  const response = await input.fetchImpl(
    `${DISCORD_API_BASE_URL}/channels/${input.channelId}/messages`,
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
  if (!response.ok) {
    throw new Error(`discord_post_failed_${response.status}`);
  }
}

/**
 * 画像カード付きの投稿。payload_json に本文 (attachments の宣言を含む)
 * を載せ、files[0] に PNG を添付する multipart 形式で送る。
 * Content-Type は boundary を含むため fetch に自動で付けさせる。
 */
async function postDiscordChannelMessageWithCard(input: {
  fetchImpl: typeof fetch;
  token: string;
  channelId: string;
  body: DiscordMessageBody;
  png: Buffer;
}): Promise<void> {
  const payloadJson = JSON.stringify({
    ...input.body,
    attachments: [{ id: 0, filename: ACHIEVEMENT_CARD_FILENAME }],
  });
  const pngBytes = new Uint8Array(input.png.length);
  pngBytes.set(input.png);
  const form = new FormData();
  form.append('payload_json', payloadJson);
  form.append('files[0]', new Blob([pngBytes], { type: 'image/png' }), ACHIEVEMENT_CARD_FILENAME);
  const response = await input.fetchImpl(
    `${DISCORD_API_BASE_URL}/channels/${input.channelId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bot ${input.token}`,
      },
      body: form,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );
  if (!response.ok) {
    throw new Error(`discord_post_failed_${response.status}`);
  }
}

function resolveErrorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}

export async function startAchievementNotificationRuntime(
  options: StartAchievementNotificationRuntimeOptions,
): Promise<AchievementNotificationRuntime> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  const intervalMs = normalizeAchievementScanIntervalSeconds(options.scanIntervalSeconds) * 1_000;
  let timer: NodeJS.Timeout | undefined;
  let activeCycle: Promise<void> | null = null;
  let closed = false;

  const runCycle = async (): Promise<void> => {
    const channelId = await options.resolveChannelId();
    if (!channelId) {
      // 通知先が未設定の間は outbox を一切触らない (pending のまま)。
      return;
    }
    const rows = await options.store.listPending(MAX_BATCH_SIZE);
    for (const row of rows) {
      if (closed) return;
      try {
        if (!verifyAchievementPayloadHash(row.payloadJson, row.payloadHash)) {
          options.logger.error(
            { outboxId: row.id },
            'アチーブメント通知の payload_hash が一致しないため failed にします',
          );
          await options.store.markPoisoned(row.id);
          continue;
        }
        const payload = parseAchievementPayload(row.payloadJson);
        if (!payload) {
          options.logger.error(
            { outboxId: row.id },
            'アチーブメント通知の payload が解釈できないため failed にします',
          );
          await options.store.markPoisoned(row.id);
          continue;
        }
        const recipient = await options.store.resolveRecipient(row.userId);
        if (!recipient) {
          throw new Error('recipient_not_linked');
        }
        const memberName = await fetchGuildMemberDisplayName({
          fetchImpl,
          token: options.discordBotToken,
          guildId: options.guildId,
          discordUserId: recipient.discordUserId,
        });
        const displayName = memberName ?? recipient.username;
        // 画像カードは fail-soft: 取得できなければテキストのみで送る。
        let cardPng: Buffer | null = null;
        if (options.fetchCardPng) {
          cardPng = await options
            .fetchCardPng({
              guildId: options.guildId,
              discordUserId: recipient.discordUserId,
              displayName,
              payload,
            })
            .catch(() => null);
        }
        const body = buildAchievementNotificationMessage({
          displayName,
          discordUserId: recipient.discordUserId,
          payload,
          ...(cardPng ? { cardFileName: ACHIEVEMENT_CARD_FILENAME } : {}),
        });
        if (cardPng) {
          await postDiscordChannelMessageWithCard({
            fetchImpl,
            token: options.discordBotToken,
            channelId,
            body,
            png: cardPng,
          });
        } else {
          await postDiscordChannelMessage({
            fetchImpl,
            token: options.discordBotToken,
            channelId,
            body,
          });
        }
        await options.store.markSent(row.id, now().toISOString());
      } catch (error) {
        options.logger.warn(
          { outboxId: row.id, errorName: resolveErrorName(error) },
          'アチーブメント通知の送信に失敗しました (再試行します)',
        );
        await options.store.markAttemptFailed(row.id, MAX_ATTEMPTS).catch(() => undefined);
      }
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

  await scanNow();
  timer = setInterval(() => {
    void scanNow().catch((error) => {
      options.logger.error(
        { errorName: resolveErrorName(error) },
        'アチーブメント通知 Worker の cycle に失敗しました',
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

/**
 * ivrm_api への接続 (専用ロール想定)。対象は outbox と宛先解決に必要な
 * users の最小列のみ。スキーマは本番の ivrm_api を明示する。
 */
export function createAchievementNotificationStore(
  connectionString: string,
): AchievementNotificationStore {
  const pool = new Pool({ connectionString, max: 2 });
  return {
    async listPending(limit: number): Promise<AchievementOutboxRow[]> {
      // Discord 行きだけを claim する (#964)。route が確定している行は
      // それに従い、NULL の行は定義 rank と設定 (既定 master) で判定する。
      // ランク順序の CASE は ACHIEVEMENT_RANK_ORDER と一致させること
      // (未知ランクは -1 = web 行き、未知の最低ランクは master 扱い)。
      const result = await pool.query<{
        id: string;
        user_id: string;
        achievement_id: string;
        payload_json: string;
        payload_hash: string;
        attempts: number;
      }>(
        `SELECT o.id, o.user_id, o.achievement_id, o.payload_json, o.payload_hash, o.attempts
           FROM ivrm_api.achievement_notification_outbox o
           JOIN ivrm_api.achievement_definitions d ON d.id = o.achievement_id
           LEFT JOIN ivrm_api.achievement_notification_settings s ON s.id = 'default'
          WHERE o.status = 'pending'
            AND COALESCE(
                  o.route,
                  CASE WHEN
                    CASE d."rank"
                      WHEN 'bronze' THEN 0 WHEN 'silver' THEN 1 WHEN 'gold' THEN 2
                      WHEN 'master' THEN 3 WHEN 'diamond' THEN 4 WHEN 'legend' THEN 5
                      ELSE -1
                    END >=
                    CASE COALESCE(s.discord_min_rank, 'master')
                      WHEN 'bronze' THEN 0 WHEN 'silver' THEN 1 WHEN 'gold' THEN 2
                      WHEN 'master' THEN 3 WHEN 'diamond' THEN 4 WHEN 'legend' THEN 5
                      ELSE 3
                    END
                  THEN 'discord' ELSE 'web' END
                ) = 'discord'
          ORDER BY o.created_at ASC
          LIMIT $1`,
        [limit],
      );
      return result.rows.map((row) => ({
        id: row.id,
        userId: row.user_id,
        achievementId: row.achievement_id,
        payloadJson: row.payload_json,
        payloadHash: row.payload_hash,
        attempts: row.attempts,
      }));
    },
    async resolveRecipient(userId: string): Promise<AchievementRecipient | null> {
      const result = await pool.query<{ discord_user_id: string | null; username: string }>(
        `SELECT discord_user_id, username FROM ivrm_api.users WHERE id = $1`,
        [userId],
      );
      const row = result.rows[0];
      if (!row || !row.discord_user_id) return null;
      return { discordUserId: row.discord_user_id, username: row.username };
    },
    async markSent(id: string, sentAt: string): Promise<void> {
      await pool.query(
        `UPDATE ivrm_api.achievement_notification_outbox
            SET status = 'sent', sent_at = $2
          WHERE id = $1 AND status = 'pending'`,
        [id, sentAt],
      );
    },
    async markAttemptFailed(id: string, maxAttempts: number): Promise<void> {
      await pool.query(
        `UPDATE ivrm_api.achievement_notification_outbox
            SET attempts = attempts + 1,
                status = CASE WHEN attempts + 1 >= $2 THEN 'failed' ELSE status END
          WHERE id = $1 AND status = 'pending'`,
        [id, maxAttempts],
      );
    },
    async markPoisoned(id: string): Promise<void> {
      await pool.query(
        `UPDATE ivrm_api.achievement_notification_outbox
            SET status = 'failed'
          WHERE id = $1 AND status = 'pending'`,
        [id],
      );
    },
    async close(): Promise<void> {
      await pool.end();
    },
  };
}
