export function validDailyBonusDate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d\d-\d\d$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  );
}
export function currentDailyBonusDate(now = new Date()): string {
  return new Date(now.getTime() + 32400000).toISOString().slice(0, 10);
}
export function canOperateDailyAnnouncement(date: string, now = new Date()): boolean {
  return validDailyBonusDate(date) && date === currentDailyBonusDate(now);
}
export function dailyBonusReferenceRate(confirmed: number, eligible: number | null): string {
  if (
    eligible === null ||
    eligible <= 0 ||
    !Number.isSafeInteger(eligible) ||
    !Number.isSafeInteger(confirmed) ||
    confirmed < 0
  )
    return '—';
  return ((confirmed / eligible) * 100).toFixed(1) + '%';
}

/**
 * 特別日ルール（#705）の Studio 側ユーティリティ。
 * 解決ロジックは Bot 側 `apps/bot/src/plugins/daily-special-days.ts` と同一セマンティクスで、
 * ここでの解決は表示プレビュー専用（実際に通知へ適用する解決は Bot が行う）。
 */

export interface SpecialDayRuleView {
  id: string;
  kind: 'date' | 'annual';
  exact_date: string | null;
  month_day: string | null;
  title: string | null;
  intro: string | null;
  enabled: boolean;
}

export interface SpecialDayRuleInput {
  id?: string;
  kind: 'date' | 'annual';
  exactDate: string | null;
  monthDay: string | null;
  title: string | null;
  intro: string | null;
  enabled: boolean;
}

export interface SpecialDayOverride {
  title: string | null;
  intro: string | null;
  source: 'date' | 'annual';
}

const TITLE_MAX_LENGTH = 256;
const INTRO_MAX_LENGTH = 1000;
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function validMonthDay(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const month = Number(match[1]);
  const day = Number(match[2]);
  return month >= 1 && month <= 12 && day >= 1 && day <= DAYS_IN_MONTH[month - 1]!;
}

function trimmedText(value: unknown, maxLength: number): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > maxLength) return undefined;
  return trimmed;
}

/** API・フォームから受け取った値を DB の制約と表示上限に合わせて検証する。不正なら null。 */
export function parseSpecialDayRuleInput(value: unknown): SpecialDayRuleInput | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const kind = record.kind;
  if (kind !== 'date' && kind !== 'annual') return null;
  let exactDate: string | null = null;
  let monthDay: string | null = null;
  if (kind === 'date') {
    if (!validDailyBonusDate(record.exactDate)) return null;
    exactDate = record.exactDate;
  } else {
    if (!validMonthDay(record.monthDay)) return null;
    monthDay = record.monthDay;
  }
  const title = trimmedText(record.title, TITLE_MAX_LENGTH);
  const intro = trimmedText(record.intro, INTRO_MAX_LENGTH);
  if (title === undefined || intro === undefined) return null;
  if (title === null && intro === null) return null;
  if (typeof record.enabled !== 'boolean') return null;
  let id: string | undefined;
  if (record.id !== undefined && record.id !== null && record.id !== '') {
    if (typeof record.id !== 'string' || record.id.length > 128) return null;
    id = record.id;
  }
  return { id, kind, exactDate, monthDay, title, intro, enabled: record.enabled };
}

function toOverride(rule: SpecialDayRuleView): SpecialDayOverride | null {
  const title = rule.title?.trim().slice(0, TITLE_MAX_LENGTH) || null;
  const intro = rule.intro?.trim().slice(0, INTRO_MAX_LENGTH) || null;
  if (!title && !intro) return null;
  return { title, intro, source: rule.kind };
}

/**
 * 指定日（JST の YYYY-MM-DD）に適用される特別日ルールを解決する。
 * 優先順位は個別日（date）> 年次（annual）。無効化されたルールは発動しない。
 */
export function resolveSpecialDayOverride(
  rules: readonly SpecialDayRuleView[],
  dateJst: string,
): SpecialDayOverride | null {
  if (!validDailyBonusDate(dateJst)) return null;
  const monthDay = dateJst.slice(5);
  const dateRule = rules.find(
    (rule) => rule.enabled && rule.kind === 'date' && rule.exact_date === dateJst,
  );
  if (dateRule) {
    // 内容が使えない個別日ルールは年次ルールへフォールバックする（Bot の解決と同一）。
    const dateOverride = toOverride(dateRule);
    if (dateOverride) return dateOverride;
  }
  const annualRule = rules.find(
    (rule) => rule.enabled && rule.kind === 'annual' && rule.month_day === monthDay,
  );
  if (annualRule) return toOverride(annualRule);
  return null;
}

/** 同じ対象（種別＋日付）を指す別 id の既存ルールがあれば返す（保存時の競合警告用）。 */
export function findConflictingSpecialDayRule(
  rules: readonly SpecialDayRuleView[],
  input: SpecialDayRuleInput,
): SpecialDayRuleView | undefined {
  return rules.find(
    (rule) =>
      rule.id !== input.id &&
      rule.kind === input.kind &&
      (input.kind === 'date'
        ? rule.exact_date === input.exactDate
        : rule.month_day === input.monthDay),
  );
}

/** Bot が説明文の末尾に必ず付ける固定文（apps/bot の daily-bonus と一致させる）。 */
export const DAILY_BONUS_DESCRIPTION_SUFFIX =
  '下のボタンで共通ログインボーナスを受け取れます。\n付与額・連続日数はメンバーポータルと共通です。\n受取期限：翌日09:00 JST\n📋 [クエストボードはこちら](https://member.ivrm.jp/quests)';
/** Bot がフッターに必ず入れる固定文。 */
export const DAILY_BONUS_FIXED_FOOTER = '受取と今日の運勢は本人にだけ表示します';
/** プラグイン設定 messageTemplate の最大長（manifest の configSchema と一致）。 */
export const MESSAGE_TEMPLATE_MAX_LENGTH = 1000;

/** プラグイン設定のスキーマと同じ条件で messageTemplate を検証する。 */
export function parseMessageTemplateInput(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MESSAGE_TEMPLATE_MAX_LENGTH) return null;
  return value;
}

/**
 * 本文テンプレートの版管理（#766 Phase C）の Studio 側ユーティリティ。
 * 状態遷移の正本は API と DB（@herta/db）で、ここは入力検証と
 * 画面表示用の遷移表・ラベルを提供する。
 */

export type TemplateRevisionStatus =
  'draft' | 'pending_review' | 'approved' | 'active' | 'superseded' | 'rejected';

export interface TemplateRevisionView {
  id: string;
  revision: number;
  message_template: string;
  status: TemplateRevisionStatus;
  created_by: string;
  approved_by: string | null;
  review_note: string | null;
  activated_at: string | null;
  created_at: string;
  updated_at: string;
}

export const TEMPLATE_REVISION_STATUS_LABELS: Record<TemplateRevisionStatus, string> = {
  draft: '下書き',
  pending_review: '審査待ち',
  approved: '承認済み',
  active: '有効化中',
  superseded: '旧版',
  rejected: '差戻し',
};

export type TemplateRevisionAction =
  'edit' | 'submit' | 'delete' | 'approve' | 'return' | 'activate' | 'deactivate';

/** 状態ごとに画面へ出してよい操作。API 側でも同じ遷移を DB の更新条件で強制する。 */
export function templateRevisionActions(
  status: TemplateRevisionStatus,
): readonly TemplateRevisionAction[] {
  switch (status) {
    case 'draft':
    case 'rejected':
      return ['edit', 'submit', 'delete'];
    case 'pending_review':
      return ['approve', 'return'];
    case 'approved':
      return ['activate'];
    case 'active':
      return ['deactivate'];
    case 'superseded':
      return [];
  }
}

/** 版の本文の検証。プラグイン設定と同じ最大長で、空の下書きは作らせない。 */
export function parseTemplateRevisionContent(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MESSAGE_TEMPLATE_MAX_LENGTH) return null;
  if (value.trim().length === 0) return null;
  return value;
}

export function parseTemplateRevisionId(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) return null;
  return value;
}

const REVIEW_NOTE_MAX_LENGTH = 500;

/** 差戻し理由。未指定・空は null、不正な型や長すぎる値は undefined。 */
export function parseTemplateRevisionReviewNote(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > REVIEW_NOTE_MAX_LENGTH) return undefined;
  return trimmed;
}

export interface DailyBonusPreview {
  title: string;
  description: string;
  footer: string;
  titleFromSpecialDay: boolean;
  introFromSpecialDay: boolean;
}

/**
 * Bot の Embed 合成規則の複製（#766 Phase B の送信なしプレビュー用）。
 * 特別日ルールがタイトル・冒頭文より優先され、説明文の末尾とフッターは
 * 常に固定文になる。記念日フィールド・画像・色は当日の確定内容でのみ
 * 付くため、ここには含めない。
 */
export function composeDailyBonusPreview(input: {
  dateJst: string;
  messageTemplate: string;
  specialDay: SpecialDayOverride | null;
}): DailyBonusPreview {
  return {
    title: input.specialDay?.title ?? `🎁 ${input.dateJst} 本日のログインボーナス`,
    description: `${input.specialDay?.intro ?? input.messageTemplate}\n\n${DAILY_BONUS_DESCRIPTION_SUFFIX}`,
    footer: DAILY_BONUS_FIXED_FOOTER,
    titleFromSpecialDay: Boolean(input.specialDay?.title),
    introFromSpecialDay: Boolean(input.specialDay?.intro),
  };
}

// ---------------------------------------------------------------------------
// #766 Phase D1: TEST sends (#723). Studio queues a request; the Bot
// claims it, validates the target channel itself and sends one
// TEST-marked message. The parsers below only shape the request input.

export type TestSendStatus = 'queued' | 'sending' | 'sent' | 'failed' | 'uncertain' | 'expired';

export interface TestSendView {
  id: string;
  channelId: string;
  targetDate: string;
  requestedBy: string;
  status: TestSendStatus;
  messageId: string | null;
  errorCode: string | null;
  createdAt: string;
}

export const TEST_SEND_STATUS_LABELS: Record<TestSendStatus, string> = {
  queued: '送信待ち',
  sending: '送信中',
  sent: '送信済み',
  failed: '失敗',
  uncertain: '送達不明（再送しません）',
  expired: '期限切れ',
};

/** Discord snowflake (17-20 digits), the same shape as plugin config ids. */
export function parseTestSendChannelId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^\d{17,20}$/.test(trimmed) ? trimmed : null;
}

export function parseTestSendDate(value: unknown): string | null {
  return typeof value === 'string' && validDailyBonusDate(value) ? value : null;
}
