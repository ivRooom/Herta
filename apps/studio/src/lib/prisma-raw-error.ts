const MANAGED_ACCESS_NAME_CONSTRAINTS = [
  'studio_access_policies_guild_id_name_key',
  'studio_access_policies_guild_id_name_ci_key',
  'studio_access_groups_guild_id_name_key',
  'studio_access_groups_guild_id_name_ci_key',
] as const;

export function isPrismaRawUniqueViolation(error: unknown, constraintName?: string): boolean {
  if (!isRecord(error) || error.code !== 'P2010') return false;
  const meta = isRecord(error.meta) ? error.meta : null;
  if (meta?.code !== '23505') return false;

  const messages = [
    typeof error.message === 'string' ? error.message : '',
    typeof meta.message === 'string' ? meta.message : '',
  ];
  const constraints = constraintName ? [constraintName] : MANAGED_ACCESS_NAME_CONSTRAINTS;
  return constraints.some((constraint) => messages.some((message) => message.includes(constraint)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
