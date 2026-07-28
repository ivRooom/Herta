import { DailyContentValidationError } from './config.js';
import type {
  DailyContentDeliveryRecord,
  DailyContentPrismaClient,
  DailyContentTransactionClient,
} from './service.js';

export async function retryDailyContentDelivery(
  prisma: DailyContentPrismaClient,
  input: { guildId: string; deliveryId: string; actorId: string; now?: Date },
): Promise<DailyContentDeliveryRecord | null> {
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    await lockDelivery(tx, input.deliveryId);
    const delivery = await tx.dailyContentDelivery.findFirst({
      where: { id: input.deliveryId, guildId: input.guildId },
    });
    if (!delivery) return null;
    if (delivery.status !== 'failed' && delivery.status !== 'skipped') {
      throw new DailyContentValidationError('失敗またはスキップ済みの配信だけ再実行できます');
    }

    const updated = await tx.dailyContentDelivery.update({
      where: { id: delivery.id },
      data: {
        status: 'retrying',
        errorName: null,
        failedAt: null,
        nextAttemptAt: now,
      },
    });
    await tx.auditLog.create({
      data: {
        guildId: input.guildId,
        actorId: input.actorId,
        event: 'daily_content.retry',
        targetType: 'daily_content_delivery',
        targetId: delivery.id,
        metadata: { scheduleId: delivery.dailyContentId },
      },
    });
    return updated;
  });
}

async function lockDelivery(
  tx: DailyContentTransactionClient,
  deliveryId: string,
): Promise<void> {
  await tx.$queryRawUnsafe(
    'SELECT pg_advisory_xact_lock(hashtext($1))',
    `daily-content:delivery:${deliveryId}`,
  );
}
