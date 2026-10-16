import {
  EndBehaviorType,
  VoiceConnectionStatus,
  entersState,
  joinVoiceChannel,
  type VoiceConnection,
} from '@discordjs/voice';
import type { Logger } from '@herta/logger';
import {
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
}

/**
 * guildIdごとにアクティブなVC Recapセッションを保持する(プロセス内メモリのみ。
 * VoiceConnection自体は永続化できないため、bot再起動を跨いだセッション復元は行わない)。
 */
const activeSessions = new Map<string, ActiveVcRecapSession>();

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
  if (activeSessions.has(channel.guild.id)) {
    return { status: 'already_active' };
  }

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
}

function wireSpeakingHandler(
  prisma: PrismaClient,
  logger: Logger,
  session: ActiveVcRecapSession,
): void {
  session.connection.receiver.speaking.on('start', (userId) => {
    if (!session.consentingUserIds.has(userId)) return;
    if (session.activeTranscriptions.has(userId)) return;

    const task = transcribeSpeaker(prisma, logger, session, userId).finally(() => {
      session.activeTranscriptions.delete(userId);
    });
    session.activeTranscriptions.set(userId, task);
  });
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

  const opusStream = session.connection.receiver.subscribe(userId, {
    end: { behavior: EndBehaviorType.AfterSilence, duration: SPEECH_END_SILENCE_MS },
  });
  const pcmStream = opusStream.pipe(
    new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 }),
  );

  try {
    await transcribePcmStream(credential, toMonoChunks(pcmStream), async (segment) => {
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

  // 進行中の文字起こしが確定結果を書き込み終えるのをベストエフォートで待つ。
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

export function isVcRecapActive(guildId: string): boolean {
  return activeSessions.has(guildId);
}

export function activeVcRecapChannelId(guildId: string): string | null {
  return activeSessions.get(guildId)?.channelId ?? null;
}
