import type { Readable, Transform } from 'node:stream';

/**
 * 1ユーザー分の受信Opusストリームとデコーダの組。stopVcRecap・同意取り消し時に
 * 正常終了(end)と強制中断(abort)を使い分けるために保持する。
 */
export interface SpeakerAudioStream {
  pcm: Readable;
  /** 受信を止め、デコード済みの音声を流し切ってからPCMストリームを終える。 */
  end(): void;
  /** PCMストリームを即座に破棄する(Transcribe側も例外で終わる)。 */
  abort(): void;
}

/**
 * OpusストリームをデコーダへpipeしてPCMストリームを作る。
 *
 * @discordjs/voiceのAudioReceiveStreamはpush(null)の直後のnextTickでdestroyされ、
 * 明示的なdestroy()でも'end'を出さずにcloseする。pipeは'end'しかデコーダへ伝えないため、
 * そのままではデコーダが終わらず、Transcribe Streamingが15秒の無音タイムアウトで
 * 失敗するまで文字起こしが完了しない。closeを契機にデコーダを明示的にendする。
 */
export function linkSpeakerAudioStream(opus: Readable, decoder: Transform): SpeakerAudioStream {
  opus.pipe(decoder);
  opus.once('close', () => {
    if (!decoder.writableEnded && !decoder.destroyed) decoder.end();
  });
  return {
    pcm: decoder,
    end: () => opus.destroy(),
    abort: () => {
      opus.destroy();
      decoder.destroy();
    },
  };
}
