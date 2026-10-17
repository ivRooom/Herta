export function parseMemberMbtiLinkInput(
  value: unknown,
): { discordUserId: string; action: 'quiz' | 'result' } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).some((k) => !['discordUserId', 'action'].includes(k)) ||
    typeof v.discordUserId !== 'string' ||
    !/^\d{17,20}$/.test(v.discordUserId) ||
    (v.action !== 'quiz' && v.action !== 'result')
  )
    return null;
  return { discordUserId: v.discordUserId, action: v.action as 'quiz' | 'result' };
}
