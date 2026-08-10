import { ModerationValidationError } from './config.js';

const activeTargetOperations = new Set<string>();

export function beginModerationTargetOperation(guildId: string, targetUserId: string): () => void {
  const key = `${guildId}:${targetUserId}`;
  if (activeTargetOperations.has(key)) {
    throw new ModerationValidationError(
      '対象ユーザーに対する別のModeration操作が実行中です。完了後に再実行してください',
    );
  }

  activeTargetOperations.add(key);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeTargetOperations.delete(key);
  };
}

export function resetModerationTargetOperationsForTest(): void {
  activeTargetOperations.clear();
}
