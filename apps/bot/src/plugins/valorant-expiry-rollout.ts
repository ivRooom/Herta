/**
 * Safety boundary: never start public Discord edits without explicit opt-in
 * and a nonempty list of approved Guilds. Invalid entries fail closed.
 */
export function enabledValorantExpiryGuildIds(
  enabled: string | undefined,
  rawGuildIds: string | undefined,
): ReadonlySet<string> {
  if (enabled !== 'true' || !rawGuildIds) return new Set<string>();
  const ids = rawGuildIds.split(',').map((id) => id.trim());
  if (ids.length === 0 || ids.some((id) => !/^\d{17,20}$/.test(id))) {
    return new Set<string>();
  }
  return new Set(ids);
}
