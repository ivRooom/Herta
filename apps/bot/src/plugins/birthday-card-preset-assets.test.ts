import { BIRTHDAY_CARD_PRESETS } from '@herta/shared';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

const PRESET_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../studio/public/birthday-card-presets',
);

describe('Birthday Card preset assets', () => {
  for (const preset of BIRTHDAY_CARD_PRESETS) {
    it(`${preset.assetFile} is a decodable 1672x941 WebP`, async () => {
      const bytes = await readFile(path.join(PRESET_DIR, preset.assetFile));
      const image = sharp(bytes);
      const metadata = await image.metadata();

      expect(metadata.format).toBe('webp');
      expect(metadata.width).toBe(1672);
      expect(metadata.height).toBe(941);
      await expect(image.raw().toBuffer()).resolves.toBeInstanceOf(Buffer);
    });
  }
});
