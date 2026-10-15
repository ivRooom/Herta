import { MBTI_TYPE_KEYS } from '@herta/plugin-catalog';

const DISCORD_ID_PATTERN = /^\d{17,20}$/u;

export interface MbtiRoleReconciliationInput {
  discordUserId: string;
  resultType: string;
}

export function parseMbtiRoleReconciliationInput(
  value: unknown,
): MbtiRoleReconciliationInput | null {
  if (!isRecord(value)) return null;
  const discordUserId = typeof value.discordUserId === 'string' ? value.discordUserId.trim() : '';
  const resultType = typeof value.resultType === 'string' ? value.resultType.trim() : '';
  if (!DISCORD_ID_PATTERN.test(discordUserId)) return null;
  if (!(MBTI_TYPE_KEYS as readonly string[]).includes(resultType)) return null;
  return { discordUserId, resultType };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
