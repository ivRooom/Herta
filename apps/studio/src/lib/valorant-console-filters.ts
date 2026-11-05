/** URL-only VALORANT console filters: never accept arbitrary field names or Guild IDs. */
export const VALORANT_CONSOLE_MAPS = [
  'Ascent',
  'Bind',
  'Haven',
  'Split',
  'Icebox',
  'Breeze',
  'Fracture',
  'Pearl',
  'Lotus',
  'Sunset',
  'Abyss',
  'Corrode',
  'Summit',
] as const;

export type ValorantConsolePeriod = '7' | '30' | '90' | 'all';
export type ValorantConsoleMode = '' | 'RANDOM' | 'TACTICAL';
export type ValorantConsolePartySize = '' | '3' | '5';
export type ValorantConsoleFilters = {
  period: ValorantConsolePeriod;
  map: string;
  mode: ValorantConsoleMode;
  partySize: ValorantConsolePartySize;
};

export function parseValorantConsoleFilters(params: {
  period?: unknown;
  map?: unknown;
  mode?: unknown;
  partySize?: unknown;
}): ValorantConsoleFilters {
  const period =
    params.period === '7' ||
    params.period === '30' ||
    params.period === '90' ||
    params.period === 'all'
      ? params.period
      : '30';
  const map =
    typeof params.map === 'string' &&
    (VALORANT_CONSOLE_MAPS as readonly string[]).includes(params.map)
      ? params.map
      : '';
  const mode = params.mode === 'RANDOM' || params.mode === 'TACTICAL' ? params.mode : '';
  const partySize = params.partySize === '3' || params.partySize === '5' ? params.partySize : '';
  return { period, map, mode, partySize };
}

/** Only recorded agent assignments count toward a completed random pick's team size. */
export function valorantPickPartySize(result: unknown): number | null {
  if (!Array.isArray(result)) return null;
  const count = result.filter(
    (entry) =>
      typeof entry === 'object' &&
      entry !== null &&
      !Array.isArray(entry) &&
      typeof entry.agentId === 'string' &&
      entry.agentId.trim().length > 0,
  ).length;
  return count > 0 ? count : null;
}

export function matchesValorantPartySize(
  result: unknown,
  partySize: ValorantConsolePartySize,
): boolean {
  return partySize === '' || valorantPickPartySize(result) === Number(partySize);
}

/** Sliding UTC timestamps are applied to the indexed DB query before the 5,000-row cap. */
export function valorantConsoleSince(
  period: ValorantConsolePeriod,
  now: Date = new Date(),
): Date | null {
  if (period === 'all') return null;
  return new Date(now.getTime() - Number(period) * 24 * 60 * 60 * 1000);
}

/** Keep filters when the SSR history table moves to a different page. */
export function valorantConsoleHistoryQuery(filters: ValorantConsoleFilters, page: number): string {
  const params = new URLSearchParams();
  params.set('period', filters.period);
  if (filters.map) params.set('map', filters.map);
  if (filters.mode) params.set('mode', filters.mode);
  if (filters.partySize) params.set('partySize', filters.partySize);
  params.set('page', String(page));
  params.set('details', '1');
  return '?' + params.toString() + '#valorant-details';
}
