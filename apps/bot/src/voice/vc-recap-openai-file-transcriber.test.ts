import { describe, expect, it, vi } from 'vitest';
import { monoPcmToWav, transcribePcmWithOpenAi } from './vc-recap-openai-file-transcriber.js';
import {
  canUseLocalWhisperCanary,
  canUseOpenAiVcAudio,
  resolveVcRecapTranscriberConfig,
} from './vc-recap-transcriber-config.js';

async function* pcm(...buffers: Buffer[]): AsyncGenerator<Buffer> {
  for (const buffer of buffers) yield buffer;
}

describe('VC transcription provider rollback', () => {
  it('AWS is default and unknown provider never enables OpenAI', () => {
    expect(resolveVcRecapTranscriberConfig({})).toEqual({
      provider: 'aws',
      openAiAudioEnabled: false,
      localWhisperEnabled: false,
      maxSessionAudioSeconds: 120 * 60,
    });
    expect(
      resolveVcRecapTranscriberConfig({ VC_RECAP_TRANSCRIPTION_PROVIDER: 'unknown' }).provider,
    ).toBe('aws');
  });

  it('local Whisper is fail-closed and never turns on cloud/OpenAI consent', () => {
    const disabled = resolveVcRecapTranscriberConfig({
      VC_RECAP_TRANSCRIPTION_PROVIDER: 'local-whisper',
    });
    expect(disabled.provider).toBe('local-whisper');
    expect(disabled.localWhisperEnabled).toBe(false);
    expect(canUseOpenAiVcAudio(disabled, true)).toBe(false);

    const enabled = resolveVcRecapTranscriberConfig({
      VC_RECAP_TRANSCRIPTION_PROVIDER: 'local-whisper',
      VC_RECAP_LOCAL_WHISPER_ENABLED: 'true',
    });
    expect(enabled.localWhisperEnabled).toBe(true);
    expect(enabled.openAiAudioEnabled).toBe(false);
    expect(canUseOpenAiVcAudio(enabled, true)).toBe(false);
  });

  it('only the exact opted-in Canary Guild may use local Whisper', () => {
    const config = resolveVcRecapTranscriberConfig({
      VC_RECAP_TRANSCRIPTION_PROVIDER: 'aws',
      VC_RECAP_LOCAL_WHISPER_ENABLED: 'true',
    });
    const canary = { VC_RECAP_LOCAL_WHISPER_CANARY_GUILD_ID: '964326043420872704' };
    expect(canUseLocalWhisperCanary(config, '964326043420872704', canary)).toBe(true);
    expect(canUseLocalWhisperCanary(config, '964326043420872705', canary)).toBe(false);
    expect(canUseLocalWhisperCanary(config, '964326043420872704', {})).toBe(false);
    expect(
      canUseLocalWhisperCanary(config, '964326043420872704', {
        VC_RECAP_LOCAL_WHISPER_CANARY_GUILD_ID: '964326043420872704,964326043420872705',
      }),
    ).toBe(false);
    expect(
      canUseLocalWhisperCanary(resolveVcRecapTranscriberConfig({}), '964326043420872704', canary),
    ).toBe(false);
  });

  it('bounds the per-session OpenAI minute quota', () => {
    expect(
      resolveVcRecapTranscriberConfig({ VC_RECAP_OPENAI_SESSION_MAX_AUDIO_MINUTES: '1' })
        .maxSessionAudioSeconds,
    ).toBe(60);
    expect(
      resolveVcRecapTranscriberConfig({ VC_RECAP_OPENAI_SESSION_MAX_AUDIO_MINUTES: '99999' })
        .maxSessionAudioSeconds,
    ).toBe(120 * 60);
  });

  it('Whisper needs operator opt-in and new participant consent, and kill switch overrides', () => {
    const config = resolveVcRecapTranscriberConfig({
      VC_RECAP_TRANSCRIPTION_PROVIDER: 'whisper-1',
      VC_RECAP_OPENAI_AUDIO_CONSENT_READY: 'true',
    });
    expect(config.provider).toBe('whisper-1');
    expect(canUseOpenAiVcAudio(config, false)).toBe(false);
    expect(canUseOpenAiVcAudio(config, true)).toBe(true);
    expect(
      resolveVcRecapTranscriberConfig({
        VC_RECAP_TRANSCRIPTION_PROVIDER: 'whisper-1',
        VC_RECAP_OPENAI_AUDIO_CONSENT_READY: 'true',
        HERTA_AI_KILL_SWITCH: 'true',
      }).openAiAudioEnabled,
    ).toBe(false);
  });
});

describe('OpenAI bounded PCM file transcription', () => {
  it('builds compliant mono 48kHz PCM WAV without disk', () => {
    const wav = monoPcmToWav(Buffer.from([1, 0, 2, 0]));
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(24)).toBe(48_000);
    expect(wav.readUInt32LE(40)).toBe(4);
    expect(wav.subarray(44)).toEqual(Buffer.from([1, 0, 2, 0]));
    expect(() => monoPcmToWav(Buffer.from([1]))).toThrow();
  });

  it('does not upload anything without current consent', async () => {
    const fetchMock = vi.fn();
    const onSegment = vi.fn();
    await expect(
      transcribePcmWithOpenAi(pcm(Buffer.alloc(400)), onSegment, {
        apiKey: 'secret-test',
        model: 'whisper-1',
        mayUpload: async () => false,
        fetchImpl: fetchMock,
      }),
    ).rejects.toThrow(/consent/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onSegment).not.toHaveBeenCalled();
  });

  it('uploads multipart whisper-1 with Japanese hint and emits a speaker segment', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ text: 'こんにちは！' }), { status: 200 }));
    const onSegment = vi.fn();
    await transcribePcmWithOpenAi(pcm(Buffer.alloc(48_000 * 2)), onSegment, {
      apiKey: 'test-key',
      model: 'whisper-1',
      mayUpload: async () => true,
      fetchImpl: fetchMock,
    });
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect((request.body as FormData).get('model')).toBe('whisper-1');
    expect((request.body as FormData).get('language')).toBe('ja');
    expect((request.body as FormData).get('file')).toBeInstanceOf(Blob);
    expect(onSegment).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'こんにちは！',
        startedAt: expect.any(Date),
        endedAt: expect.any(Date),
      }),
    );
  });

  it('gpt-transcribe does not send deprecated Whisper-only language hint', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ text: 'Hello' }), { status: 200 }));
    await transcribePcmWithOpenAi(pcm(Buffer.alloc(200)), vi.fn(), {
      apiKey: 'test',
      model: 'gpt-transcribe',
      mayUpload: async () => true,
      fetchImpl: fetchMock,
    });
    const body = (fetchMock.mock.calls[0]?.[1] as RequestInit).body as FormData;
    expect(body.get('model')).toBe('gpt-transcribe');
    expect(body.has('language')).toBe(false);
  });

  it('checks consent on every 20-second upload and never sends after withdrawal', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ text: '前半' }), { status: 200 }));
    let grant = true;
    const mayUpload = vi.fn(async () => {
      const current = grant;
      grant = false;
      return current;
    });
    const onSegment = vi.fn();
    await expect(
      transcribePcmWithOpenAi(pcm(Buffer.alloc(20 * 48_000 * 2), Buffer.alloc(100)), onSegment, {
        apiKey: 'test',
        model: 'whisper-1',
        mayUpload,
        fetchImpl: fetchMock,
      }),
    ).rejects.toThrow(/consent/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onSegment).toHaveBeenCalledTimes(1);
    expect(mayUpload).toHaveBeenCalledTimes(2);
  });

  it('keeps consuming PCM while the previous 20-second upload is unresolved', async () => {
    let releaseResponse: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    let notifyStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    let captured = 0;
    async function* audio(): AsyncGenerator<Buffer> {
      for (let i = 0; i < 2; i += 1) {
        captured += 1;
        yield Buffer.alloc(20 * 48_000 * 2);
      }
    }
    const fetchImpl = vi.fn(async () => {
      notifyStarted?.();
      await blocked;
      return new Response(JSON.stringify({ text: '音声認識' }), { status: 200 });
    });
    const segments = vi.fn();
    const transcription = transcribePcmWithOpenAi(audio(), segments, {
      apiKey: 'test',
      model: 'gpt-transcribe',
      mayUpload: async () => true,
      fetchImpl: fetchImpl as typeof fetch,
    });
    await started;
    // Allow the async PCM iterator to finish independently of the blocked HTTP call.
    await new Promise<void>((resolve) => setImmediate(resolve));
    try {
      expect(captured).toBe(2);
    } finally {
      releaseResponse?.();
    }
    await transcription;
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(segments).toHaveBeenCalledTimes(2);
  });

  it('never logs provider body or credential in HTTP failures', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('private provider error content', { status: 503 }));
    await expect(
      transcribePcmWithOpenAi(pcm(Buffer.alloc(200)), vi.fn(), {
        apiKey: 'SECRET_DO_NOT_LEAK',
        model: 'whisper-1',
        mayUpload: async () => true,
        fetchImpl: fetchMock,
      }),
    ).rejects.toThrow('OpenAI transcription HTTP 503');
  });
});
