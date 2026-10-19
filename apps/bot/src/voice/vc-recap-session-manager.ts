import {
  EndBehaviorType,
  VoiceConnectionStatus,
  entersState,
  joinVoiceChannel,
  type VoiceConnection,
} from '@discordjs/voice';
import type { Logger } from '@herta/logger';
import {
  addVcRecapSessionParticipant,
  appendVcRecapTranscriptSegment,
  completeVcRecapSession,
  failVcRecapSession,
  getVoiceTranscriptionConsentMap,
  listVcRecapTranscriptSegments,
  startVcRecapSession,
  type PrismaClient,
} from '@herta/db';
import type { VoiceBasedChannel } from 'discord.js';
import prism from 'prism-media';
import type { Readable } from 'node:stream';
import { resolveAwsTranscribeCredential } from './aws-transcribe-credential.js';
import { splitVcRecapParticipants } from './vc-recap-participants.js';
import { summarizeVcRecapSession } from './vc-recap-summarizer.js';
import { transcribePcmStream } from './vc-recap-transcriber.js';

const CONNECTION_READY_TIMEOUT_MS = 10_000;
const SPEECH_END_SILENCE_MS = 1_000;

interface ActiveVcRecapSession {
  sessionId: string;
  guildId: string;
  channelId: string;
  connection: VoiceConnection;
  consentingUserIds: Set<string>;
  activeTranscriptions: Map<string, Promise<void>>;
  /** stopVcRecap側で明示的にdestroyできるよう、購読中のOpusストリームを保持する。 */
  activeStreams: Map<string, Readable>;
  /**
   * stopVcRecap開始時にtrueへ。speaking 'start'イベントはconnection.destroy()後も
   * 発火し得るため、このフラグで新規タスクの発生・segment保存を止める。
   */
  stopping: boolean;
  speakingHandler?: (userId: string) => void;
}

/**
 * guildIdごとにアクティブなVC Recapセッションを保持する(プロセス内メモリのみ。
 * VoiceConnection自体は永続化できないため、bot再起動を跨いだセッション復元は行わない)。
 */
const activeSessions = new Map<string, ActiveVcRecapSession>();

/**
 * startVcRecapSession作成〜activeSessions登録までの間(DB書き込み・VC接続待ち等、
 * 複数回awaitする区間)に同じguildで2回目の/vc-recap startが割り込むのを防ぐための
 * 同期的な予約セット。
 */
const pendingGuildIds = new Set<string>();

export type StartVcRecapResult =
  | { status: 'started'; sessionId: string; consentingCount: number; nonConsentingCount: number }
  | { status: 'already_active' }
  | { status: 'no_consenting_members' }
  | { status: 'connection_failed' };

export async function startVcRecap(
  prisma: PrismaClient,
  logger: Logger,
  channel: VoiceBasedChannel,
  startedBy: string,
): Promise<StartVcRecapResult> {
  if (activeSessions.has(channel.guild.id) || pendingGuildIds.has(channel.guild.id)) {
    return { status: 'already_active' };
  }
  pendingGuildIds.add(channel.guild.id);

  try {
    const memberUserIds = [...channel.members.filter((member) => !member.user.bot).keys()];
    const consentByUserId = await getVoiceTranscriptionConsentMap(prisma, memberUserIds);
    const { consentingUserIds, nonConsentingUserIds } = splitVcRecapParticipants(
      memberUserIds,
      consentByUserId,
    );

    if (consentingUserIds.length === 0) {
      return { status: 'no_consenting_members' };
    }

    const { id: sessionId } = await startVcRecapSession(prisma, {
      guildId: channel.guild.id,
      channelId: channel.id,
      startedBy,
      consentingUserIds,
      nonConsentingUserIds,
    });

    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: true,
    });

    const session: ActiveVcRecapSession = {
      sessionId,
      guildId: channel.guild.id,
      channelId: channel.id,
      connection,
      consentingUserIds: new Set(consentingUserIds),
      activeTranscriptions: new Map(),
      activeStreams: new Map(),
      stopping: false,
    };

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, CONNECTION_READY_TIMEOUT_MS);
    } catch (error) {
      logger.warn({ err: error, guildId: channel.guild.id }, 'VC接続の確立に失敗しました');
      connection.destroy();
      await failVcRecapSession(prisma, sessionId);
      return { status: 'connection_failed' };
    }

    activeSessions.set(channel.guild.id, session);
    wireSpeakingHandler(prisma, logger, session);

    return {
      status: 'started',
      sessionId,
      consentingCount: consentingUserIds.length,
      nonConsentingCount: nonConsentingUserIds.length,
    };
  } finally {
    pendingGuildIds.delete(channel.guild.id);
  }
}

function wireSpeakingHandler(
  prisma: PrismaClient,
  logger: Logger,
  session: ActiveVcRecapSession,
): void {
  const speakingHandler = (userId: string): void => {
    if (session.stopping || session.activeTranscriptions.has(userId)) return;

    const task = (async () => {
      // 同意状態はセッション開始時点で固定せず、発言開始のたびに都度再確認する。
      // `/herta-privacy voice-consent false`で同意を取り消した後の発言は対象外にするため。
      const consentMap = await getVoiceTranscriptionConsentMap(prisma, [userId]);
      if (consentMap.get(userId) !== true) return;

      // 開始時点でVCにいなかった同意済みユーザーが後から参加・発言した場合、
      // 永続化された参加者配列にも追加する(listVcRecapSessionsForUser/
      // deleteUserVoiceDataが参加者配列経由でセッションを検索するため)。
      if (!session.consentingUserIds.has(userId)) {
        session.consentingUserIds.add(userId);
        try {
          await addVcRecapSessionParticipant(prisma, session.sessionId, userId);
        } catch (error) {
          logger.warn(
            { err: error, guildId: session.guildId, userId },
            'VC Recap参加者の永続化に失敗しました',
          );
        }
      }

      await transcribeSpeaker(prisma, logger, session, userId);
    })().finally(() => {
      session.activeTranscriptions.delete(userId);
    });
    session.activeTranscriptions.set(userId, task);
  };
  session.speakingHandler = speakingHandler;
  session.connection.receiver.speaking.on('start', speakingHandler);
}

async function transcribeSpeaker(
  prisma: PrismaClient,
  logger: Logger,
  session: ActiveVcRecapSession,
  userId: string,
): Promise<void> {
  const credential = await resolveAwsTranscribeCredential(prisma);
  if (!credential) {
    logger.warn(
      { guildId: session.guildId, userId },
      'AWS Transcribe認証情報が未設定のため文字起こしをスキップします',
    );
    return;
  }
  if (session.stopping || !session.consentingUserIds.has(userId)) return;

  const opusStream = session.connection.receiver.subscribe(userId, {
    end: { behavior: EndBehaviorType.AfterSilence, duration: SPEECH_END_SILENCE_MS },
  });
  session.activeStreams.set(userId, opusStream);
  const pcmStream = opusStream.pipe(
    new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 }),
  );

  try {
    await transcribePcmStream(credential, toMonoChunks(pcmStream), async (segment) => {
      // 文字起こし中に同意が取り消された、またはstopVcRecapが開始された場合、
      // 確定済みセグメントであっても保存しない。
      if (session.stopping || !session.consentingUserIds.has(userId)) return;
      await appendVcRecapTranscriptSegment(prisma, {
        sessionId: session.sessionId,
        userId,
        text: segment.text,
        startedAt: segment.startedAt,
        endedAt: segment.endedAt,
      });
    });
  } catch (error) {
    // 1人の文字起こし失敗でセッション全体を失敗させない(他の参加者の文字起こしは継続する)。
    logger.warn({ err: error, guildId: session.guildId, userId }, 'VC文字起こしに失敗しました');
  } finally {
    session.activeStreams.delete(userId);
  }
}

async function* toMonoChunks(stream: AsyncIterable<Buffer>): AsyncGenerator<Buffer> {
  for await (const chunk of stream) {
    yield downmixStereoToMono(chunk);
  }
}

/** Discordの音声は48kHz・16bit・stereo PCM。AWS Transcribeへ送る前にmonoへダウンミックスする。 */
function downmixStereoToMono(stereoBuffer: Buffer): Buffer {
  const frameCount = Math.floor(stereoBuffer.length / 4);
  const mono = Buffer.alloc(frameCount * 2);
  for (let i = 0; i < frameCount; i += 1) {
    const left = stereoBuffer.readInt16LE(i * 4);
    const right = stereoBuffer.readInt16LE(i * 4 + 2);
    mono.writeInt16LE(Math.round((left + right) / 2), i * 2);
  }
  return mono;
}

export type StopVcRecapResult =
  | { status: 'completed'; sessionId: string }
  | { status: 'summarize_failed'; sessionId: string }
  | { status: 'not_active' };

export async function stopVcRecap(
  prisma: PrismaClient,
  logger: Logger,
  guildId: string,
): Promise<StopVcRecapResult> {
  const session = activeSessions.get(guildId);
  if (!session) return { status: 'not_active' };
  activeSessions.delete(guildId);

  // stoppingをtrueにし、wireSpeakingHandlerが登録したリスナーだけ外すことで、
  // 後続の'start'イベントによる新規購読・segment保存(cleanup後の書き込み)を防ぐ。
  session.stopping = true;
  if (session.speakingHandler) {
    session.connection.receiver.speaking.off('start', session.speakingHandler);
  }

  // 参加者が話し続けている場合、OpusストリームはAfterSilence条件に到達せず
  // activeTranscriptionsのPromiseが解決しないままになる。先にストリームを
  // 明示的にdestroyしてから待つことで、connection.destroy()が永遠に実行されない
  // (=録音が止まらない)状態を防ぐ。
  for (const stream of session.activeStreams.values()) {
    stream.destroy();
  }
  await Promise.allSettled([...session.activeTranscriptions.values()]);
  session.connection.destroy();

  const segments = await listVcRecapTranscriptSegments(prisma, session.sessionId);
  const result = await summarizeVcRecapSession(prisma, segments);
  if (!result) {
    await failVcRecapSession(prisma, session.sessionId);
    logger.warn({ guildId, sessionId: session.sessionId }, 'VC要約の生成に失敗しました');
    return { status: 'summarize_failed', sessionId: session.sessionId };
  }

  await completeVcRecapSession(prisma, session.sessionId, result);
  return { status: 'completed', sessionId: session.sessionId };
}

/**
 * `/herta-privacy voice-consent false`実行時に呼ぶ。進行中のVC Recapセッションがあれば
 * 即座にそのユーザーを対象外にし、購読中のストリームを破棄する(次の発言開始イベントでの
 * 同意再確認だけでは、取り消し時点で発言中だった分の文字起こし・segment保存を止められないため)。
 */
export function revokeVcRecapConsent(userId: string): void {
  for (const session of activeSessions.values()) {
    if (!session.consentingUserIds.delete(userId)) continue;
    session.activeStreams.get(userId)?.destroy();
  }
}

export function isVcRecapActive(guildId: string): boolean {
  return activeSessions.has(guildId);
}

export function activeVcRecapChannelId(guildId: string): string | null {
  return activeSessions.get(guildId)?.channelId ?? null;
}
