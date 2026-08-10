import { ModerationValidationError } from './config.js';

export type EditableModerationCaseStatus = 'active' | 'completed' | 'revoked';

export function normalizeEditableModerationCaseStatus(
  value: string | null,
): EditableModerationCaseStatus {
  if (value === 'active' || value === 'completed' || value === 'revoked') return value;
  throw new ModerationValidationError('Case状態はactive / completed / revokedから選択してください');
}
