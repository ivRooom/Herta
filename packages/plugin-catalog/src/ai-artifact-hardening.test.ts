import { describe, expect, it } from 'vitest';
import {
  AiArtifactConfigurationError,
  resolveAiArtifactConfig,
  resolveAiArtifactIntent,
} from './ai-artifact.js';

describe('AI artifact hardening', () => {
  it('明示的に実行しない依頼はcode_executionへ誤routeしない', () => {
    expect(resolveAiArtifactIntent('Pythonコードを書いて。実行はしないで')).toBe(
      'code_artifact',
    );
    expect(resolveAiArtifactIntent('Write Python code but do not execute it')).toBe(
      'code_artifact',
    );
  });

  it('artifact configはbounded defaultを使いinvalid overrideをfail closedする', () => {
    expect(resolveAiArtifactConfig({})).toEqual({ maxBytes: 512 * 1024, maxFiles: 3 });
    expect(() =>
      resolveAiArtifactConfig({ HERTA_AI_ARTIFACT_MAX_BYTES: '999999999' }),
    ).toThrowError(AiArtifactConfigurationError);
    expect(() => resolveAiArtifactConfig({ HERTA_AI_ARTIFACT_MAX_FILES: '0' })).toThrowError(
      AiArtifactConfigurationError,
    );
  });
});
