export const BIRTHDAY_CARD_PRESETS = [
  {
    id: 'herta-night-board',
    label: 'Herta Night Board',
    assetFile: 'herta-night-board.webp',
    textColor: '#f7f2ff',
    textStroke: '#34255e',
  },
  {
    id: 'herta-lavender-tea',
    label: 'Herta Lavender Tea',
    assetFile: 'herta-lavender-tea.webp',
    textColor: '#5d3d86',
    textStroke: '#fffaff',
  },
  {
    id: 'herta-lavender-gifts',
    label: 'Herta Lavender Gifts',
    assetFile: 'herta-lavender-gifts.webp',
    textColor: '#5d3d86',
    textStroke: '#fffaff',
  },
] as const;

export const BIRTHDAY_CARD_ASSET_MAX_COUNT = 24;
export const BIRTHDAY_CARD_ASSET_ID_PATTERN =
  '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
const BIRTHDAY_CARD_ASSET_ID_REGEX = new RegExp(BIRTHDAY_CARD_ASSET_ID_PATTERN, 'i');

export type BirthdayCardPresetId = (typeof BIRTHDAY_CARD_PRESETS)[number]['id'];
export type BirthdayCardBackgroundSource = 'preset' | 'custom' | 'asset';

export const BIRTHDAY_CARD_CONFIG_FIELD_KEYS = [
  'birthdayCardEnabled',
  'birthdayCardBackgroundSource',
  'birthdayCardAssetId',
  'birthdayCardPreset',
  'birthdayCardShowName',
  'birthdayCardShowAvatar',
  'birthdayCardShowBirthday',
  'birthdayCardShowAge',
  'birthdayCardAvatarX',
  'birthdayCardAvatarY',
  'birthdayCardAvatarSize',
  'birthdayCardNameX',
  'birthdayCardNameY',
  'birthdayCardNameSize',
  'birthdayCardBirthdayX',
  'birthdayCardBirthdayY',
  'birthdayCardBirthdaySize',
  'birthdayCardAgeX',
  'birthdayCardAgeY',
  'birthdayCardAgeSize',
] as const;

export type BirthdayCardConfigFieldKey = (typeof BIRTHDAY_CARD_CONFIG_FIELD_KEYS)[number];

export interface BirthdayCardConfig {
  birthdayCardEnabled: boolean;
  birthdayCardBackgroundSource: BirthdayCardBackgroundSource;
  birthdayCardAssetId: string | null;
  birthdayCardPreset: BirthdayCardPresetId;
  birthdayCardShowName: boolean;
  birthdayCardShowAvatar: boolean;
  birthdayCardShowBirthday: boolean;
  birthdayCardShowAge: boolean;
  birthdayCardAvatarX: number;
  birthdayCardAvatarY: number;
  birthdayCardAvatarSize: number;
  birthdayCardNameX: number;
  birthdayCardNameY: number;
  birthdayCardNameSize: number;
  birthdayCardBirthdayX: number;
  birthdayCardBirthdayY: number;
  birthdayCardBirthdaySize: number;
  birthdayCardAgeX: number;
  birthdayCardAgeY: number;
  birthdayCardAgeSize: number;
}

export const DEFAULT_BIRTHDAY_CARD_CONFIG: BirthdayCardConfig = {
  birthdayCardEnabled: false,
  birthdayCardBackgroundSource: 'preset',
  birthdayCardAssetId: null,
  birthdayCardPreset: 'herta-lavender-tea',
  birthdayCardShowName: true,
  birthdayCardShowAvatar: true,
  birthdayCardShowBirthday: true,
  birthdayCardShowAge: true,
  birthdayCardAvatarX: 74,
  birthdayCardAvatarY: 30,
  birthdayCardAvatarSize: 16,
  birthdayCardNameX: 74,
  birthdayCardNameY: 54,
  birthdayCardNameSize: 58,
  birthdayCardBirthdayX: 74,
  birthdayCardBirthdayY: 65,
  birthdayCardBirthdaySize: 38,
  birthdayCardAgeX: 74,
  birthdayCardAgeY: 75,
  birthdayCardAgeSize: 36,
};

export function normalizeBirthdayCardConfig(value: unknown): BirthdayCardConfig {
  const source = isRecord(value) ? value : {};
  const preset = BIRTHDAY_CARD_PRESETS.some((item) => item.id === source.birthdayCardPreset)
    ? (source.birthdayCardPreset as BirthdayCardPresetId)
    : DEFAULT_BIRTHDAY_CARD_CONFIG.birthdayCardPreset;
  const assetId = normalizeBirthdayCardAssetId(source.birthdayCardAssetId);
  const backgroundSource: BirthdayCardBackgroundSource =
    source.birthdayCardBackgroundSource === 'custom'
      ? 'custom'
      : source.birthdayCardBackgroundSource === 'asset' && assetId
        ? 'asset'
        : 'preset';

  return {
    birthdayCardEnabled: booleanValue(
      source.birthdayCardEnabled,
      DEFAULT_BIRTHDAY_CARD_CONFIG.birthdayCardEnabled,
    ),
    birthdayCardBackgroundSource: backgroundSource,
    birthdayCardAssetId: assetId,
    birthdayCardPreset: preset,
    birthdayCardShowName: booleanValue(
      source.birthdayCardShowName,
      DEFAULT_BIRTHDAY_CARD_CONFIG.birthdayCardShowName,
    ),
    birthdayCardShowAvatar: booleanValue(
      source.birthdayCardShowAvatar,
      DEFAULT_BIRTHDAY_CARD_CONFIG.birthdayCardShowAvatar,
    ),
    birthdayCardShowBirthday: booleanValue(
      source.birthdayCardShowBirthday,
      DEFAULT_BIRTHDAY_CARD_CONFIG.birthdayCardShowBirthday,
    ),
    birthdayCardShowAge: booleanValue(
      source.birthdayCardShowAge,
      DEFAULT_BIRTHDAY_CARD_CONFIG.birthdayCardShowAge,
    ),
    birthdayCardAvatarX: numberValue(
      source.birthdayCardAvatarX,
      DEFAULT_BIRTHDAY_CARD_CONFIG.birthdayCardAvatarX,
      0,
      100,
    ),
    birthdayCardAvatarY: numberValue(
      source.birthdayCardAvatarY,
      DEFAULT_BIRTHDAY_CARD_CONFIG.birthdayCardAvatarY,
      0,
      100,
    ),
    birthdayCardAvatarSize: numberValue(
      source.birthdayCardAvatarSize,
      DEFAULT_BIRTHDAY_CARD_CONFIG.birthdayCardAvatarSize,
      6,
      30,
    ),
    birthdayCardNameX: numberValue(
      source.birthdayCardNameX,
      DEFAULT_BIRTHDAY_CARD_CONFIG.birthdayCardNameX,
      0,
      100,
    ),
    birthdayCardNameY: numberValue(
      source.birthdayCardNameY,
      DEFAULT_BIRTHDAY_CARD_CONFIG.birthdayCardNameY,
      0,
      100,
    ),
    birthdayCardNameSize: numberValue(
      source.birthdayCardNameSize,
      DEFAULT_BIRTHDAY_CARD_CONFIG.birthdayCardNameSize,
      20,
      96,
    ),
    birthdayCardBirthdayX: numberValue(
      source.birthdayCardBirthdayX,
      DEFAULT_BIRTHDAY_CARD_CONFIG.birthdayCardBirthdayX,
      0,
      100,
    ),
    birthdayCardBirthdayY: numberValue(
      source.birthdayCardBirthdayY,
      DEFAULT_BIRTHDAY_CARD_CONFIG.birthdayCardBirthdayY,
      0,
      100,
    ),
    birthdayCardBirthdaySize: numberValue(
      source.birthdayCardBirthdaySize,
      DEFAULT_BIRTHDAY_CARD_CONFIG.birthdayCardBirthdaySize,
      16,
      72,
    ),
    birthdayCardAgeX: numberValue(
      source.birthdayCardAgeX,
      DEFAULT_BIRTHDAY_CARD_CONFIG.birthdayCardAgeX,
      0,
      100,
    ),
    birthdayCardAgeY: numberValue(
      source.birthdayCardAgeY,
      DEFAULT_BIRTHDAY_CARD_CONFIG.birthdayCardAgeY,
      0,
      100,
    ),
    birthdayCardAgeSize: numberValue(
      source.birthdayCardAgeSize,
      DEFAULT_BIRTHDAY_CARD_CONFIG.birthdayCardAgeSize,
      16,
      72,
    ),
  };
}

export function birthdayCardPreset(id: BirthdayCardPresetId) {
  return BIRTHDAY_CARD_PRESETS.find((preset) => preset.id === id) ?? BIRTHDAY_CARD_PRESETS[0];
}

export function normalizeBirthdayCardAssetId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return BIRTHDAY_CARD_ASSET_ID_REGEX.test(normalized) ? normalized.toLowerCase() : null;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function numberValue(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
