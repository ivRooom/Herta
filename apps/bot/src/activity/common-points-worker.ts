import { createHash } from 'node:crypto';
import {
  leaseCommonPointsEvents,
  settleCommonPointsEvent,
  getCommonPointsDeliveryHealth,
  type PrismaClient,
  type LeasedCommonPointsEvent,
  type CommonPointsDeliveryOutcome,
} from '@herta/db';
import {
  buildCommonPointsRequest,
  resolveCommonPointsConfig,
  type CommonPointsConfig,
} from '@herta/shared/common-points';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const fields = [
  'amount',
  'discordUserId',
  'earningId',
  'epoch',
  'guildId',
  'occurredAt',
  'ruleVersion',
];
const retry = (attempts: number, code: string, minimum = 5): CommonPointsDeliveryOutcome => ({
  state: 'pending',
  code,
  delaySeconds: Math.min(3600, Math.max(minimum, 5 * 2 ** Math.min(10, Math.max(0, attempts - 1)))),
});
const quarantine = (code: string): CommonPointsDeliveryOutcome => ({
  state: 'quarantined',
  code,
  delaySeconds: 3600,
});

async function boundedJson(response: Response): Promise<Record<string, unknown> | null> {
  if (Number(response.headers.get('content-length') ?? 0) > 8192) {
    await response.body?.cancel();
    return null;
  }
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    length += next.value.byteLength;
    if (length > 8192) {
      await reader.cancel();
      return null;
    }
    chunks.push(next.value);
  }
  try {
    const value: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)),
    );
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Same stored event/body on every attempt. This function never marks DB state. */
export async function deliverCommonPointsEvent(
  config: CommonPointsConfig,
  event: LeasedCommonPointsEvent,
  fetcher: typeof fetch = fetch,
): Promise<CommonPointsDeliveryOutcome> {
  try {
    if (
      !uuid.test(event.id) ||
      Buffer.byteLength(event.body, 'utf8') > 8192 ||
      createHash('sha256').update(event.body).digest('hex') !== event.bodySha256
    )
      return quarantine('invalid_local_payload');
    const value: unknown = JSON.parse(event.body);
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return quarantine('invalid_local_payload');
    const body = value as Record<string, unknown>;
    const at = typeof body.occurredAt === 'string' ? Date.parse(body.occurredAt) : NaN;
    if (
      Object.keys(body).sort().join('|') !== fields.join('|') ||
      body.guildId !== config.guildId ||
      typeof body.discordUserId !== 'string' ||
      !/^[0-9]{17,20}$/.test(body.discordUserId) ||
      !Number.isSafeInteger(body.amount) ||
      (body.amount as number) < 1 ||
      (body.amount as number) > 1_000_000 ||
      typeof body.earningId !== 'string' ||
      !/^[a-zA-Z0-9:_.-]{1,160}$/.test(body.earningId) ||
      typeof body.epoch !== 'string' ||
      !uuid.test(body.epoch) ||
      typeof body.ruleVersion !== 'string' ||
      !/^[a-f0-9]{64}$/.test(body.ruleVersion) ||
      !Number.isFinite(at) ||
      new Date(at).toISOString() !== body.occurredAt
    )
      return quarantine('invalid_local_payload');
  } catch {
    return quarantine('invalid_local_payload');
  }
  try {
    const response = await fetcher(
      buildCommonPointsRequest(config, '/v1/points/herta/earn', event.body, event.id),
    );
    const value = await boundedJson(response);
    if (response.status === 200 || response.status === 201) {
      const account = value?.account as Record<string, unknown> | undefined;
      if (
        value?.status === 'ok' &&
        (value.mode === 'created' || value.mode === 'idempotent') &&
        [value.transactionId, value.userId].every(
          (v) => typeof v === 'string' && v.length > 0 && v.length <= 160,
        ) &&
        account &&
        [account.balance, account.lifetimeEarned, account.lifetimeSpent].every(
          (v) => Number.isSafeInteger(v) && (v as number) >= 0,
        )
      )
        return {
          state: 'acked',
          transactionId: value.transactionId as string,
          userId: value.userId as string,
        };
      return retry(event.attempts, 'invalid_ack', 60);
    }
    if (
      response.status === 409 &&
      ['event_payload_conflict', 'invalid_cutover_baseline', 'cutover_epoch_conflict'].includes(
        value?.error as string,
      )
    )
      return quarantine(value!.error as string);
    if ([400, 413, 422].includes(response.status))
      return quarantine(`receiver_http_${response.status}`);
    if ([401, 403].includes(response.status))
      return retry(event.attempts, 'service_auth_rejected', 300);
    return retry(
      event.attempts,
      `receiver_http_${response.status}`,
      response.status === 409 ? 60 : 5,
    );
  } catch {
    return retry(event.attempts, 'transport_failure');
  }
}

export async function runCommonPointsDeliveryBatch(
  prisma: PrismaClient,
  config: CommonPointsConfig,
  fetcher: typeof fetch = fetch,
) {
  const events = await leaseCommonPointsEvents(prisma, config.guildId, 5);
  const result = {
    leased: events.length,
    acked: 0,
    pending: 0,
    quarantined: 0,
    leaseLost: 0,
    failed: 0,
  };
  await Promise.all(
    events.map(async (event) => {
      try {
        const outcome = await deliverCommonPointsEvent(config, event, fetcher);
        if (!(await settleCommonPointsEvent(prisma, event, outcome))) result.leaseLost++;
        else result[outcome.state]++;
      } catch {
        result.failed++;
      } // Retain lease; expiry safely resumes after DB recovery.
    }),
  );
  return result;
}

/** No overlap, no external notifications, no secret/ID/body/error logging. */
export function startCommonPointsOutboxWorker(
  prisma: PrismaClient,
  logger: { warn: (value: unknown, message: string) => void },
  env: Partial<Record<string, string | undefined>> = process.env,
): () => Promise<void> {
  const config = resolveCommonPointsConfig(env);
  if (!config) return async () => {};
  let stopped = false,
    timer: ReturnType<typeof setTimeout> | undefined,
    inflight: Promise<void> | undefined;
  let lastWarningAt = Number.NEGATIVE_INFINITY;
  const warn = (value: unknown, message: string) => {
    const now = Date.now();
    if (now - lastWarningAt >= 60_000) {
      lastWarningAt = now;
      logger.warn(value, message);
    }
  };
  const cycle = async () => {
    try {
      const delivery = await runCommonPointsDeliveryBatch(prisma, config);
      const health = await getCommonPointsDeliveryHealth(prisma, config.guildId);
      if (delivery.failed || health.quarantined || health.oldestPendingSeconds > 300)
        warn({ delivery, health }, 'Common points delivery needs attention');
    } catch {
      warn({ code: 'common_points_cycle_failed' }, 'Common points delivery will retry');
    } finally {
      if (!stopped) {
        timer = setTimeout(() => {
          inflight = cycle();
        }, 5000);
        timer.unref();
      }
    }
  };
  inflight = cycle();
  return async () => {
    stopped = true;
    clearTimeout(timer);
    await inflight;
  };
}
