import { describe, expect, it, vi } from 'vitest';
import { transcribePcmWithLocalWhisper } from './vc-recap-local-whisper-transcriber.js';

const TOKEN = 'x'.repeat(32);

async function* audio(...chunks: Buffer[]): AsyncGenerator<Buffer> {
  for (const chunk of chunks) yield chunk;
}

describe('Private local Whisper PCM transport', () => {
  it('never invokes the worker when the shared token is missing', async () => {
    const fetchImpl = vi.fn();
    await expect(
      transcribePcmWithLocalWhisper(audio(Buffer.alloc(960)), vi.fn(), {
        token: '',
        mayProcess: async () => true,
        fetchImpl,
      }),
    ).rejects.toThrow(/token/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses to send audio without current affirmative consent', async () => {
    const fetchImpl = vi.fn();
    await expect(
      transcribePcmWithLocalWhisper(audio(Buffer.alloc(960)), vi.fn(), {
        token: TOKEN,
        mayProcess: async () => false,
        fetchImpl,
      }),
    ).rejects.toThrow(/consent/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('uses only the private fixed worker host and emits timestamped transcription', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ text: 'こんにちは' }), { status: 200 }));
    const onSegment = vi.fn();
    await transcribePcmWithLocalWhisper(audio(Buffer.alloc(48_000 * 2)), onSegment, {
      token: TOKEN,
      mayProcess: async () => true,
      fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('http://whisper:8765/v1/transcribe');
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/octet-stream',
      'X-Audio-Sample-Rate': '48000',
    });
    expect(init.body).toBeInstanceOf(Uint8Array);
    expect(onSegment).toHaveBeenCalledWith({
      text: 'こんにちは',
      startedAt: expect.any(Date),
      endedAt: expect.any(Date),
    });
  });

  it('drops a worker response when consent is withdrawn before writing', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ text: 'discard' }), { status: 200 }));
    let checked = 0;
    const onSegment = vi.fn();
    await transcribePcmWithLocalWhisper(audio(Buffer.alloc(480)), onSegment, {
      token: TOKEN,
      mayProcess: async () => ++checked === 1,
      fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(onSegment).not.toHaveBeenCalled();
  });

  it('fails closed on worker outage, with no AWS or OpenAI fallback', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('unreachable'));
    await expect(
      transcribePcmWithLocalWhisper(audio(Buffer.alloc(480)), vi.fn(), {
        token: TOKEN,
        mayProcess: async () => true,
        fetchImpl,
      }),
    ).rejects.toThrow('unreachable');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects unaligned and oversized speech before any upload', async () => {
    const fetchImpl = vi.fn();
    await expect(
      transcribePcmWithLocalWhisper(audio(Buffer.from([0])), vi.fn(), {
        token: TOKEN,
        mayProcess: async () => true,
        fetchImpl,
      }),
    ).rejects.toThrow(/alignment/);
    await expect(
      transcribePcmWithLocalWhisper(audio(Buffer.alloc(10 * 60 * 48_000 * 2 + 2)), vi.fn(), {
        token: TOKEN,
        mayProcess: async () => true,
        fetchImpl,
      }),
    ).rejects.toThrow(/safety limit/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('limits concurrent queued 8s segments so inference cannot consume unlimited RAM', async () => {
    const fetchImpl = vi.fn(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      return new Response(JSON.stringify({ text: 'ok' }), { status: 200 });
    });
    await expect(
      transcribePcmWithLocalWhisper(
        audio(
          Buffer.alloc(8 * 48_000 * 2),
          Buffer.alloc(8 * 48_000 * 2),
          Buffer.alloc(8 * 48_000 * 2),
          Buffer.alloc(8 * 48_000 * 2),
        ),
        vi.fn(),
        { token: TOKEN, mayProcess: async () => true, fetchImpl: fetchImpl as typeof fetch },
      ),
    ).rejects.toThrow(/backlog/);
  }, 10000);

  it('does not surface a private response body on non-200 errors', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('private details', { status: 503 }));
    await expect(
      transcribePcmWithLocalWhisper(audio(Buffer.alloc(480)), vi.fn(), {
        token: TOKEN,
        mayProcess: async () => true,
        fetchImpl,
      }),
    ).rejects.toThrow('Local Whisper HTTP 503');
  });
});
