/**
 * Reviewed VALORANT patch/map metadata (2026-11-03 UTC).
 * This is OFFICIAL PATCH CONTEXT, not a licensed pick-rate/win-rate dataset.
 * The tactical lineups in valorant-maps.ts are curated Herta examples.
 * Update together with the official patch notes; never guess unknown metrics.
 */
export const VALORANT_META = {
  patchVersion: '13.09',
  rulesVersion: '13.09-v3-curated-20261103',
  patchPublishedAt: '2026-10-27',
  verifiedAt: '2026-11-03',
  mapRotationPatch: '13.08',
  mapRotationUpdatedAt: '2026-10-13',
  patchSource: 'https://playvalorant.com/ja-jp/news/game-updates/valorant-patch-notes-1309/',
  mapRotationSource: 'https://playvalorant.com/ja-jp/news/game-updates/valorant-patch-notes-13-08/',
  sourceType: 'official-patch-notes',
  compositionSourceType: 'herta-editorial-no-gameplay-stats',
  competitivePool: ['Abyss', 'Bind', 'Corrode', 'Haven', 'Lotus', 'Summit', 'Sunset'],
  agentChanges: [
    'Hush added in 13.09',
    'Clove Pick-Me-Up speed bonus reduced 15% to 10% in 13.09',
  ],
  statistics: {
    sampleSize: null,
    pickRate: null,
    winRate: null,
    rankTier: null,
    region: null,
    collectedAt: null,
  },
} as const;
