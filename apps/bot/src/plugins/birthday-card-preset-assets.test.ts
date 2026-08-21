import { BIRTHDAY_CARD_PRESETS } from '@herta/shared';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

const SOURCE_DIR = path.dirname(fileURLToPath(import.meta.url));
const STUDIO_PRESET_DIR = path.resolve(SOURCE_DIR, '../../../studio/public/birthday-card-presets');
const BOT_PRESET_DIR = path.resolve(SOURCE_DIR, '../../assets/birthday-card-presets');

describe('Birthday Card preset assets', () => {
  for (const preset of BIRTHDAY_CARD_PRESETS) {
    it(`${preset.assetFile} is identical in Studio and Bot and decodes as 1672x941 WebP`, async () => {
      const [studioBytes, botBytes] = await Promise.all([
        readFile(path.join(STUDIO_PRESET_DIR, preset.assetFile)),
        readFile(path.join(BOT_PRESET_DIR, preset.assetFile)),
      ]);

      expect(botBytes.equals(studioBytes)).toBe(true);

      const image = sharp(studioBytes);
      const metadata = await image.metadata();
      expect(metadata.format).toBe('webp');
      expect(metadata.width).toBe(1672);
      expect(metadata.height).toBe(941);
      await expect(image.raw().toBuffer()).resolves.toBeInstanceOf(Buffer);
    });
  }
});
