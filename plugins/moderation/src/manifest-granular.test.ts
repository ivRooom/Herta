import { describe, expect, it } from 'vitest';
import { moderationManifest } from './manifest.js';

describe('Moderation granular manifest', () => {
  it('既存schemaを維持したまま連投・重複投稿の詳細設定を公開する', () => {
    const properties = moderationManifest.configSchema.properties as Record<string, unknown>;

    expect(moderationManifest.version).toBe('2.5.0');
    expect(properties).toHaveProperty('autoMentionLimit');
    expect(properties).toHaveProperty('autoBurstScope');
    expect(properties).toHaveProperty('autoDuplicateScope');
    expect(properties).toHaveProperty('autoDuplicateMinimumLength');
  });
});
