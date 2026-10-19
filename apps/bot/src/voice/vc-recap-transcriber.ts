import {
  StartStreamTranscriptionCommand,
  TranscribeStreamingClient,
  type AudioStream,
} from '@aws-sdk/client-transcribe-streaming';
import type { AwsTranscribeCredential } from './aws-transcribe-credential.js';

export interface TranscribedSegment {
  text: string;
  startedAt: Date;
  endedAt: Date;
}

const LANGUAGE_CODE = 'ja-JP';
const MEDIA_SAMPLE_RATE_HERTZ = 48000;

async function* toAudioStream(pcmChunks: AsyncIterable<Buffer>): AsyncGenerator<AudioStream> {
  for await (const chunk of pcmChunks) {
    yield { AudioEvent: { AudioChunk: chunk } };
  }
}

/**
 * PCM音声チャンクのストリームをAWS Transcribe Streamingへ流し、確定済み(IsPartial: false)の
 * 発話セグメントが得られるたびにonSegmentを呼ぶ。接続・ストリームエラーは例外として投げる
 * (呼び出し元でログ出力とフォールバック処理を行う。1ユーザー分の文字起こし失敗がセッション
 * 全体を失敗させないよう、呼び出し元でユーザー単位にcatchする設計を前提とする)。
 */
export async function transcribePcmStream(
  credential: AwsTranscribeCredential,
  pcmChunks: AsyncIterable<Buffer>,
  onSegment: (segment: TranscribedSegment) => Promise<void>,
): Promise<void> {
  const client = new TranscribeStreamingClient({
    region: credential.region,
    credentials: {
      accessKeyId: credential.accessKeyId,
      secretAccessKey: credential.secretAccessKey,
    },
  });

  try {
    const command = new StartStreamTranscriptionCommand({
      LanguageCode: LANGUAGE_CODE,
      MediaEncoding: 'pcm',
      MediaSampleRateHertz: MEDIA_SAMPLE_RATE_HERTZ,
      AudioStream: toAudioStream(pcmChunks),
    });
    const response = await client.send(command);
    if (!response.TranscriptResultStream) return;

    // Partial結果が最初に現れた時刻をセグメント開始時刻の目安とする
    // (AWS側はpartial結果の正確な発話開始時刻を返さないため)。
    let segmentStartedAt: Date | null = null;
    for await (const event of response.TranscriptResultStream) {
      if (!event.TranscriptEvent) continue;
      const results = event.TranscriptEvent.Transcript?.Results ?? [];
      for (const result of results) {
        if (result.IsPartial) {
          segmentStartedAt ??= new Date();
          continue;
        }
        const text = result.Alternatives?.[0]?.Transcript?.trim();
        const startedAt = segmentStartedAt ?? new Date();
        segmentStartedAt = null;
        if (!text) continue;
        await onSegment({ text, startedAt, endedAt: new Date() });
      }
    }
  } finally {
    client.destroy();
  }
}
