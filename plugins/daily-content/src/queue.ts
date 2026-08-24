export type DailyContentQueueJobDisposition = 'enqueue' | 'keep' | 'replace';

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

export function canStartDailyContentDeliveryAttempt(
  attemptCount: number,
  maxAttempts: number,
): boolean {
  return attemptCount < maxAttempts;
}

export function shouldRetryDailyContentDelivery(
  attemptCountAfterAttempt: number,
  maxAttempts: number,
  retryable: boolean,
): boolean {
  return retryable && attemptCountAfterAttempt < maxAttempts;
}

export function resolveDailyContentRetryDelayMs(
  attemptCountAfterAttempt: number,
  baseDelayMs: number,
): number {
  return baseDelayMs * 2 ** Math.max(0, attemptCountAfterAttempt - 1);
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
