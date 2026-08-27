import { describe, expect, it } from 'vitest';
import {
  AiArtifactValidationError,
  isPythonCodeArtifactRequest,
  resolveAiArtifactConfig,
  resolveAiArtifactIntent,
  validateAiArtifactBatch,
  type AiArtifactDraft,
} from './ai-artifact.js';

const config = resolveAiArtifactConfig({
  HERTA_AI_ARTIFACT_MAX_BYTES: '1024',
  HERTA_AI_ARTIFACT_MAX_FILES: '2',
});

function pythonDraft(overrides: Partial<AiArtifactDraft> = {}): AiArtifactDraft {
  return {
    filename: 'fizzbuzz.py',
    mimeType: 'text/x-python',
    content: 'for i in range(1, 101):\n    print(i)\n',
    kind: 'code',
    ...overrides,
  };
}

describe('AI artifact intent', () => {
  it('「Pythonコードを書いて」はcode_artifactでexecutionへrouteしない', () => {
    expect(resolveAiArtifactIntent('PythonでFizzBuzzのコードを書いて')).toBe('code_artifact');
  });

  it('明示的な実行依頼だけcode_executionになる', () => {
    expect(resolveAiArtifactIntent('このPythonコードを実行してCSVに変換して')).toBe(
      'code_execution',
    );
    expect(resolveAiArtifactIntent('この疑似コードをPythonコードに変換して')).toBe(
      'code_artifact',
    );
  });

  it('短い言語名を通常単語のsubstringとして誤検知しない', () => {
    expect(resolveAiArtifactIntent('Create a happy birthday message')).toBe('chat');
    expect(resolveAiArtifactIntent('Write a trust policy')).toBe('chat');
  });

  it('非Python言語もcode_artifact intentとして識別しruntime側でcapability判定できる', () => {
    expect(resolveAiArtifactIntent('Write a JavaScript program')).toBe('code_artifact');
    expect(isPythonCodeArtifactRequest('Write a JavaScript program')).toBe(false);
    expect(isPythonCodeArtifactRequest('Pythonコードを書いて')).toBe(true);
  });

  it('generic file artifactとimage generationをtyped intentへ分離する', () => {
    expect(resolveAiArtifactIntent('READMEをMarkdownで作って')).toBe('file_artifact');
    expect(resolveAiArtifactIntent('猫の画像を生成して')).toBe('image_generation');
  });
});

describe('AI artifact validation', () => {
  it('.py artifactを完全なbytesとして保持しsizeを実contentから計算する', () => {
    const source = 'print("hello")\nprint("world")\n';
    const [artifact] = validateAiArtifactBatch([pythonDraft({ content: source })], config);

    expect(artifact?.filename).toBe('fizzbuzz.py');
    expect(artifact?.mimeType).toBe('text/x-python');
    expect(new TextDecoder().decode(artifact?.bytes)).toBe(source);
    expect(artifact?.size).toBe(new TextEncoder().encode(source).byteLength);
  });

  it.each([
    '..' + '/x.py',
    '..' + '/../etc/passwd.py',
    'foo/bar.py',
    'foo\\bar.py',
    'C:' + '\\temp\\x.py',
  ])('path traversal / separator filenameをrejectする: %s', (filename) => {
    expect(() => validateAiArtifactBatch([pythonDraft({ filename })], config)).toThrowError(
      AiArtifactValidationError,
    );
  });

  it('unsupported extensionをrejectする', () => {
    expect(() =>
      validateAiArtifactBatch(
        [pythonDraft({ filename: 'script.js', mimeType: 'text/javascript' })],
        config,
      ),
    ).toThrowError(/unsupported_extension/);
  });

  it('oversized artifactをrejectする', () => {
    expect(() =>
      validateAiArtifactBatch([pythonDraft({ content: 'x'.repeat(1025) })], config),
    ).toThrowError(/artifact_too_large/);
  });

  it('max file count超過をrejectする', () => {
    expect(() =>
      validateAiArtifactBatch(
        [
          pythonDraft(),
          pythonDraft({ filename: 'second.py' }),
          pythonDraft({ filename: 'third.py' }),
        ],
        config,
      ),
    ).toThrowError(/too_many_files/);
  });

  it('declared MIMEとextensionの不一致をrejectする', () => {
    expect(() =>
      validateAiArtifactBatch([pythonDraft({ mimeType: 'text/plain' })], config),
    ).toThrowError(/mime_extension_mismatch/);
  });

  it.each([
    ['README.md', 'text/markdown', 'document'],
    ['notes.txt', 'text/plain', 'document'],
    ['data.json', 'application/json', 'data'],
    ['config.yaml', 'application/yaml', 'data'],
    ['config.yml', 'application/yaml', 'data'],
    ['rows.csv', 'text/csv', 'data'],
  ] as const)('generic file allowlistを同じpipelineで受理する: %s', (filename, mimeType, kind) => {
    const [artifact] = validateAiArtifactBatch(
      [{ filename, mimeType, content: 'content', kind }],
      config,
    );
    expect(artifact?.filename).toBe(filename);
  });
});
