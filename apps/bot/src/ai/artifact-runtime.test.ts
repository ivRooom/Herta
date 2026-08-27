import type { AiGenerationResponse } from '@herta/plugin-catalog/ai-service';
import { describe, expect, it, vi } from 'vitest';
import { AiArtifactRuntime, AiArtifactRuntimeError } from './artifact-runtime.js';
import type { AiRuntimeGenerationRequest, AiRuntimeGenerationService } from './runtime-service.js';

function generationResponse(text: string): AiGenerationResponse {
  return {
    requestId: 'request-1',
    provider: 'openai',
    model: 'gpt-5.6-terra',
    text,
    usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
    estimatedCost: 0.0001,
  };
}

function serviceReturning(
  text: string,
  requests: AiRuntimeGenerationRequest[] = [],
): AiRuntimeGenerationService {
  return {
    generate: vi.fn(async (request: AiRuntimeGenerationRequest) => {
      requests.push(request);
      return generationResponse(text);
    }),
  };
}

const request = {
  input: 'PythonでFizzBuzzのコードを書いて',
  guildId: 'guild-1',
  scopeGuildId: 'guild-1',
  userId: 'user-1',
  authorized: true,
  pluginEnabled: true,
  guildOptIn: true,
};

const artifactConfig = { maxBytes: 4096, maxFiles: 2 };

describe('AiArtifactRuntime', () => {
  it('code_artifactを既存AI runtime経由で生成しPythonを実行しない', async () => {
    const requests: AiRuntimeGenerationRequest[] = [];
    const runtime = new AiArtifactRuntime({
      generationService: serviceReturning(
        JSON.stringify({
          artifacts: [
            {
              filename: 'fizzbuzz.py',
              mimeType: 'text/x-python',
              content: 'for i in range(1, 101):\n    print(i)\n',
            },
          ],
        }),
        requests,
      ),
      artifactConfig,
    });

    const result = await runtime.prepare(request);

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error('expected ready artifact');
    expect(result.intent).toBe('code_artifact');
    expect(result.artifacts[0]?.filename).toBe('fizzbuzz.py');
    expect(new TextDecoder().decode(result.artifacts[0]?.bytes)).toBe(
      'for i in range(1, 101):\n    print(i)\n',
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      responseMode: 'artifact',
      groundingState: 'not_required',
      input: request.input,
    });
    expect(requests[0]?.trustedInstructions?.join(' ')).toContain('do not execute it');
  });

  it('code_executionはPhase 1でproviderを呼ばず未実行を明示する', async () => {
    const generate = vi.fn<AiRuntimeGenerationService['generate']>();
    const runtime = new AiArtifactRuntime({
      generationService: { generate },
      artifactConfig,
    });

    const result = await runtime.prepare({
      ...request,
      input: 'このPythonコードを実行してCSVを作って',
    });

    expect(result).toMatchObject({ status: 'unsupported', intent: 'code_execution' });
    if (result.status !== 'unsupported') throw new Error('expected unsupported result');
    expect(result.userMessage).toContain('実行していません');
    expect(generate).not.toHaveBeenCalled();
  });

  it('Phase 1非対応言語はPythonへ変換せずprovider call前にrejectする', async () => {
    const generate = vi.fn<AiRuntimeGenerationService['generate']>();
    const runtime = new AiArtifactRuntime({
      generationService: { generate },
      artifactConfig,
    });

    const result = await runtime.prepare({
      ...request,
      input: 'Write a JavaScript program',
    });

    expect(result).toMatchObject({ status: 'unsupported', intent: 'code_artifact' });
    if (result.status !== 'unsupported') throw new Error('expected unsupported result');
    expect(result.userMessage).toContain('Pythonコードのみ');
    expect(result.userMessage).toContain('作成していません');
    expect(generate).not.toHaveBeenCalled();
  });

  it('Pythonを明示的に否定したcode artifactはprovider call前にrejectする', async () => {
    const generate = vi.fn<AiRuntimeGenerationService['generate']>();
    const runtime = new AiArtifactRuntime({
      generationService: { generate },
      artifactConfig,
    });

    const result = await runtime.prepare({
      ...request,
      input: 'Write JavaScript, not Python',
    });

    expect(result).toMatchObject({ status: 'unsupported', intent: 'code_artifact' });
    if (result.status !== 'unsupported') throw new Error('expected unsupported result');
    expect(result.userMessage).toContain('Pythonコードのみ');
    expect(result.userMessage).toContain('作成していません');
    expect(generate).not.toHaveBeenCalled();
  });

  it('既存chat modeはartifact provider callへrouteしない', async () => {
    const generate = vi.fn<AiRuntimeGenerationService['generate']>();
    const runtime = new AiArtifactRuntime({
      generationService: { generate },
      artifactConfig,
    });

    await expect(runtime.prepare({ ...request, input: '今日もよろしく' })).resolves.toEqual({
      status: 'not_handled',
      intent: 'chat',
    });
    expect(generate).not.toHaveBeenCalled();
  });

  it('invalid provider envelopeではvalidated artifactを作らずsafe failureにする', async () => {
    const runtime = new AiArtifactRuntime({
      generationService: serviceReturning('```python\nprint(1)\n```'),
      artifactConfig,
    });

    await expect(runtime.prepare(request)).rejects.toBeInstanceOf(AiArtifactRuntimeError);
  });

  it('unsafe filename / invalid MIMEは成功扱いにしない', async () => {
    const runtime = new AiArtifactRuntime({
      generationService: serviceReturning(
        JSON.stringify({
          artifacts: [
            {
              filename: '..' + '/fizzbuzz.py',
              mimeType: 'text/plain',
              content: 'print(1)',
            },
          ],
        }),
      ),
      artifactConfig,
    });

    await expect(runtime.prepare(request)).rejects.toMatchObject({
      category: 'validation_failed',
    });
  });

  it('artifact telemetryへraw prompt / generated content / filenameを出さない', async () => {
    const events: unknown[] = [];
    const rawSource = 'print("SECRET-LIKE-SOURCE")';
    const runtime = new AiArtifactRuntime({
      generationService: serviceReturning(
        JSON.stringify({
          artifacts: [
            {
              filename: 'private-name.py',
              mimeType: 'text/x-python',
              content: rawSource,
            },
          ],
        }),
      ),
      artifactConfig,
      telemetry: (event) => {
        events.push(event);
      },
    });

    await runtime.prepare({ ...request, input: 'PRIVATE-RAW-PROMPT Pythonコードを書いて' });

    expect(events).toHaveLength(1);
    const serialized = JSON.stringify(events[0]);
    expect(serialized).not.toContain('PRIVATE-RAW-PROMPT');
    expect(serialized).not.toContain('SECRET-LIKE-SOURCE');
    expect(serialized).not.toContain('private-name.py');
    expect(events[0]).toMatchObject({
      intent: 'code_artifact',
      resultCategory: 'success',
      artifactCount: 1,
      artifacts: [{ kind: 'code', mimeType: 'text/x-python', size: rawSource.length }],
    });
  });
});
