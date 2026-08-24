export type DailyContentQueueJobDisposition = 'enqueue' | 'keep' | 'replace';

/**
 * BullMQのattemptsはDaily Contentの設定値そのものではなく、transport層の安全上限として扱う。
 * Domain retryはDBのattemptCountと実行時に取得した現在のmaxAttemptsを正本にする。
 */
export const DAILY_CONTENT_QUEUE_TRANSPORT_ATTEMPTS = 10;

const ACTIVE_JOB_STATES = new Set([
  'active',
  'waiting',
  'delayed',
  'prioritized',
  'waiting-children',
]);

/**
 * DB上でretryingへ戻した配信を、BullMQ上の古いfailed/completed Jobに阻害されず再投入する。
 * 実行中・待機中・delayedのJobは既存Jobへ処理を任せ、二重enqueueを避ける。
 */
export function resolveDailyContentQueueJobDisposition(
  state: string | null | undefined,
): DailyContentQueueJobDisposition {
  if (!state || state === 'unknown') return 'enqueue';
  if (state === 'failed' || state === 'completed') return 'replace';
  if (ACTIVE_JOB_STATES.has(state)) return 'keep';
  return 'keep';
}

/**
 * attemptCountは「このdeliveryで既に開始した総配信試行回数」。
 * 新しいDiscord publishを開始してよいかを現在のmaxAttemptsだけで判定する。
 */
export function canStartDailyContentDeliveryAttempt(
  attemptCount: number,
  maxAttempts: number,
): boolean {
  return normalizeAttemptCount(attemptCount) < normalizeMaxAttempts(maxAttempts);
}

/**
 * 1回の配信試行が失敗した後に、Domain retryを予約してよいかを判定する。
 * BullMQ attemptsMadeはJob再作成でresetされるため、この判定には使用しない。
 */
export function shouldRetryDailyContentDelivery(
  attemptCountAfterAttempt: number,
  maxAttempts: number,
  retryable: boolean,
): boolean {
  return (
    retryable &&
    normalizeAttemptCount(attemptCountAfterAttempt) < normalizeMaxAttempts(maxAttempts)
  );
}

/**
 * retry delayもdelivery全体の総試行回数から計算し、BullMQ Jobの再作成でbackoffがresetされないようにする。
 */
export function resolveDailyContentRetryDelayMs(
  attemptCountAfterAttempt: number,
  baseDelayMs: number,
): number {
  const normalizedBaseDelay = Number.isFinite(baseDelayMs) ? Math.max(0, baseDelayMs) : 0;
  const exponent = Math.max(0, normalizeAttemptCount(attemptCountAfterAttempt) - 1);
  return normalizedBaseDelay * 2 ** exponent;
}

export function normalizeDailyContentScanIntervalSeconds(value: unknown): number {
  if (typeof value !== 'string' || !value.trim()) return 30;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 30;
  return Math.min(300, Math.max(10, parsed));
}

export function redisReconnectDelay(attempt: number): number {
  const normalizedAttempt = Number.isFinite(attempt) ? Math.max(1, Math.floor(attempt)) : 1;
  return Math.min(30_000, normalizedAttempt * 500);
}

function normalizeAttemptCount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function normalizeMaxAttempts(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(
    DAILY_CONTENT_QUEUE_TRANSPORT_ATTEMPTS,
    Math.max(1, Math.floor(value)),
  );
}
