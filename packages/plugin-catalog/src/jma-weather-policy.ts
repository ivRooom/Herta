/**
 * Server-side allowlist mapping common Japanese city names to Japan Meteorological Agency (JMA)
 * area codes. A user's free-text location can never reach the JMA API directly — only a name that
 * resolves through this table does. Codes verified against https://www.jma.go.jp/bosai/ endpoints;
 * re-verify against the current area.json / amedastable.json before extending this table.
 */
export interface JmaAreaEntry {
  /** JMA forecast "office" area code (https://www.jma.go.jp/bosai/forecast/data/forecast/{officeCode}.json). */
  officeCode: string;
  /** JMA AMeDAS observation station code (https://www.jma.go.jp/bosai/amedas/const/amedastable.json). */
  amedasStationCode: string;
  /** Canonical Japanese display name used in grounding text. */
  displayName: string;
}

const JMA_AREA_TABLE: Record<string, JmaAreaEntry> = {
  東京: { officeCode: '130000', amedasStationCode: '44132', displayName: '東京' },
  大阪: { officeCode: '270000', amedasStationCode: '62078', displayName: '大阪' },
  名古屋: { officeCode: '230000', amedasStationCode: '51106', displayName: '名古屋' },
  札幌: { officeCode: '016000', amedasStationCode: '14163', displayName: '札幌' },
  仙台: { officeCode: '040000', amedasStationCode: '34392', displayName: '仙台' },
  広島: { officeCode: '340000', amedasStationCode: '82182', displayName: '広島' },
  福岡: { officeCode: '400000', amedasStationCode: '82402', displayName: '福岡' },
  那覇: { officeCode: '471000', amedasStationCode: '47662', displayName: '那覇' },
  横浜: { officeCode: '140000', amedasStationCode: '46106', displayName: '横浜' },
  京都: { officeCode: '260000', amedasStationCode: '61421', displayName: '京都' },
};

/** Aliases that normalize to a canonical key in {@link JMA_AREA_TABLE}. */
const JMA_AREA_ALIASES: Record<string, keyof typeof JMA_AREA_TABLE> = {
  東京都: '東京',
  大阪府: '大阪',
  名古屋市: '名古屋',
  札幌市: '札幌',
  仙台市: '仙台',
  広島市: '広島',
  福岡市: '福岡',
  那覇市: '那覇',
  横浜市: '横浜',
  京都府: '京都',
  京都市: '京都',
  沖縄: '那覇',
  神奈川: '横浜',
};

const WEATHER_QUERY_PATTERN =
  /天気|天候|気温|降水|雨(?:雲|量)?|雪(?:雲|量)?|気象(?:情報|観測|データ)?|weather|forecast|temperature/i;

/**
 * Best-effort, keyword-based detection of a weather question. False positives only cause a wasted
 * grounding lookup attempt (never a wrong answer, since the caller still falls back to declining
 * when no area resolves or the fetch fails); false negatives just skip grounding.
 */
export function isJmaWeatherQuery(input: string): boolean {
  return WEATHER_QUERY_PATTERN.test(input);
}

/**
 * Resolve a JMA area entry from free-text user input by checking whether any known city name or
 * alias appears as a substring. Returns null when no allowlisted location is found — the caller
 * must never fall back to an arbitrary or guessed area code.
 */
export function resolveJmaAreaFromText(input: string): JmaAreaEntry | null {
  for (const [alias, canonical] of Object.entries(JMA_AREA_ALIASES)) {
    // canonical is typed as a key of JMA_AREA_TABLE, so this lookup always hits.
    if (input.includes(alias)) return JMA_AREA_TABLE[canonical] as JmaAreaEntry;
  }
  for (const [name, entry] of Object.entries(JMA_AREA_TABLE)) {
    if (input.includes(name)) return entry;
  }
  return null;
}

export function listJmaAreaNames(): string[] {
  return Object.keys(JMA_AREA_TABLE);
}
