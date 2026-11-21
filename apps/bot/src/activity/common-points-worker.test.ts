import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient, LeasedCommonPointsEvent } from '@herta/db';
import { deliverCommonPointsEvent, startCommonPointsOutboxWorker } from './common-points-worker.js';

const fixtures = JSON.parse(
  readFileSync(
    new URL('../../../../contracts/ivrm/common-points.v1.earn-fixtures.json', import.meta.url),
    'utf8',
  ),
) as {
  valid: Record<string, unknown>;
  invalid: Array<{ name: string; patch: Record<string, unknown> }>;
};
const config = { guildId: '100000000000000000', secret: 'synthetic-signing-key' };
const event = (value: unknown = fixtures.valid): LeasedCommonPointsEvent => {
  const body = JSON.stringify(value);
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    body,
    bodySha256: createHash('sha256').update(body).digest('hex'),
    attempts: 1,
    leaseToken: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  };
};
const ack = () =>
  new Response(
    JSON.stringify({
      status: 'ok',
      mode: 'created',
      transactionId: 'ptx-fixture',
      userId: 'canonical-fixture',
      account: { balance: 160, lifetimeEarned: 200, lifetimeSpent: 40 },
    }),
    { status: 201 },
  );

describe('durable common points sender', () => {
  it('retries exact bytes/event ID with a valid fresh signature and only ACKs a valid receipt', async () => {
    const value = event(),
      requests: Request[] = [];
    const fetcher: typeof fetch = async (input) => {
      const request = input as Request;
      requests.push(request);
      const timestamp = request.headers.get('x-ivrm-timestamp');
      const expected = createHmac('sha256', config.secret)
        .update(`${timestamp}.${value.id}.POST./v1/points/herta/earn.${value.body}`)
        .digest('hex');
      expect(request.headers.get('x-ivrm-signature')).toBe(expected);
      expect(request.headers.get('x-ivrm-event-id')).toBe(value.id);
      expect(await request.text()).toBe(value.body);
      expect(request.url).toBe('https://api.ivrm.jp/v1/points/herta/earn');
      expect(request.redirect).toBe('error');
      if (requests.length === 1) throw new Error('synthetic-timeout');
      return ack();
    };
    expect((await deliverCommonPointsEvent(config, value, fetcher)).state).toBe('pending');
    expect(await deliverCommonPointsEvent(config, value, fetcher)).toEqual({
      state: 'acked',
      transactionId: 'ptx-fixture',
      userId: 'canonical-fixture',
    });
  });

  for (const invalid of fixtures.invalid)
    it(`quarantines contract-invalid local event: ${invalid.name}`, async () => {
      const fetcher = vi.fn();
      expect(
        (
          await deliverCommonPointsEvent(
            config,
            event({ ...fixtures.valid, ...invalid.patch }),
            fetcher,
          )
        ).state,
      ).toBe('quarantined');
      expect(fetcher).not.toHaveBeenCalled();
    });

  it('retains unavailable/404/rate-limit/unlinked/auth failures with bounded retry, no attempt-drop', async () => {
    for (const status of [404, 429, 500, 503, 401, 403, 409]) {
      const value = event();
      value.attempts = 2_147_483_647;
      const outcome = await deliverCommonPointsEvent(
        config,
        value,
        async () =>
          new Response(JSON.stringify({ error: 'identity_or_baseline_unresolved' }), { status }),
      );
      expect(outcome.state).toBe('pending');
      if (outcome.state !== 'acked') expect(outcome.delaySeconds).toBeGreaterThanOrEqual(5);
      if (outcome.state !== 'acked') expect(outcome.delaySeconds).toBeLessThanOrEqual(3600);
    }
  });

  it('quarantines conflicting receipts and invalid epoch/payload, retains bytes for review', async () => {
    for (const error of [
      'event_payload_conflict',
      'invalid_cutover_baseline',
      'cutover_epoch_conflict',
    ]) {
      const value = event(),
        before = value.body;
      expect(
        (
          await deliverCommonPointsEvent(
            config,
            value,
            async () => new Response(JSON.stringify({ error }), { status: 409 }),
          )
        ).state,
      ).toBe('quarantined');
      expect(value.body).toBe(before);
    }
    expect(
      (
        await deliverCommonPointsEvent(
          config,
          event(),
          async () => new Response('{}', { status: 422 }),
        )
      ).state,
    ).toBe('quarantined');
  });

  it('does not acknowledge malformed/oversized success responses or corrupt stored bytes', async () => {
    for (const body of [
      '{}',
      JSON.stringify({
        status: 'ok',
        mode: 'created',
        transactionId: 'x',
        userId: 'u',
        account: { balance: -1 },
      }),
      'x'.repeat(8193),
    ]) {
      const outcome = await deliverCommonPointsEvent(
        config,
        event(),
        async () => new Response(body, { status: 200 }),
      );
      expect(outcome.state).toBe('pending');
    }
    const corrupt = event();
    corrupt.body += ' ';
    const fetcher = vi.fn();
    expect((await deliverCommonPointsEvent(config, corrupt, fetcher)).state).toBe('quarantined');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('disabled startup does not query DB, fetch API or log credentials', async () => {
    const prisma = { $queryRaw: vi.fn(), $transaction: vi.fn() } as unknown as PrismaClient;
    const logger = { warn: vi.fn() };
    await startCommonPointsOutboxWorker(prisma, logger, {})();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
