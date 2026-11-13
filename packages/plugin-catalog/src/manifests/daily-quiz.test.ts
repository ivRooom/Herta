import { describe, expect, it } from 'vitest';
import { dailyQuizManifest } from './daily-quiz.js';

describe('dailyQuizManifest', () => {
  it('registers Daily Quiz as a settings-only catalog plugin (#887)', () => {
    expect(dailyQuizManifest.id).toBe('daily-quiz');
    expect(dailyQuizManifest.name).toBe('Daily Quiz');
    expect(dailyQuizManifest.permissions).toEqual([]);
    expect(dailyQuizManifest.commands).toEqual([]);
    expect(dailyQuizManifest.events).toEqual([]);
  });

  it('exposes only the participation and result card switches to Studio', () => {
    const schema = dailyQuizManifest.configSchema as {
      additionalProperties: boolean;
      properties: Record<string, { type: string; default: unknown }>;
      required: string[];
    };
    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties).sort()).toEqual([
      'participationEnabled',
      'resultCardEnabled',
    ]);
    expect(schema.required.sort()).toEqual(['participationEnabled', 'resultCardEnabled']);
    // Defaults stay ON so that creating the config in Studio does not by
    // itself change behaviour; the env kill switches remain authoritative.
    expect(schema.properties.participationEnabled).toMatchObject({
      type: 'boolean',
      default: true,
    });
    expect(schema.properties.resultCardEnabled).toMatchObject({ type: 'boolean', default: true });
  });
});
