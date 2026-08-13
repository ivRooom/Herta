import { describe, expect, it, vi } from 'vitest';
import { createXpRoleSweepEvent } from '@herta/shared';
import { XpRoleSweepSubscriber } from './xp-role-sweep-events.js';

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as never;

function wait(milliseconds = 10): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

describe('XpRoleSweepSubscriber', () => {
  it('同一イベントを重複実行しない', async () => {
    const sweep = vi.fn(async () => undefined);
    const subscriber = new XpRoleSweepSubscriber(sweep, logger);
    const event = createXpRoleSweepEvent({
      requestId: '11111111-1111-4111-8111-111111111111',
      guildId: '12345678901234567',
      actorId: '22345678901234567',
      reason: 'manual_repair',
      occurredAt: new Date('2026-08-13T00:00:00.000Z'),
    });

    subscriber.handleMessage(JSON.stringify(event));
    subscriber.handleMessage(JSON.stringify(event));
    await wait();

    expect(sweep).toHaveBeenCalledTimes(1);
    expect(sweep).toHaveBeenCalledWith(event);
    await subscriber.stop();
  });

  it('同一Guildのイベントを直列実行する', async () => {
    const order: string[] = [];
    const sweep = vi.fn(async (event: { requestId: string }) => {
      order.push(`start:${event.requestId}`);
      await wait(2);
      order.push(`end:${event.requestId}`);
    });
    const subscriber = new XpRoleSweepSubscriber(sweep as never, logger);

    for (const requestId of [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ]) {
      subscriber.handleMessage(
        JSON.stringify(
          createXpRoleSweepEvent({
            requestId,
            guildId: '12345678901234567',
            actorId: '22345678901234567',
            reason: 'manual_repair',
          }),
        ),
      );
    }
    await wait(20);

    expect(order).toEqual([
      'start:11111111-1111-4111-8111-111111111111',
      'end:11111111-1111-4111-8111-111111111111',
      'start:22222222-2222-4222-8222-222222222222',
      'end:22222222-2222-4222-8222-222222222222',
    ]);
    await subscriber.stop();
  });

  it('不正なイベントを破棄する', async () => {
    const sweep = vi.fn(async () => undefined);
    const subscriber = new XpRoleSweepSubscriber(sweep, logger);

    subscriber.handleMessage('{"schemaVersion":1,"guildId":"bad"}');
    await wait();

    expect(sweep).not.toHaveBeenCalled();
    await subscriber.stop();
  });

  it('UUIDではないrequestIdを持つイベントを破棄する', async () => {
    const sweep = vi.fn(async () => undefined);
    const subscriber = new XpRoleSweepSubscriber(sweep, logger);
    const event = createXpRoleSweepEvent({
      requestId: '11111111-1111-4111-8111-111111111111',
      guildId: '12345678901234567',
      actorId: '22345678901234567',
      reason: 'manual_repair',
    });

    subscriber.handleMessage(JSON.stringify({ ...event, requestId: 'not-a-uuid' }));
    await wait();

    expect(sweep).not.toHaveBeenCalled();
    await subscriber.stop();
  });
});
