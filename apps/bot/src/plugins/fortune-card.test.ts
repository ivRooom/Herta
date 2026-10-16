import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { createDailyFortune, EMPTY_FORTUNE_PROFILE } from './fortune-core.js';
import { fortuneCardHeading, renderFortuneCard } from './fortune-card.js';
describe('fortune card', () => {
  it('reserves the illustration area for full-width names including the complete suffix', () => {
    const heading = fortuneCardHeading('あ'.repeat(32));
    expect(heading).toContain('… さんの今日の運勢');
    expect(Array.from(heading).length * 32 + 76).toBeLessThan(790);
    expect(fortuneCardHeading('Herta')).toBe('Herta さんの今日の運勢');
  });
  it('renders a valid PNG with hostile/long display names and no raw profile text', async () => {
    const result = createDailyFortune('g', 'u', '2026-10-16', {
      ...EMPTY_FORTUNE_PROFILE,
      birthday: '2000-10-16',
      bloodType: 'AB',
      mbti: 'INFP-T',
    });
    const buffer = await renderFortuneCard(result, '<svg>&"'.repeat(30), 'INFP-T');
    expect(await sharp(buffer).metadata()).toMatchObject({
      width: 1200,
      height: 1420,
      format: 'png',
    });
    expect(buffer.byteLength).toBeLessThan(8 * 1024 * 1024);
  });
});
