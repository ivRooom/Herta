import { PassThrough, Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { linkSpeakerAudioStream } from './vc-recap-speaker-stream.js';

function createOpusStream(): Readable {
  return new Readable({ objectMode: true, read() {} });
}

async function collect(stream: AsyncIterable<Buffer>): Promise<string[]> {
  const chunks: string[] = [];
  for await (const chunk of stream) chunks.push(chunk.toString());
  return chunks;
}

describe('linkSpeakerAudioStream', () => {
  it('push(null)直後にdestroyされても(AudioReceiveStreamの無音終了)PCMストリームを終える', async () => {
    const opus = createOpusStream();
    const speaker = linkSpeakerAudioStream(opus, new PassThrough({ objectMode: true }));
    const collected = collect(speaker.pcm);

    opus.push(Buffer.from('a'));
    opus.push(null);
    process.nextTick(() => opus.destroy());

    await expect(collected).resolves.toBeInstanceOf(Array);
  });

  it('end()はデコード済みの音声を流し切ってからPCMストリームを終える', async () => {
    const opus = createOpusStream();
    const speaker = linkSpeakerAudioStream(opus, new PassThrough({ objectMode: true }));
    const collected = collect(speaker.pcm);

    opus.push(Buffer.from('a'));
    await new Promise((resolve) => setImmediate(resolve));
    speaker.end();

    await expect(collected).resolves.toEqual(['a']);
  });

  it('abort()はPCMストリームを即座に破棄する', async () => {
    const opus = createOpusStream();
    const speaker = linkSpeakerAudioStream(opus, new PassThrough({ objectMode: true }));
    const collected = collect(speaker.pcm);

    speaker.abort();

    await expect(collected).rejects.toThrow();
  });
});
