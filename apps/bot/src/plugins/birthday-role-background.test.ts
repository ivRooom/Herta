import { describe, expect, it } from 'vitest';
import { normalizeBirthdayRoleConfig } from './birthday-role.js';

describe('Birthday Card background source config', () => {
  it('既存設定では組み込みpresetを既定値として維持する', () => {
    expect(normalizeBirthdayRoleConfig({}).birthdayCardBackgroundSource).toBe('preset');
  });

  it('customだけを許可し未知値はpresetへfallbackする', () => {
    expect(
      normalizeBirthdayRoleConfig({ birthdayCardBackgroundSource: 'custom' })
        .birthdayCardBackgroundSource,
    ).toBe('custom');
    expect(
      normalizeBirthdayRoleConfig({ birthdayCardBackgroundSource: 'https://example.com/image.png' })
        .birthdayCardBackgroundSource,
    ).toBe('preset');
  });
});
