import { ModerationValidationError } from './config.js';

const activeTargetOperations = new Set<string>();
const targetOperationWaiters = new Map<string, Array<() => void>>();

export function beginModerationTargetOperation(guildId: string, targetUserId: string): () => void {
  const key = targetOperationKey(guildId, targetUserId);
  if (activeTargetOperations.has(key)) {
    throw new ModerationValidationError(
      '対象ユーザーに対する別のModeration操作が実行中です。完了後に再実行してください',
    );
  }

  activeTargetOperations.add(key);
  return createRelease(key);
}

/** 自動Moderation向け。先行操作がある場合は完了まで待ち、同じ対象の処理を直列化する。 */
export async function waitForModerationTargetOperation(
  guildId: string,
  targetUserId: string,
): Promise<() => void> {
  const key = targetOperationKey(guildId, targetUserId);
  if (!activeTargetOperations.has(key)) {
    activeTargetOperations.add(key);
    return createRelease(key);
  }

  await new Promise<void>((resolve) => {
    const waiters = targetOperationWaiters.get(key) ?? [];
    waiters.push(resolve);
    targetOperationWaiters.set(key, waiters);
  });
  return createRelease(key);
}

function createRelease(key: string): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;

    const waiters = targetOperationWaiters.get(key);
    const next = waiters?.shift();
    if (waiters?.length === 0) targetOperationWaiters.delete(key);
    if (next) {
      // active状態を維持したまま次の待機者へ所有権を移す。
      next();
      return;
    }
    activeTargetOperations.delete(key);
  };
}

function targetOperationKey(guildId: string, targetUserId: string): string {
  return `${guildId}:${targetUserId}`;
}

export function resetModerationTargetOperationsForTest(): void {
  activeTargetOperations.clear();
  targetOperationWaiters.clear();
}
