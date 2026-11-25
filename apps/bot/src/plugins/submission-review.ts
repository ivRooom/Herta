import { createHmac, randomUUID } from 'node:crypto';
import type { PrismaClient } from '@herta/db';
import { submissionReviewManifest } from '@herta/plugin-catalog';
import { definePlugin, type PluginRuntimeContext } from '@herta/plugin-sdk';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type APIActionRowComponent,
  type APIButtonComponent,
  type APIEmbed,
  type APIModalInteractionResponseCallbackData,
} from 'discord.js';
import { memberRoleIds } from './minecraft-status.js';

/**
 * Submission Review (#996, ivrm-web Epic #1822 S3):
 * メンバー申請 (デイリー問題 / 今日は何の日) の Discord 審査プラグイン。
 *
 * 骨格は minecraft-status の `mcw:` 基盤 (#894 / #916) の流用:
 * - customId プレフィックス `dqr:` (デイリー) / `thr:` (今日は何の日)
 * - 承認は Studio 設定の専用ロールをハンドラ内でも再検証 (fail-closed)
 * - 差し戻しは理由モーダル必須、結果は申請者へ DM (fail-soft)
 * - 通知の dedup は運営チャンネルの Bot 自身の投稿を走査して
 *   「申請キー -> 最終通知時刻」を復元する (DB に通知履歴を持たない)。
 *   申請キーは通知ボタン (Bot 生成の customId) からだけ読み、
 *   Embed の表示文面 (問題文・解説など) は読まない
 *
 * 審査の実処理は ivrm-web の Review Bot API (S1, PR #1830) が正本。
 * 署名形式は herta-review-service-auth.ts と対になる
 * (`${timestamp}.${eventId}.POST.${pathname}.${body}` の HMAC-SHA256)。
 * シークレットは Review Bot 専用の HERTA_REVIEW_BOT_SECRET で、
 * minecraft 用とは分離する。API 未設定・フラグ OFF の間は不活性。
 */

const EPHEMERAL_FLAG = 64;
const FETCH_TIMEOUT_MS = 5_000;

const COLOR_NEW = 0x5865f2;
const COLOR_REMINDER = 0xfee75c;
const COLOR_APPROVED = 0x57f287;
const COLOR_RETURNED = 0xed4245;

export const SUBMISSION_REVIEW_DAILY_PREFIX = 'dqr:';
export const SUBMISSION_REVIEW_TODAY_PREFIX = 'thr:';

export type SubmissionReviewKind = 'daily_quiz' | 'today_history';

export function submissionReviewPrefix(kind: SubmissionReviewKind): string {
  return kind === 'daily_quiz' ? SUBMISSION_REVIEW_DAILY_PREFIX : SUBMISSION_REVIEW_TODAY_PREFIX;
}

export function submissionReviewKindLabel(kind: SubmissionReviewKind): string {
  return kind === 'daily_quiz' ? 'デイリー問題' : '今日は何の日';
}

export const SUBMISSION_REVIEW_DEFAULT_POINTS = 5;
export const SUBMISSION_REVIEW_MIN_POINTS = 1;
export const SUBMISSION_REVIEW_MAX_POINTS = 30;
export const SUBMISSION_REVIEW_DAILY_RETURN_MAX_LENGTH = 1000;
export const SUBMISSION_REVIEW_TODAY_RETURN_MAX_LENGTH = 500;

export const SUBMISSION_REVIEW_UNAVAILABLE_MESSAGE =
  '申請審査のBot連携は現在有効化されていません（運営側の設定待ちです）。審査は Web 管理画面から行えます。';

// ---------------------------------------------------------------------------
// Config (Studio プラグイン設定が正本。チャンネル ID はコードに固定しない)
// ---------------------------------------------------------------------------

export interface SubmissionReviewConfig {
  enabled: boolean;
  opsChannelId: string;
  approverRoleIds: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeRoleIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids = value.filter(
    (item): item is string => typeof item === 'string' && /^\d{5,25}$/.test(item),
  );
  return [...new Set(ids)].slice(0, 20);
}

export function normalizeSubmissionReviewConfig(value: unknown): SubmissionReviewConfig {
  const source = isRecord(value) ? value : {};
  return {
    enabled: source.enabled === undefined ? true : source.enabled === true,
    opsChannelId:
      typeof source.opsChannelId === 'string' && /^\d{15,25}$/.test(source.opsChannelId)
        ? source.opsChannelId
        : '',
    approverRoleIds: normalizeRoleIds(source.approverRoleIds),
  };
}

/** 承認ロール未設定なら全員不可 (fail-closed)。mcw の canApprove と同型 */
export function canReviewSubmissions(
  interaction: { member?: unknown },
  config: SubmissionReviewConfig,
): boolean {
  if (config.approverRoleIds.length === 0) return false;
  const allowed = new Set(config.approverRoleIds);
  return memberRoleIds(interaction).some((role) => allowed.has(role));
}

// ---------------------------------------------------------------------------
// Review Bot API クライアント (minecraft Bot API と同型の HMAC 署名)
// ---------------------------------------------------------------------------

export interface SubmissionReviewApiConfig {
  apiBaseUrl: string;
  // ivrm-web の HERTA_REVIEW_BOT_SECRET と対になる HMAC 共有鍵
  secret: string;
}

/** IVRM_WEB_API_BASE_URL / HERTA_REVIEW_BOT_SECRET が揃わない場合は null (機能は不活性) */
export function resolveSubmissionReviewApiConfig(
  env: Partial<Record<string, string | undefined>>,
): SubmissionReviewApiConfig | null {
  const rawUrl = env['IVRM_WEB_API_BASE_URL']?.trim();
  const secret = env['HERTA_REVIEW_BOT_SECRET']?.trim();
  if (!rawUrl || !secret) return null;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' && url.hostname !== 'localhost') return null;
    return { apiBaseUrl: rawUrl.replace(/\/+$/, ''), secret };
  } catch {
    return null;
  }
}

export interface SubmissionReviewApiRequest {
  url: string;
  init: { method: 'POST'; headers: Record<string, string>; body: string };
}

/**
 * ivrm-web 側 herta-review-service-auth.ts と同じ署名形式
 * (`${timestamp}.${eventId}.POST.${pathname}.${body}` の HMAC-SHA256) で
 * signed request を構築する。ネットワークI/Oを含まないため単体テストで検証できる。
 */
export function buildSubmissionReviewApiRequest(
  config: SubmissionReviewApiConfig,
  path: string,
  fields: Record<string, unknown>,
  options: { timestamp?: string; eventId?: string } = {},
): SubmissionReviewApiRequest {
  const timestamp = options.timestamp ?? String(Date.now());
  const eventId = options.eventId ?? `sr-${randomUUID()}`;
  const body = JSON.stringify(fields);
  const signature = createHmac('sha256', config.secret)
    .update(`${timestamp}.${eventId}.POST.${path}.${body}`)
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

export interface SubmissionReviewApiResult {
  ok: boolean;
  status: number;
  data: Record<string, unknown> | null;
}

async function callSubmissionReviewApi(
  config: SubmissionReviewApiConfig,
  path: string,
  fields: Record<string, unknown>,
): Promise<SubmissionReviewApiResult> {
  const request = buildSubmissionReviewApiRequest(config, path, fields);
  try {
    const response = await fetch(request.url, {
      ...request.init,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    return { ok: response.ok, status: response.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

function apiString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function apiNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Bot API のエラーコードを Discord 向けの文面にする */
export function formatSubmissionReviewApiError(result: SubmissionReviewApiResult): string {
  const code = result.data ? apiString(result.data['code']) : null;
  switch (code) {
    case 'bot_api_disabled':
      return '申請審査のBot連携は現在有効化されていません（運営側の設定待ちです）。審査は Web 管理画面から行えます。';
    case 'user_not_registered':
      return 'あなたの ivRooom アカウントが見つかりませんでした。先に Web ポータルで登録してください: https://member.ivrm.jp';
    case 'approver_role_required':
      return '申請審査の専用ロールが必要です。';
    case 'today_history_self_review':
      return '自分の申請は審査できません（自己審査禁止）。他の審査担当者にお願いしてください。';
    case 'reward_required':
      return '付与ポイントを指定してください。';
    case 'reward_invalid':
      return '付与ポイントの形式が正しくありません。数値で入力してください（例: 5.0）。';
    case 'reward_out_of_range':
      return `付与ポイントは ${SUBMISSION_REVIEW_MIN_POINTS}.0〜${SUBMISSION_REVIEW_MAX_POINTS}.0 pt の範囲で指定してください。`;
    case 'reward_step_invalid':
      return '付与ポイントは 0.5 pt 刻みで指定してください。';
    case 'reward_half_point_not_grantable':
      return '0.5 pt 刻みの付与は現在有効化されていません。整数のポイントで指定してください。';
    case 'return_reason_required':
      return '差し戻し理由を入力してください。';
    case 'not_found':
      return 'その申請が見つかりませんでした。既に削除された可能性があります。';
    case 'invalid_transition':
    case 'not_pending_review':
      return 'その申請は既に処理された可能性があります。状況確認で最新状態を確認してください。';
    case 'duplicate_submission':
      return 'その申請は既に処理された可能性があります。状況確認で最新状態を確認してください。';
    case 'approval_provenance_not_ready':
      return '承認の前提条件がサーバー側で未整備のため、現在承認できません。運営にお知らせください。';
    default:
      break;
  }
  if (result.status === 0) {
    return '審査APIへ接続できませんでした。時間を置いて再度お試しください。';
  }
  if (code && code.endsWith('_unavailable')) {
    return 'サーバー側で処理できませんでした。時間を置いて再度お試しください。';
  }
  return `エラーが発生しました（${code ?? `HTTP ${result.status}`}）。時間を置いて再度お試しください。`;
}

// ---------------------------------------------------------------------------
// Pending ペイロード (S1: POST /review/bot/pending の応答形)
// ---------------------------------------------------------------------------

export interface SubmissionReviewDailyDetail {
  question: string;
  choices: string[];
  correctChoiceIndex: number | null;
  explanation: string | null;
  category: string | null;
  quizId: string | null;
}

export interface SubmissionReviewTodayDetail {
  summary: string;
  category: string | null;
  recurrence: string | null;
  monthDay: string | null;
  exactDate: string | null;
  originYear: number | null;
  sourceUrl: string | null;
  sourceLabel: string | null;
}

export interface SubmissionReviewPendingItem {
  kind: SubmissionReviewKind;
  id: string;
  state: string;
  /** 表示用タイトル (デイリーは問題文、今日は何の日は entry の title) */
  title: string;
  authorDisplayName: string | null;
  authorDiscordUserId: string | null;
  submittedAt: string | null;
  reviewLink: string;
  canReview: boolean;
  daily: SubmissionReviewDailyDetail | null;
  today: SubmissionReviewTodayDetail | null;
}

/** dedup 用の申請キー (`dqr:<id>` / `thr:<id>`) */
export function submissionReviewKey(
  item: Pick<SubmissionReviewPendingItem, 'kind' | 'id'>,
): string {
  return `${submissionReviewPrefix(item.kind)}${item.id}`;
}

export function parseSubmissionReviewPending(
  data: Record<string, unknown>,
): SubmissionReviewPendingItem[] {
  const entries = Array.isArray(data['items']) ? data['items'] : [];
  const items: SubmissionReviewPendingItem[] = [];
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const kind = entry['kind'];
    if (kind !== 'daily_quiz' && kind !== 'today_history') continue;
    const id = apiString(entry['id']);
    if (!id) continue;
    const quiz = isRecord(entry['quiz']) ? entry['quiz'] : null;
    const choices =
      quiz && Array.isArray(quiz['choices'])
        ? quiz['choices'].filter((choice): choice is string => typeof choice === 'string')
        : [];
    items.push({
      kind,
      id,
      state: apiString(entry['state']) ?? 'unknown',
      title:
        kind === 'daily_quiz'
          ? ((quiz ? apiString(quiz['question']) : null) ?? '(問題文なし)')
          : (apiString(entry['title']) ?? '(タイトルなし)'),
      authorDisplayName: apiString(entry['authorDisplayName']),
      authorDiscordUserId: apiString(entry['authorDiscordUserId']),
      submittedAt: apiString(entry['submittedAt']) ?? apiString(entry['createdAt']),
      reviewLink: apiString(entry['reviewLink']) ?? '',
      canReview: entry['canReview'] !== false,
      daily:
        kind === 'daily_quiz'
          ? {
              question: (quiz ? apiString(quiz['question']) : null) ?? '',
              choices,
              correctChoiceIndex: quiz ? apiNumber(quiz['correctChoiceIndex']) : null,
              explanation: quiz ? apiString(quiz['explanation']) : null,
              category: quiz ? apiString(quiz['category']) : null,
              quizId: apiString(entry['quizId']),
            }
          : null,
      today:
        kind === 'today_history'
          ? {
              summary: apiString(entry['summary']) ?? '',
              category: apiString(entry['category']),
              recurrence: apiString(entry['recurrence']),
              monthDay: apiString(entry['monthDay']),
              exactDate: apiString(entry['exactDate']),
              originYear: apiNumber(entry['originYear']),
              sourceUrl: apiString(entry['sourceUrl']),
              sourceLabel: apiString(entry['sourceLabel']),
            }
          : null,
    });
  }
  return items;
}

async function fetchSubmissionReviewPending(
  api: SubmissionReviewApiConfig,
  base: Record<string, unknown>,
): Promise<SubmissionReviewPendingItem[] | null> {
  const result = await callSubmissionReviewApi(api, '/review/bot/pending', base);
  return result.ok && result.data ? parseSubmissionReviewPending(result.data) : null;
}

// ---------------------------------------------------------------------------
// ポイント入力の検証 (モーダル送信時のローカル事前チェック。最終検証は API)
// ---------------------------------------------------------------------------

export type ReviewPointsParseResult = { ok: true; points: number } | { ok: false; message: string };

export function parseReviewPointsInput(raw: string): ReviewPointsParseResult {
  const text = raw.trim();
  if (!text) {
    return { ok: false, message: '付与ポイントを入力してください（例: 5.0）。' };
  }
  const points = Number(text);
  if (!Number.isFinite(points)) {
    return { ok: false, message: '付与ポイントは数値で入力してください（例: 5.0）。' };
  }
  if (points < SUBMISSION_REVIEW_MIN_POINTS || points > SUBMISSION_REVIEW_MAX_POINTS) {
    return {
      ok: false,
      message: `付与ポイントは ${SUBMISSION_REVIEW_MIN_POINTS}.0〜${SUBMISSION_REVIEW_MAX_POINTS}.0 pt の範囲で指定してください。`,
    };
  }
  if (!Number.isInteger(points * 2)) {
    return { ok: false, message: '付与ポイントは 0.5 pt 刻みで指定してください。' };
  }
  return { ok: true, points };
}

/** milli ポイントを `5.0` / `7.5` の表示にする */
export function formatRewardPoints(rewardMilli: number): string {
  const points = rewardMilli / 1000;
  return Number.isInteger(points) ? `${points}.0` : `${points}`;
}

// ---------------------------------------------------------------------------
// customId パーサ / モーダル
// ---------------------------------------------------------------------------

export type SubmissionReviewComponentAction =
  'approve' | 'approve-custom' | 'return' | 'status' | 'approve-submit' | 'return-submit';

const COMPONENT_ACTIONS: readonly string[] = [
  'approve',
  'approve-custom',
  'return',
  'status',
  'approve-submit',
  'return-submit',
];

export function parseSubmissionReviewComponentId(customId: string): {
  kind: SubmissionReviewKind;
  action: SubmissionReviewComponentAction;
  id: string;
} | null {
  let kind: SubmissionReviewKind | null = null;
  let rest = '';
  if (customId.startsWith(SUBMISSION_REVIEW_DAILY_PREFIX)) {
    kind = 'daily_quiz';
    rest = customId.slice(SUBMISSION_REVIEW_DAILY_PREFIX.length);
  } else if (customId.startsWith(SUBMISSION_REVIEW_TODAY_PREFIX)) {
    kind = 'today_history';
    rest = customId.slice(SUBMISSION_REVIEW_TODAY_PREFIX.length);
  } else {
    return null;
  }
  const separator = rest.indexOf(':');
  if (separator <= 0) return null;
  const action = rest.slice(0, separator);
  const id = rest.slice(separator + 1);
  if (!id || id.includes(':')) return null;
  if (!COMPONENT_ACTIONS.includes(action)) return null;
  return { kind, action: action as SubmissionReviewComponentAction, id };
}

export function buildSubmissionReviewApproveModal(
  kind: SubmissionReviewKind,
  id: string,
): APIModalInteractionResponseCallbackData {
  const prefix = submissionReviewPrefix(kind);
  const title =
    kind === 'today_history'
      ? '承認（出典確認済みとして記録されます）'
      : `${submissionReviewKindLabel(kind)}の申請を承認`;
  return new ModalBuilder()
    .setCustomId(`${prefix}approve-submit:${id}`)
    .setTitle(title)
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('rewardPoints')
          .setLabel('付与ポイント（1.0〜30.0pt・0.5刻み）')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(SUBMISSION_REVIEW_DEFAULT_POINTS))
          .setMaxLength(8),
      ),
    )
    .toJSON();
}

export function buildSubmissionReviewReturnModal(
  kind: SubmissionReviewKind,
  id: string,
): APIModalInteractionResponseCallbackData {
  const prefix = submissionReviewPrefix(kind);
  const maxLength =
    kind === 'daily_quiz'
      ? SUBMISSION_REVIEW_DAILY_RETURN_MAX_LENGTH
      : SUBMISSION_REVIEW_TODAY_RETURN_MAX_LENGTH;
  return new ModalBuilder()
    .setCustomId(`${prefix}return-submit:${id}`)
    .setTitle('差し戻し理由の入力')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('reason')
          .setLabel('差し戻し理由 (申請者にも通知されます)')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(maxLength),
      ),
    )
    .toJSON();
}

// ---------------------------------------------------------------------------
// 通知 Embed / ボタン
// ---------------------------------------------------------------------------

function truncate(text: string, maxLength: number): string {
  const chars = [...text];
  if (chars.length <= maxLength) return text;
  return `${chars.slice(0, maxLength - 1).join('')}…`;
}

function formatSubmittedAt(value: string | null): string {
  if (!value) return '日時不明';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/** 申請からの経過時間 (時間単位、切り捨て) */
export function submissionReviewElapsedHours(
  item: Pick<SubmissionReviewPendingItem, 'submittedAt'>,
  nowMs: number,
): number {
  if (!item.submittedAt) return 0;
  const submittedMs = Date.parse(item.submittedAt);
  if (!Number.isFinite(submittedMs)) return 0;
  return Math.max(0, Math.floor((nowMs - submittedMs) / (60 * 60 * 1000)));
}

function authorLabel(item: SubmissionReviewPendingItem): string {
  const name = item.authorDisplayName ?? '名前不明';
  return item.authorDiscordUserId ? `${name}（<@${item.authorDiscordUserId}>）` : name;
}

function todayTargetDateLabel(today: SubmissionReviewTodayDetail): string {
  const date = today.exactDate ?? (today.monthDay ? `毎年 ${today.monthDay}` : '日付不明');
  return today.originYear ? `${date}（${today.originYear}年）` : date;
}

export function buildSubmissionReviewEmbed(
  item: SubmissionReviewPendingItem,
  nowMs: number,
  variant: 'new' | 'reminder' = 'new',
): APIEmbed {
  const kindLabel = submissionReviewKindLabel(item.kind);
  const reminder = variant === 'reminder';
  const embed = new EmbedBuilder()
    .setColor(reminder ? COLOR_REMINDER : COLOR_NEW)
    .setTitle(
      reminder
        ? `⏰ リマインド: ${kindLabel}の申請が審査待ちです`
        : item.kind === 'daily_quiz'
          ? '📝 デイリー問題の申請が届きました'
          : '📅 今日は何の日の申請が届きました',
    );

  if (item.kind === 'daily_quiz' && item.daily) {
    embed.setDescription(truncate(item.daily.question || item.title, 500));
    const choices = item.daily.choices.map((choice, index) => {
      const mark = item.daily && item.daily.correctChoiceIndex === index ? ' ✅' : '';
      return `${String.fromCharCode(65 + index)}. ${truncate(choice, 100)}${mark}`;
    });
    if (choices.length > 0) {
      embed.addFields({ name: '選択肢（✅が正解）', value: truncate(choices.join('\n'), 1024) });
    }
    if (item.daily.category) {
      embed.addFields({ name: 'カテゴリ', value: item.daily.category, inline: true });
    }
    if (item.daily.explanation) {
      embed.addFields({ name: '解説', value: truncate(item.daily.explanation, 500) });
    }
  } else if (item.today) {
    embed.setDescription(truncate(item.today.summary || item.title, 500));
    embed.addFields(
      { name: 'タイトル', value: truncate(item.title, 256) },
      { name: '対象日', value: todayTargetDateLabel(item.today), inline: true },
    );
    if (item.today.category) {
      embed.addFields({ name: 'カテゴリ', value: item.today.category, inline: true });
    }
    embed.addFields({
      name: '出典',
      value: truncate(
        item.today.sourceUrl
          ? item.today.sourceLabel
            ? `${item.today.sourceUrl}（${truncate(item.today.sourceLabel, 100)}）`
            : item.today.sourceUrl
          : '出典URLなし',
        1024,
      ),
    });
  }

  // 申請IDと種別キーは人間向けの表示用。dedup は通知ボタンの customId
  // から読むため、表示文面の有無に依存しない
  embed.addFields(
    { name: '申請者', value: authorLabel(item), inline: true },
    {
      name: '申請日時',
      value: `${formatSubmittedAt(item.submittedAt)}（経過 約${submissionReviewElapsedHours(item, nowMs)}時間）`,
      inline: true,
    },
    {
      name: '申請情報',
      value: [
        `申請ID: ${item.id}`,
        `種別キー: ${submissionReviewKey(item)}`,
        `状態: ${item.state}`,
      ].join('\n'),
    },
    { name: '審査リンク', value: item.reviewLink || '(リンクなし)' },
  );
  if (item.kind === 'today_history') {
    embed.setFooter({
      text: '承認ボタンを押すと、出典を確認済みとして記録されます（承認＝出典確認の申告）。自分の申請は審査できません。',
    });
  } else if (reminder) {
    embed.setFooter({ text: '審査待ちから24時間ごとにリマインドしています。' });
  }
  return embed.toJSON();
}

export function buildSubmissionReviewButtons(
  item: Pick<SubmissionReviewPendingItem, 'kind' | 'id' | 'reviewLink'>,
): APIActionRowComponent<APIButtonComponent>[] {
  const prefix = submissionReviewPrefix(item.kind);
  const rows: APIActionRowComponent<APIButtonComponent>[] = [
    new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`${prefix}approve:${item.id}`)
          .setLabel(`承認（${SUBMISSION_REVIEW_DEFAULT_POINTS}.0pt）`)
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`${prefix}approve-custom:${item.id}`)
          .setLabel('金額を指定して承認')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`${prefix}return:${item.id}`)
          .setLabel('差し戻し')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`${prefix}status:${item.id}`)
          .setLabel('状況確認')
          .setStyle(ButtonStyle.Secondary),
      )
      .toJSON(),
  ];
  if (item.reviewLink) {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
          new ButtonBuilder()
            .setLabel('Webで開く')
            .setStyle(ButtonStyle.Link)
            .setURL(item.reviewLink),
        )
        .toJSON(),
    );
  }
  return rows;
}

// ---------------------------------------------------------------------------
// 処理済み表示 / 申請者 DM
// ---------------------------------------------------------------------------

export interface SubmissionReviewResultInfo {
  kind: SubmissionReviewKind;
  id: string;
  title?: string | null;
  action: 'approve' | 'return';
  approverDiscordUserId: string;
  rewardPoints?: number | null;
  reason?: string | null;
  questionCreated?: boolean;
  questionAlreadyExists?: boolean;
  questionStatus?: string | null;
  alreadyApproved?: boolean;
  rewardSkipped?: string | null;
  reviewLink?: string;
}

export function buildSubmissionReviewProcessedEmbed(info: SubmissionReviewResultInfo): APIEmbed {
  const kindLabel = submissionReviewKindLabel(info.kind);
  const approved = info.action === 'approve';
  const embed = new EmbedBuilder()
    .setColor(approved ? COLOR_APPROVED : COLOR_RETURNED)
    .setTitle(
      approved ? `✅ ${kindLabel}の申請を承認しました` : `↩️ ${kindLabel}の申請を差し戻しました`,
    );
  if (info.title) {
    embed.setDescription(truncate(info.title, 500));
  }
  const lines = [
    `申請ID: ${info.id}`,
    `種別キー: ${submissionReviewPrefix(info.kind)}${info.id}`,
    `処理者: <@${info.approverDiscordUserId}>`,
  ];
  if (approved) {
    if (info.alreadyApproved) {
      lines.push('備考: 既に承認済みでした（ポイントは再付与されません）');
    } else if (info.rewardSkipped) {
      lines.push(
        'ポイント: 付与をスキップしました（投稿者をポータルユーザーとして解決できませんでした）',
      );
    } else if (info.rewardPoints !== null && info.rewardPoints !== undefined) {
      lines.push(`付与ポイント: ${info.rewardPoints.toFixed(1)} pt`);
    }
    if (info.kind === 'daily_quiz') {
      if (info.questionCreated) {
        lines.push(
          `問題: 作成済み（${info.questionStatus ?? 'approved'}）。テーマは仮セット（その他）です`,
        );
      } else if (info.questionAlreadyExists) {
        lines.push('問題: 作成済みの問題がありました（二重作成はしていません）');
      }
    }
    if (info.kind === 'today_history') {
      lines.push('出典確認: 承認により確認済みとして記録されました');
    }
  } else if (info.reason) {
    lines.push(`差し戻し理由: ${truncate(info.reason, 500)}`);
  }
  embed.addFields({ name: '処理結果', value: lines.join('\n') });
  if (info.reviewLink) {
    embed.addFields({ name: '審査リンク', value: info.reviewLink });
  }
  return embed.toJSON();
}

export function buildSubmissionReviewNoticeEmbed(info: SubmissionReviewResultInfo): APIEmbed {
  const kindLabel = submissionReviewKindLabel(info.kind);
  const approved = info.action === 'approve';
  const embed = new EmbedBuilder()
    .setColor(approved ? COLOR_APPROVED : COLOR_RETURNED)
    .setTitle(
      approved
        ? `✅ ${kindLabel}の申請が承認されました`
        : `↩️ ${kindLabel}の申請が差し戻されました`,
    );
  if (info.title) {
    embed.setDescription(truncate(info.title, 500));
  }
  if (approved) {
    if (info.rewardSkipped) {
      embed.addFields({
        name: 'ポイント',
        value: '今回は付与をスキップしました（投稿者の解決ができなかったため）',
      });
    } else if (info.rewardPoints !== null && info.rewardPoints !== undefined) {
      embed.addFields({
        name: '付与ポイント',
        value: `${info.rewardPoints.toFixed(1)} pt を付与しました`,
      });
    }
    if (info.kind === 'daily_quiz' && (info.questionCreated || info.questionAlreadyExists)) {
      embed.addFields({
        name: '問題',
        value: '申請内容から問題を作成し、問題一覧へ反映しました',
      });
    }
  } else {
    embed.setDescription(
      [info.title ? truncate(info.title, 500) : null, '内容を確認のうえ、修正して再申請できます。']
        .filter(Boolean)
        .join('\n'),
    );
    if (info.reason) {
      embed.addFields({ name: '差し戻し理由', value: truncate(info.reason, 1000) });
    }
  }
  return embed.toJSON();
}

// ---------------------------------------------------------------------------
// Discord クライアントの最小インターフェース (mcw と同型)
// ---------------------------------------------------------------------------

interface SubmissionReviewReplyOptions {
  content?: string;
  embeds?: APIEmbed[];
  components?: APIActionRowComponent<APIButtonComponent>[];
  flags?: number;
  allowedMentions: { parse: [] } | { users: string[] };
}

interface SubmissionReviewEditOptions {
  content?: string;
  embeds?: APIEmbed[];
  components?: APIActionRowComponent<APIButtonComponent>[];
  allowedMentions: { parse: [] } | { users: string[] };
}

export interface SubmissionReviewChannelMessage {
  author?: { id?: string };
  authorId?: string;
  createdTimestamp?: number;
  content?: string;
  embeds?: {
    description?: string;
    footer?: { text?: string };
    fields?: { name?: string; value?: string }[];
  }[];
  /** 通知ボタン (Bot 生成の customId `dqr:<id>` / `thr:<id>` を持つ行) */
  components?: {
    components?: { customId?: string; custom_id?: string }[];
  }[];
}

interface SubmissionReviewChannel {
  isTextBased(): boolean;
  send(options: {
    embeds: APIEmbed[];
    components?: APIActionRowComponent<APIButtonComponent>[];
    allowedMentions: { parse: [] };
  }): Promise<unknown>;
  messages: {
    fetch(options: { limit: number }): Promise<{
      values(): Iterable<SubmissionReviewChannelMessage>;
    }>;
  };
}

interface SubmissionReviewDmUser {
  send(options: { embeds: APIEmbed[]; allowedMentions: { parse: [] } }): Promise<unknown>;
}

interface SubmissionReviewGuild {
  roles: {
    fetch(roleId: string): Promise<{ members?: { keys(): Iterable<string> } } | null>;
  };
  members?: {
    fetch(userId: string): Promise<{ roles?: unknown } | null>;
  };
}

interface SubmissionReviewClient {
  channels: { fetch(channelId: string): Promise<SubmissionReviewChannel | null> };
  users?: { fetch(userId: string): Promise<SubmissionReviewDmUser | null> };
  user?: { id: string } | null;
  guilds?: { fetch(guildId: string): Promise<SubmissionReviewGuild | null> };
}

type SubmissionReviewContext = PluginRuntimeContext<
  SubmissionReviewConfig,
  SubmissionReviewClient,
  PrismaClient
>;

export interface SubmissionReviewComponentInteraction {
  guildId: string | null;
  customId: string;
  user?: { id?: string };
  member?: unknown;
  fields?: { getTextInputValue(name: string): string };
  deferred?: boolean;
  replied?: boolean;
  /** モーダルを開いた元メッセージ (ボタン経由の場合のみ存在) */
  message?: { edit(options: SubmissionReviewEditOptions): Promise<unknown> } | null;
  isButton(): boolean;
  isModalSubmit(): boolean;
  isFromMessage?(): boolean;
  reply(options: SubmissionReviewReplyOptions): Promise<unknown>;
  update(options: SubmissionReviewEditOptions): Promise<unknown>;
  deferReply(options?: { flags?: number }): Promise<unknown>;
  deferUpdate(): Promise<unknown>;
  editReply(options: SubmissionReviewEditOptions): Promise<unknown>;
  followUp(options: SubmissionReviewReplyOptions): Promise<unknown>;
  showModal(modal: APIModalInteractionResponseCallbackData): Promise<unknown>;
}

async function componentEphemeralReply(
  interaction: SubmissionReviewComponentInteraction,
  content: string,
): Promise<void> {
  await interaction.reply({
    content,
    flags: EPHEMERAL_FLAG,
    allowedMentions: { parse: [] },
  });
}

/**
 * defer 後の審査者への返信。deferReply なら editReply、deferUpdate なら
 * followUp (ephemeral) で返す。deferUpdate 後に editReply でエラーを返すと
 * 元メッセージがエラー文面で上書きされてしまうため使い分ける。
 */
async function componentDeferredReply(
  interaction: SubmissionReviewComponentInteraction,
  content: string,
  deferred: 'reply' | 'update',
): Promise<void> {
  if (deferred === 'update') {
    await interaction.followUp({
      content,
      flags: EPHEMERAL_FLAG,
      allowedMentions: { parse: [] },
    });
    return;
  }
  await interaction.editReply({ content, allowedMentions: { parse: [] } });
}

/** defer 後の審査者への返信 (Embed 付き)。使い分けは componentDeferredReply と同じ */
async function componentDeferredPayloadReply(
  interaction: SubmissionReviewComponentInteraction,
  payload: SubmissionReviewEditOptions,
  deferred: 'reply' | 'update',
): Promise<void> {
  if (deferred === 'update') {
    await interaction.followUp({
      ...payload,
      flags: EPHEMERAL_FLAG,
      allowedMentions: { parse: [] },
    });
    return;
  }
  await interaction.editReply(payload);
}

async function notifySubmissionReviewResult(
  context: SubmissionReviewContext,
  target: SubmissionReviewPendingItem,
  info: SubmissionReviewResultInfo,
): Promise<void> {
  if (!target.authorDiscordUserId || !context.client.users) return;
  try {
    const user = await context.client.users.fetch(target.authorDiscordUserId);
    await user?.send({
      embeds: [buildSubmissionReviewNoticeEmbed(info)],
      allowedMentions: { parse: [] },
    });
  } catch {
    // DM を受け取れないユーザーでは通知だけ失敗し、審査結果には影響させない
  }
}

// ---------------------------------------------------------------------------
// 通知ワーカー (5分ポーリング / 24時間リマインド / 履歴走査 dedup)
// ---------------------------------------------------------------------------

export const SUBMISSION_REVIEW_REMINDER_INTERVAL_MS = 24 * 60 * 60 * 1000;
const SUBMISSION_REVIEW_WORKER_INTERVAL_MS = 5 * 60 * 1000;
const SUBMISSION_REVIEW_SCAN_LIMIT = 100;
const SUBMISSION_REVIEW_MAX_OPERATOR_CANDIDATES = 5;

const notificationTimers = new Map<string, NodeJS.Timeout>();
const notificationRuns = new Map<string, Promise<void>>();
const notificationOperators = new Map<string, string>();
/** 実行者候補の開始位置 (ギルドごと)。全員失敗したサイクルで進める */
const notificationOperatorOffsets = new Map<string, number>();
/** ワーカーの世代 (ギルドごと)。停止で進み、旧世代のサイクルは送信を開始しない */
const notificationGenerations = new Map<string, number>();
/**
 * 送信済み時刻のプロセス内記録 (`guild:channel:key -> ms`)。
 * 履歴走査 (100件) を補完し、通知が100件より後ろへ流れた後も24時間
 * 待機を守る。再起動後は履歴走査から復元する (DB に通知履歴は持たない)。
 */
const notificationSentTimes = new Map<string, number>();

function submissionReviewSentTimeKey(guildId: string, channelId: string, key: string): string {
  return `${guildId}:${channelId}:${key}`;
}

function recordSubmissionReviewSentTime(
  guildId: string,
  channelId: string,
  key: string,
  sentMs: number,
): void {
  notificationSentTimes.set(submissionReviewSentTimeKey(guildId, channelId, key), sentMs);
}

/** 承認ロールを確認できた運営者の Discord ID をギルドごとに覚える */
export function rememberSubmissionReviewOperator(guildId: string, discordUserId: string): void {
  if (guildId && discordUserId) {
    notificationOperators.set(guildId, discordUserId);
  }
}

/**
 * Bot 自身の投稿から「申請キー -> 最終通知時刻 (ms)」を復元する。
 * 申請キーは通知ボタン (Bot 生成の customId `dqr:<id>` / `thr:<id>`) から
 * だけ読む。Embed の表示文面 (問題文・解説・出典など) には申請内容が
 * そのまま入るため、そこに別申請のキーそっくりの文字列が含まれると
 * 誤って他申請の通知済みとして記録してしまう。表示文面は読まない。
 * 処理済みでボタンが外れた投稿はキーを持たないが、処理済みの申請は
 * pending から消えるため dedup には不要。
 */
export function collectSubmissionNotificationTimes(
  messages: Iterable<SubmissionReviewChannelMessage>,
  botUserId: string | null,
): Map<string, number> {
  const times = new Map<string, number>();
  const record = (key: string, timestamp: number) => {
    const current = times.get(key);
    if (current === undefined || timestamp > current) times.set(key, timestamp);
  };
  for (const message of messages) {
    if (typeof message.createdTimestamp !== 'number') continue;
    const authorId = message.author?.id ?? message.authorId;
    if (botUserId && authorId !== botUserId) continue;
    for (const row of message.components ?? []) {
      for (const component of row.components ?? []) {
        const customId = component.customId ?? component.custom_id;
        if (!customId) continue;
        const parsed = parseSubmissionReviewComponentId(customId);
        if (!parsed) continue;
        record(submissionReviewKey(parsed), message.createdTimestamp);
      }
    }
  }
  return times;
}

/**
 * 通知対象の振り分け: 未通知 -> 即時通知、最終通知から24時間以上 -> リマインド。
 * 初回通知は申請直後に行われるため、リマインドは実質「申請から24時間後以降、
 * 最終通知から24時間ごと」になる (D9)。
 */
export function selectSubmissionNotifications(
  items: SubmissionReviewPendingItem[],
  notifiedTimes: Map<string, number>,
  nowMs: number,
): { fresh: SubmissionReviewPendingItem[]; reminders: SubmissionReviewPendingItem[] } {
  const fresh: SubmissionReviewPendingItem[] = [];
  const reminders: SubmissionReviewPendingItem[] = [];
  for (const item of items) {
    const last = notifiedTimes.get(submissionReviewKey(item)) ?? notifiedTimes.get(item.id);
    if (last === undefined) {
      fresh.push(item);
    } else if (nowMs - last >= SUBMISSION_REVIEW_REMINDER_INTERVAL_MS) {
      reminders.push(item);
    }
  }
  return { fresh, reminders };
}

function startNotificationWorker(context: SubmissionReviewContext): void {
  stopNotificationWorker(context.guildId);
  void runSubmissionReviewCycle(context);
  const timer = setInterval(() => {
    void runSubmissionReviewCycle(context);
  }, SUBMISSION_REVIEW_WORKER_INTERVAL_MS);
  timer.unref();
  notificationTimers.set(context.guildId, timer);
}

export function stopNotificationWorker(guildId: string): void {
  const timer = notificationTimers.get(guildId);
  if (timer) clearInterval(timer);
  notificationTimers.delete(guildId);
  // 進行中のサイクルを無効化する。interval の解除だけでは fetch 完了後の
  // 送信は止まらないため、世代を進めて送信開始前に弾く
  notificationGenerations.set(guildId, (notificationGenerations.get(guildId) ?? 0) + 1);
}

/** 承認ロールの保持者 (メンバーキャッシュにある範囲) の Discord ID を集める */
async function discoverApproverIds(
  context: SubmissionReviewContext,
  config: SubmissionReviewConfig,
): Promise<string[]> {
  if (!context.client.guilds) return [];
  try {
    const guild = await context.client.guilds.fetch(context.guildId);
    if (!guild) return [];
    const ids: string[] = [];
    for (const roleId of config.approverRoleIds) {
      const role = await guild.roles.fetch(roleId);
      for (const memberId of role?.members?.keys() ?? []) {
        if (typeof memberId === 'string' && !ids.includes(memberId)) ids.push(memberId);
      }
    }
    return ids;
  } catch {
    return [];
  }
}

/**
 * 覚えている運営者が現在もギルド所属かつ承認ロール保持者かを検証する。
 * 検証できない場合 (Guild/Member 取得失敗) は未検証として扱い、署名付き
 * pending 取得の実行者には使わない (fail-closed)。過去の成功は現在の
 * 権限を証明しない。
 */
async function isCurrentSubmissionReviewApprover(
  context: SubmissionReviewContext,
  config: SubmissionReviewConfig,
  discordUserId: string,
): Promise<boolean> {
  if (!context.client.guilds) return false;
  try {
    const guild = await context.client.guilds.fetch(context.guildId);
    const member = await guild?.members?.fetch(discordUserId);
    if (!member) return false;
    return memberRoleIds({ member }).some((role) => config.approverRoleIds.includes(role));
  } catch {
    return false;
  }
}

/**
 * 実行者候補の並び: 以前成功した運営者 (検証済み) を先頭にし、残りは
 * startOffset から回転させて並べる。1サイクルの上限は limit。
 */
export function orderSubmissionReviewOperatorCandidates(
  discovered: string[],
  remembered: string | null,
  startOffset: number,
  limit: number,
): string[] {
  const ordered: string[] = [];
  if (remembered) ordered.push(remembered);
  const count = discovered.length;
  for (let index = 0; index < count; index += 1) {
    const id = discovered[(startOffset + index) % count];
    if (id && !ordered.includes(id)) ordered.push(id);
  }
  return ordered.slice(0, limit);
}

/**
 * 審査待ち一覧を、運営者の ID を実行者として取得する (mcw と同型)。
 * Bot API の pending は「実行者 = 登録済み運営者」の ID が必須のため、
 * 候補を順に試し、最初に成功した ID を次回用に覚える。
 * 覚えている運営者は現在のロール保持を検証してから候補にし、
 * 全員失敗したサイクルは次回の開始位置を進めて同じ先頭候補を繰り返さない。
 */
async function fetchPendingForNotification(
  context: SubmissionReviewContext,
  api: SubmissionReviewApiConfig,
  config: SubmissionReviewConfig,
): Promise<SubmissionReviewPendingItem[] | null> {
  const discovered = await discoverApproverIds(context, config);
  const remembered = notificationOperators.get(context.guildId) ?? null;
  let verifiedRemembered: string | null = null;
  if (remembered) {
    if (discovered.includes(remembered)) {
      // ロール保持者一覧にいる場合は現在の権限が確認できている
      verifiedRemembered = remembered;
    } else if (await isCurrentSubmissionReviewApprover(context, config, remembered)) {
      verifiedRemembered = remembered;
    }
  }
  const startOffset = notificationOperatorOffsets.get(context.guildId) ?? 0;
  const ordered = orderSubmissionReviewOperatorCandidates(
    discovered,
    verifiedRemembered,
    startOffset,
    SUBMISSION_REVIEW_MAX_OPERATOR_CANDIDATES,
  );
  let discoveredTried = 0;
  for (const discordUserId of ordered) {
    if (discovered.includes(discordUserId)) discoveredTried += 1;
    const items = await fetchSubmissionReviewPending(api, {
      discordUserId,
      guildId: context.guildId,
      approverRoleVerified: true,
    });
    if (items) {
      notificationOperators.set(context.guildId, discordUserId);
      const index = discovered.indexOf(discordUserId);
      if (index >= 0 && discovered.length > 0) {
        notificationOperatorOffsets.set(context.guildId, (index + 1) % discovered.length);
      }
      return items;
    }
  }
  // 全員失敗した場合は次サイクルの開始位置を進め、同じ先頭候補を繰り返さない
  if (discovered.length > 0 && discoveredTried > 0) {
    notificationOperatorOffsets.set(
      context.guildId,
      (startOffset + discoveredTried) % discovered.length,
    );
  }
  return null;
}

export async function runSubmissionReviewCycle(
  context: SubmissionReviewContext,
  nowMs: number = Date.now(),
): Promise<void> {
  const generation = notificationGenerations.get(context.guildId) ?? 0;
  const runKey = `${context.guildId}:${generation}`;
  const existing = notificationRuns.get(runKey);
  if (existing) return existing;
  const run = (async () => {
    try {
      const config = normalizeSubmissionReviewConfig(context.config);
      if (!config.enabled || !config.opsChannelId) return;
      if (config.approverRoleIds.length === 0) return;
      const api = resolveSubmissionReviewApiConfig(process.env);
      if (!api) return;
      const items = await fetchPendingForNotification(context, api, config);
      if (!items || items.length === 0) return;
      const fetched = await context.client.channels.fetch(config.opsChannelId);
      if (!fetched || !fetched.isTextBased()) return;
      if ((fetched as { guildId?: string | null }).guildId !== context.guildId) return;
      const channel = fetched as unknown as SubmissionReviewChannel;
      const recent = await channel.messages.fetch({ limit: SUBMISSION_REVIEW_SCAN_LIMIT });
      const notifiedTimes = collectSubmissionNotificationTimes(
        recent.values(),
        context.client.user?.id ?? null,
      );
      // プロセス内で送信済みの時刻を重ねる (履歴の100件より後ろへ流れた分を補完)
      const sentPrefix = `${context.guildId}:${config.opsChannelId}:`;
      for (const [recordKey, sentMs] of notificationSentTimes) {
        if (!recordKey.startsWith(sentPrefix)) continue;
        const key = recordKey.slice(sentPrefix.length);
        const current = notifiedTimes.get(key);
        if (current === undefined || sentMs > current) notifiedTimes.set(key, sentMs);
      }
      const { fresh, reminders } = selectSubmissionNotifications(items, notifiedTimes, nowMs);
      // 通知ポリシー: メンションは P0 レベルの緊急アラートのみ。申請通知では ping しない
      const sendItems = async (
        targets: SubmissionReviewPendingItem[],
        variant: 'new' | 'reminder',
      ): Promise<void> => {
        for (const item of targets) {
          // 停止された世代は次の送信を開始しない (進行中の送信は完了してよい)
          if ((notificationGenerations.get(context.guildId) ?? 0) !== generation) return;
          const key = submissionReviewKey(item);
          try {
            await channel.send({
              embeds: [buildSubmissionReviewEmbed(item, nowMs, variant)],
              components: buildSubmissionReviewButtons(item),
              allowedMentions: { parse: [] },
            });
            recordSubmissionReviewSentTime(context.guildId, config.opsChannelId, key, nowMs);
          } catch (error) {
            // 1件の失敗で他件を止めない。失敗件は次周期で再試行する
            // (申請内容はログに出さない。キーとエラーのみ)
            context.logger?.warn(
              { key, error: error instanceof Error ? error.message : String(error) },
              '申請通知の送信に失敗しました',
            );
          }
        }
      };
      await sendItems(fresh, 'new');
      await sendItems(reminders, 'reminder');
    } catch {
      // 通知の失敗でワーカーを落とさない (次周期で再試行する)
    }
  })();
  notificationRuns.set(runKey, run);
  try {
    await run;
  } finally {
    notificationRuns.delete(runKey);
  }
}

// ---------------------------------------------------------------------------
// ボタン / モーダルの処理
// ---------------------------------------------------------------------------

function reviewApiPath(kind: SubmissionReviewKind, action: 'approve' | 'return'): string {
  return kind === 'daily_quiz'
    ? `/review/bot/daily/${action}`
    : `/review/bot/today-history/${action}`;
}

function reviewIdField(kind: SubmissionReviewKind): string {
  return kind === 'daily_quiz' ? 'submissionId' : 'entryId';
}

/** 承認・差し戻しボタンとモーダルの処理。ロール再検証と結果 DM を含む */
export async function handleSubmissionReviewComponent(
  context: SubmissionReviewContext,
  interaction: SubmissionReviewComponentInteraction,
): Promise<void> {
  const parsed = parseSubmissionReviewComponentId(interaction.customId);
  if (!parsed) return;
  const config = normalizeSubmissionReviewConfig(context.config);
  if (!config.enabled) {
    await componentEphemeralReply(interaction, 'Submission Review Pluginは現在無効です。');
    return;
  }
  if (!canReviewSubmissions(interaction, config)) {
    await componentEphemeralReply(interaction, 'この操作には申請審査の専用ロールが必要です。');
    return;
  }
  const api = resolveSubmissionReviewApiConfig(process.env);
  if (!api) {
    await componentEphemeralReply(interaction, SUBMISSION_REVIEW_UNAVAILABLE_MESSAGE);
    return;
  }
  const approverId = interaction.user?.id;
  const guildId = interaction.guildId ?? context.guildId;
  if (!approverId || !guildId) {
    await componentEphemeralReply(interaction, 'ユーザー情報を取得できませんでした。');
    return;
  }
  const base = { discordUserId: approverId, guildId, approverRoleVerified: true };
  // 通知ワーカーの実行者候補として、ロール確認済みの運営者を覚える
  rememberSubmissionReviewOperator(guildId, approverId);

  if (parsed.action === 'approve-custom') {
    if (!interaction.isButton()) return;
    await interaction.showModal(buildSubmissionReviewApproveModal(parsed.kind, parsed.id));
    return;
  }
  if (parsed.action === 'return') {
    if (!interaction.isButton()) return;
    await interaction.showModal(buildSubmissionReviewReturnModal(parsed.kind, parsed.id));
    return;
  }

  if (parsed.action === 'status') {
    if (!interaction.isButton()) return;
    // 応答期限 (約3秒) を切らないよう、API 取得の前に defer する
    await interaction.deferReply({ flags: EPHEMERAL_FLAG });
    const items = await fetchSubmissionReviewPending(api, base);
    if (!items) {
      await componentDeferredReply(
        interaction,
        '審査待ち一覧を取得できませんでした。時間を置いて再度お試しください。',
        'reply',
      );
      return;
    }
    const target = items.find((item) => item.kind === parsed.kind && item.id === parsed.id);
    if (!target) {
      await componentDeferredReply(
        interaction,
        'この申請は審査待ちにありません。既に処理済み（承認・差し戻し・取り下げ）の可能性があります。',
        'reply',
      );
      return;
    }
    await componentDeferredReply(
      interaction,
      [
        `${submissionReviewKindLabel(target.kind)}の申請は審査待ちです。`,
        `申請ID: ${target.id}`,
        `状態: ${target.state}`,
        `申請日時: ${formatSubmittedAt(target.submittedAt)}（経過 約${submissionReviewElapsedHours(target, Date.now())}時間）`,
        `審査リンク: ${target.reviewLink}`,
      ].join('\n'),
      'reply',
    );
    return;
  }

  // approve (ボタン) / approve-submit (モーダル) / return-submit (モーダル)
  const action: 'approve' | 'return' = parsed.action === 'return-submit' ? 'return' : 'approve';
  let rewardPoints: number | null = null;
  let reason: string | null = null;
  if (parsed.action === 'approve') {
    if (!interaction.isButton()) return;
    rewardPoints = SUBMISSION_REVIEW_DEFAULT_POINTS;
  } else if (parsed.action === 'approve-submit') {
    if (!interaction.isModalSubmit()) return;
    const parsedPoints = parseReviewPointsInput(
      interaction.fields?.getTextInputValue('rewardPoints') ?? '',
    );
    if (!parsedPoints.ok) {
      await componentEphemeralReply(interaction, parsedPoints.message);
      return;
    }
    rewardPoints = parsedPoints.points;
  } else {
    if (!interaction.isModalSubmit()) return;
    reason = interaction.fields?.getTextInputValue('reason')?.trim() ?? '';
    const maxLength =
      parsed.kind === 'daily_quiz'
        ? SUBMISSION_REVIEW_DAILY_RETURN_MAX_LENGTH
        : SUBMISSION_REVIEW_TODAY_RETURN_MAX_LENGTH;
    if (!reason) {
      await componentEphemeralReply(interaction, '差し戻し理由を入力してください。');
      return;
    }
    if ([...reason].length > maxLength) {
      await componentEphemeralReply(
        interaction,
        `差し戻し理由は ${maxLength} 文字以内で入力してください。`,
      );
      return;
    }
  }

  // 応答期限 (約3秒) を切らないよう、最初の API 呼び出しの前に defer する。
  // ボタンは deferUpdate (成功時に editReply で元メッセージを更新する)、
  // モーダルは deferReply (ephemeral。成功時に元メッセージも更新する)
  const deferredKind: 'reply' | 'update' = interaction.isButton() ? 'update' : 'reply';
  if (deferredKind === 'update') {
    await interaction.deferUpdate();
  } else {
    await interaction.deferReply({ flags: EPHEMERAL_FLAG });
  }

  // DM と処理済み表示のために、処理前の pending から対象を引いておく
  const before = await fetchSubmissionReviewPending(api, base);
  const target = before?.find((item) => item.kind === parsed.kind && item.id === parsed.id);

  const result = await callSubmissionReviewApi(api, reviewApiPath(parsed.kind, action), {
    ...base,
    [reviewIdField(parsed.kind)]: parsed.id,
    ...(action === 'approve' ? { rewardPoints } : { reason }),
  });
  if (!result.ok || !result.data) {
    await componentDeferredReply(interaction, formatSubmissionReviewApiError(result), deferredKind);
    return;
  }

  const data = result.data;
  const rewardMilli = apiNumber(data['rewardMilli']);
  const info: SubmissionReviewResultInfo = {
    kind: parsed.kind,
    id: parsed.id,
    title: target?.title ?? null,
    action,
    approverDiscordUserId: approverId,
    rewardPoints:
      action === 'approve' ? (rewardMilli !== null ? rewardMilli / 1000 : rewardPoints) : null,
    reason,
    questionCreated: data['questionCreated'] === true,
    questionAlreadyExists: data['questionAlreadyExists'] === true,
    questionStatus: apiString(data['questionStatus']),
    alreadyApproved: data['alreadyApproved'] === true,
    rewardSkipped: apiString(data['rewardSkipped']),
    reviewLink: apiString(data['reviewLink']) ?? target?.reviewLink,
  };

  const processedEmbed = buildSubmissionReviewProcessedEmbed(info);
  if (interaction.isModalSubmit()) {
    // ボタン経由で開いたモーダルは元メッセージを更新し、ボタンが残ったまま
    // 「審査待ちに見える」状態を解消する。更新に失敗しても ephemeral の
    // 結果表示で補う (fail-soft)
    if (interaction.isFromMessage?.() && interaction.message) {
      try {
        await interaction.message.edit({
          embeds: [processedEmbed],
          components: [],
          allowedMentions: { parse: [] },
        });
      } catch {
        // 元メッセージの更新失敗は結果表示に影響させない
      }
    }
    await componentDeferredPayloadReply(
      interaction,
      {
        content: action === 'approve' ? '承認しました。' : '差し戻しました。',
        embeds: [processedEmbed],
        allowedMentions: { parse: [] },
      },
      'reply',
    );
  } else {
    // deferUpdate 済みのため editReply で元メッセージを処理済み表示へ更新する
    await interaction.editReply({
      embeds: [processedEmbed],
      components: [],
      allowedMentions: { parse: [] },
    });
  }
  // 申請者への DM は審査者への応答の後 (DM の失敗は結果表示に影響しない)
  if (target) {
    await notifySubmissionReviewResult(context, target, info);
  }
}

// ---------------------------------------------------------------------------
// Plugin 定義
// ---------------------------------------------------------------------------

export const submissionReviewPlugin = definePlugin<
  SubmissionReviewConfig,
  SubmissionReviewClient,
  PrismaClient
>({
  manifest: submissionReviewManifest,
  async onEnable(context) {
    startNotificationWorker(context);
  },
  async onDisable(context) {
    stopNotificationWorker(context.guildId);
  },
  provideEvents() {
    return [
      {
        event: 'interactionCreate',
        async handler(context, ...args) {
          const interaction = args[0] as SubmissionReviewComponentInteraction | undefined;
          if (!interaction || typeof interaction.customId !== 'string') return;
          if (
            !interaction.customId.startsWith(SUBMISSION_REVIEW_DAILY_PREFIX) &&
            !interaction.customId.startsWith(SUBMISSION_REVIEW_TODAY_PREFIX)
          ) {
            return;
          }
          if (interaction.guildId && interaction.guildId !== context.guildId) return;
          await handleSubmissionReviewComponent(context, interaction);
        },
      },
    ];
  },
});
