import {
  BIRTHDAY_CARD_PRESETS,
  inspectBirthdayCardBackgroundImage,
  type BirthdayCardBackgroundContentType,
} from '@herta/shared';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const PRESET_ASSET_FILES = new Set(BIRTHDAY_CARD_PRESETS.map((preset) => preset.assetFile));

export interface BirthdayCardPresetAsset {
  bytes: Buffer;
  contentType: BirthdayCardBackgroundContentType;
}

export function isBirthdayCardPresetAssetFile(asset: string): boolean {
  return PRESET_ASSET_FILES.has(asset as (typeof BIRTHDAY_CARD_PRESETS)[number]['assetFile']);
}

export function birthdayCardPresetAssetPathCandidates(cwd: string, asset: string): string[] {
  if (!isBirthdayCardPresetAssetFile(asset)) return [];

  return [
    path.resolve(cwd, 'public/birthday-card-presets', asset),
    path.resolve(cwd, 'apps/studio/public/birthday-card-presets', asset),
    path.resolve(
      cwd,
      'apps/studio/.next/standalone/apps/studio/public/birthday-card-presets',
      asset,
    ),
  ];
}

export async function readBirthdayCardPresetAsset(
  asset: string,
  cwd = process.cwd(),
): Promise<BirthdayCardPresetAsset | null> {
  for (const candidate of birthdayCardPresetAssetPathCandidates(cwd, asset)) {
    let bytes: Buffer;
    try {
      bytes = await readFile(candidate);
    } catch {
      continue;
    }

    const image = inspectBirthdayCardBackgroundImage(bytes);
    if (!image || image.contentType !== 'image/webp') continue;
    return { bytes, contentType: image.contentType };
  }

  return null;
}
