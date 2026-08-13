import { describe, expect, it, vi } from 'vitest';
import { createXpRoleReconciliationEvent } from '@herta/shared';
import { XpRoleReconciliationSubscriber } from './xp-role-reconciliation-events.js';

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as never;

function wait(milliseconds = 10): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

describe('XpRoleReconciliationSubscriber', () => {
  it('正しいイベントをdebounce後に1回だけ再同期する', async () => {
    const reconcile = vi.fn(async () => undefined);
    const subscriber = new XpRoleReconciliationSubscriber(reconcile, logger, 1);
    const event = createXpRoleReconciliationEvent({
      guildId: '12345678901234567',
      userId: '22345678901234567',
      occurredAt: new Date('2026-08-13T00:00:00.000Z'),
    });

    subscriber.handleMessage(JSON.stringify(event));
    subscriber.handleMessage(JSON.stringify(event));
    await wait();

    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(reconcile).toHaveBeenCalledWith('12345678901234567', '22345678901234567');
    await subscriber.stop();
  });

  it('不正なイベントを破棄する', async () => {
    const reconcile = vi.fn(async () => undefined);
    const subscriber = new XpRoleReconciliationSubscriber(reconcile, logger, 1);

    subscriber.handleMessage('{"schemaVersion":1,"guildId":"bad"}');
    await wait();

    expect(reconcile).not.toHaveBeenCalled();
    await subscriber.stop();
  });
});
