import type { TranscribedSegment } from './vc-recap-transcriber.js';
import type { VcRecapTranscriptionProvider } from './vc-recap-transcriber-config.js';

const PCM_SAMPLE_RATE = 48_000;
const PCM_BYTES_PER_SAMPLE = 2;
const MAX_CHUNK_SECONDS = 20;
const MAX_PCM_BYTES = MAX_CHUNK_SECONDS * PCM_SAMPLE_RATE * PCM_BYTES_PER_SAMPLE;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 45_000;
const MAX_RESPONSE_BYTES = 128_000;
const MAX_SPEAKER_AUDIO_SECONDS = 10 * 60;

export interface OpenAiFileTranscriptionOptions {
  apiKey: string;
  model: Exclude<VcRecapTranscriptionProvider, 'aws'>;
  fetchImpl?: typeof fetch;
  /**
   * Check the person's CURRENT explicit provider consent before every upload.
   * A revocation immediately prevents sending further audio.
   */
  mayUpload: (audioSeconds: number) => Promise<boolean>;
}

export function monoPcmToWav(pcm: Buffer): Buffer {
  if (pcm.length === 0 || pcm.length % PCM_BYTES_PER_SAMPLE !== 0) {
    throw new Error('Invalid mono PCM length');
  }
  if (pcm.length + 44 > MAX_FILE_BYTES) {
    throw new Error('WAV audio exceeds API size limit');
  }
  const wav = Buffer.allocUnsafe(pcm.length + 44);
  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVE', 8, 'ascii');
  wav.write('fmt ', 12, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(PCM_SAMPLE_RATE, 24);
  wav.writeUInt32LE(PCM_SAMPLE_RATE * PCM_BYTES_PER_SAMPLE, 28);
  wav.writeUInt16LE(PCM_BYTES_PER_SAMPLE, 32);
  wav.writeUInt16LE(PCM_BYTES_PER_SAMPLE * 8, 34);
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(pcm.length, 40);
  pcm.copy(wav, 44);
  return wav;
}

async function postAudioChunk(
  pcm: Buffer,
  options: OpenAiFileTranscriptionOptions,
): Promise<string> {
  if (!(await options.mayUpload()))
    throw new Error('OpenAI audio consent is unavailable or revoked');
  const body = new FormData();
  const wav = monoPcmToWav(pcm);
  body.set('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'vc-recap.wav');
  body.set('model', options.model);
  body.set('response_format', 'json');
  if (options.model === 'whisper-1') body.set('language', 'ja');

  // No retries: resending voice would duplicate costs and voice disclosure.
  // Do not include transcripts, API responses, or credentials in errors.
  const response = await (options.fetchImpl ?? fetch)(
    'https://api.openai.com/v1/audio/transcriptions',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${options.apiKey}` },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );
  if (!response.ok) throw new Error(`OpenAI transcription HTTP ${response.status}`);
  const raw = await response.text();
  if (Buffer.byteLength(raw, 'utf8') > MAX_RESPONSE_BYTES) {
    throw new Error('OpenAI transcription response too large');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('OpenAI transcription returned invalid JSON');
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as { text?: unknown }).text !== 'string'
  ) {
    throw new Error('OpenAI transcription returned invalid text');
  }
  return (parsed as { text: string }).text.trim().slice(0, 4_000);
}

/**
 * File-oriented OpenAI transcription of bounded 48kHz mono/16-bit PCM speech.
 * Audio exists only in memory and is discarded after each call; no recording
 * persistence or S3 object is created.
 *
 * Whisper file transcription is NOT live streaming: interim partial speech is
 * unavailable. Chunks are 20s maximum; the final shorter utterance is flushed
 * on stream completion. Timestamps are derived from PCM sample counts.
 */
export async function transcribePcmWithOpenAi(
  pcmChunks: AsyncIterable<Buffer>,
  onSegment: (segment: TranscribedSegment) => Promise<void>,
  options: OpenAiFileTranscriptionOptions,
): Promise<void> {
  if (!options.apiKey.trim()) throw new Error('OpenAI transcription credential missing');
  const recordingStart = Date.now();
  let processedBytes = 0;
  let pending: Buffer[] = [];
  let pendingBytes = 0;
  let totalBytes = 0;
  const maxTotalBytes = MAX_SPEAKER_AUDIO_SECONDS * PCM_SAMPLE_RATE * PCM_BYTES_PER_SAMPLE;

  const send = async (): Promise<void> => {
    if (pendingBytes === 0) return;
    const size = pendingBytes;
    const chunk = Buffer.concat(pending, size);
    pending = [];
    pendingBytes = 0;
    const startMs =
      recordingStart + (processedBytes / (PCM_SAMPLE_RATE * PCM_BYTES_PER_SAMPLE)) * 1000;
    processedBytes += size;
    const endMs =
      recordingStart + (processedBytes / (PCM_SAMPLE_RATE * PCM_BYTES_PER_SAMPLE)) * 1000;
    const text = await postAudioChunk(chunk, options);
    if (text) {
      await onSegment({
        text,
        startedAt: new Date(startMs),
        endedAt: new Date(endMs),
      });
    }
  };

  for await (const input of pcmChunks) {
    if (input.length % PCM_BYTES_PER_SAMPLE !== 0) {
      throw new Error('Invalid PCM frame alignment');
    }
    totalBytes += input.length;
    if (totalBytes > maxTotalBytes) {
      throw new Error('VC voice burst exceeded the 10-minute safety limit');
    }
    let offset = 0;
    while (offset < input.length) {
      const take = Math.min(MAX_PCM_BYTES - pendingBytes, input.length - offset);
      pending.push(input.subarray(offset, offset + take));
      pendingBytes += take;
      offset += take;
      if (pendingBytes === MAX_PCM_BYTES) await send();
    }
  }
  await send();
}
