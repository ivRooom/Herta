import type { TranscribedSegment } from './vc-recap-transcriber.js';

const ENDPOINT = 'http://whisper:8765/v1/transcribe';
const RATE = 48_000;
const BYTES_PER_SAMPLE = 2;
const SEGMENT_SECONDS = 8;
const SEGMENT_BYTES = RATE * BYTES_PER_SAMPLE * SEGMENT_SECONDS;
const MAX_TOTAL_BYTES = RATE * BYTES_PER_SAMPLE * 10 * 60;
const MAX_QUEUED = 3;
const REQUEST_TIMEOUT_MS = 45_000;
const MAX_RESPONSE_BYTES = 16_000;

export interface LocalWhisperOptions {
  token: string;
  /** Live personal consent and active-session check, not an old snapshot. */
  mayProcess: () => Promise<boolean>;
  fetchImpl?: typeof fetch;
}

async function recognize(pcm: Buffer, options: LocalWhisperOptions): Promise<string> {
  if (!(await options.mayProcess())) throw new Error('Local Whisper consent revoked or unavailable');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await (options.fetchImpl ?? fetch)(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.token}`,
        'Content-Type': 'application/octet-stream',
        'X-Audio-Sample-Rate': '48000',
      },
      // Uint8Array is accepted as a BodyInit even with Node Buffer backing.
      body: new Uint8Array(pcm),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Local Whisper HTTP ${response.status}`);
    const raw = await response.text();
    if (Buffer.byteLength(raw, 'utf8') > MAX_RESPONSE_BYTES) {
      throw new Error('Local Whisper response too large');
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(raw);
    } catch {
      throw new Error('Local Whisper response is not JSON');
    }
    if (
      !decoded ||
      typeof decoded !== 'object' ||
      typeof (decoded as { text?: unknown }).text !== 'string'
    ) {
      throw new Error('Local Whisper transcript missing');
    }
    return (decoded as { text: string }).text.trim().slice(0, 4_000);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Sends bounded in-memory 48kHz/16bit mono PCM to a private sidecar.
 * No disk writes, no paid-provider fallback, no user/audio details in errors.
 * Capture and inference are decoupled by a strictly limited in-memory queue.
 */
export async function transcribePcmWithLocalWhisper(
  pcmChunks: AsyncIterable<Buffer>,
  onSegment: (segment: TranscribedSegment) => Promise<void>,
  options: LocalWhisperOptions,
): Promise<void> {
  if (options.token.trim().length < 32) throw new Error('Local Whisper token is not configured');

  const startedAt = Date.now();
  let totalBytes = 0;
  let processedBytes = 0;
  let pending: Buffer[] = [];
  let pendingBytes = 0;
  let queued = 0;
  let failure: unknown = null;
  let cancelled = false;
  let inferenceChain: Promise<void> = Promise.resolve();

  const enqueue = (): void => {
    if (pendingBytes === 0) return;
    if (queued >= MAX_QUEUED) throw new Error('Local Whisper inference backlog exceeded');
    const pcm = Buffer.concat(pending, pendingBytes);
    const from = startedAt + (processedBytes / (RATE * BYTES_PER_SAMPLE)) * 1000;
    processedBytes += pendingBytes;
    const to = startedAt + (processedBytes / (RATE * BYTES_PER_SAMPLE)) * 1000;
    pending = [];
    pendingBytes = 0;
    queued++;
    inferenceChain = inferenceChain
      .then(async () => {
        if (cancelled || failure) return;
        const text = await recognize(pcm, options);
        if (!cancelled && text && (await options.mayProcess())) {
          await onSegment({ text, startedAt: new Date(from), endedAt: new Date(to) });
        }
      })
      .catch((error: unknown) => {
        failure ??= error;
      })
      .finally(() => {
        queued--;
      });
  };

  try {
    for await (const chunk of pcmChunks) {
      if (failure) throw failure;
      if (chunk.length % BYTES_PER_SAMPLE !== 0) {
        throw new Error('Invalid Local Whisper PCM frame alignment');
      }
      totalBytes += chunk.length;
      if (totalBytes > MAX_TOTAL_BYTES) throw new Error('Local Whisper audio safety limit exceeded');
      let offset = 0;
      while (offset < chunk.length) {
        const take = Math.min(SEGMENT_BYTES - pendingBytes, chunk.length - offset);
        pending.push(chunk.subarray(offset, offset + take));
        pendingBytes += take;
        offset += take;
        if (pendingBytes === SEGMENT_BYTES) enqueue();
      }
    }
    enqueue();
    await inferenceChain;
    if (failure) throw failure;
  } catch (error) {
    cancelled = true;
    // In-flight HTTP is bounded by timeout; no queued request may start now.
    await inferenceChain;
    throw error;
  }
}
