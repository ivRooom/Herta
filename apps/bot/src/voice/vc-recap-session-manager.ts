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
  appendLocalVcRecapSegmentIfConsented,
  applyAutoConsentRoles,
  appendVcRecapTranscriptSegment,
  completeVcRecapSession,
  failVcRecapSession,
  getVoiceTranscriptRetentionUserIds,
  getVoiceTranscriptionConsentMap,
  listVcRecapTranscriptSegments,
  startVcRecapSession,
  type PrismaClient,
} from '@herta/db';
import type { Guild, VoiceBasedChannel } from 'discord.js';
import prism from 'prism-media';
import { resolveAwsTranscribeCredential } from './aws-transcribe-credential.js';
import { resolveAiOpenAiCredential } from '../ai/factory.js';
import { transcribePcmWithOpenAi } from './vc-recap-openai-file-transcriber.js';
import { transcribePcmWithLocalWhisper } from './vc-recap-local-whisper-transcriber.js';
import {
  rejectIncompleteLocalVcRecap,
  shouldMarkLocalWhisperSessionFailed,
} from './vc-recap-local-finish-policy.js';
import { hasVcRecapOpenAiAudioConsent } from './vc-recap-openai-audio-consent.js';
import {
  canUseLocalWhisperCanary,
  resolveVcRecapTranscriberConfig,
} from './vc-recap-transcriber-config.js';
import { splitVcRecapParticipants } from './vc-recap-participants.js';
import { linkSpeakerAudioStream, type SpeakerAudioStream } from './vc-recap-speaker-stream.js';
import { summarizeVcRecapSession } from './vc-recap-summarizer.js';
import { transcribePcmStream } from './vc-recap-transcriber.js';

const CONNECTION_READY_TIMEOUT_MS = 10_000;
const SPEECH_END_SILENCE_MS = 1_000;
/** stop時、発話中だった参加者の最終セグメントをTranscribeから受け取るまで待つ上限。 */
const STOP_FLUSH_TIMEOUT_MS = 5_000;
/** flushの上限を超えて強制中断した後、文字起こしタスクの終了を待つ上限。 */
const STOP_ABORT_TIMEOUT_MS = 2_000;

interface ActiveVcRecapSession {
  sessionId: string;
  guildId: string;
  channelId: string;
  guild: Guild;
  connection: VoiceConnection;
  /** `discord-role`で設定された、保持しているだけで同意済みとみなすロールID一覧。 */
  autoConsentRoleIds: string[];
  consentingUserIds: Set<string>;
  activeTranscriptions: Map<string, Promise<void>>;
  /** All uploads / transcriptions still pending, including after a speaker pauses. */
  pendingTranscriptions: Set<Promise<void>>;
  /** stopVcRecap・同意取り消し時に終了/中断できるよう、購読中の音声ストリームを保持する。 */
  activeStreams: Map<string, SpeakerAudioStream>;
  /**
   * stopVcRecap開始時にtrueへ。speaking 'start'イベントはconnection.destroy()後も
   * 発火し得るため、このフラグで新規タスクの発生を止める。
   */
  stopping: boolean;
  /**
   * segment保存を受け付けるか。stop開始後も発話中だった分の最終セグメントは保存し、
   * flushを打ち切った時点でfalseにして要約開始後の書き込みを防ぐ。
   */
  acceptingSegments: boolean;
  /** 保存中のsegment書き込み。要約前に必ず待ち、要約・削除後に本文が残らないようにする。 */
  pendingSegmentWrites: Set<Promise<unknown>>;
  /** Force-close in-flight local inference HTTP when the person withdraws. */
  localWhisperControllers: Map<string, Set<AbortController>>;
  /** Never publish a partially recognized session as a finished summary. */
  localWhisperFailure: boolean;
  /** Total audio seconds already budgeted for OpenAI requests in this session. */
  openAiAudioSeconds: number;
  speakingHandler?: (userId: string) => void;
}

/**
 * guildIdごとにアクティブなVC Recapセッションを保持する(プロセス内メモリのみ。
 * VoiceConnection自体は永続化できないため、bot再起動を跨いだセッション復元は行わない)。
 */
const activeSessions = new Map<string, ActiveVcRecapSession>();

/**
 * stopVcRecapでactiveSessionsから外した後、最終セグメントのflush中のセッション。
 * flush中も同意取り消し(revokeVcRecapConsent)を即座に反映するため保持する。
 */
const flushingSessions = new Set<ActiveVcRecapSession>();

/**
 * startVcRecapSession作成〜activeSessions登録までの間(DB書き込み・VC接続待ち等、
 * 複数回awaitする区間)に同じguildで2回目の/vc-recap startが割り込むのを防ぐための
 * 同期的な予約セット。
 */
const pendingGuildIds = new Set<string>();

export type StartVcRecapResult =
  | {
      status: 'started';
      sessionId: string;
      consentingCount: number;
      nonConsentingUserIds: string[];
    }
  | { status: 'already_active' }
  | { status: 'no_consenting_members'; nonConsentingUserIds: string[] }
  | { status: 'connection_failed' };

export async function startVcRecap(
  prisma: PrismaClient,
  logger: Logger,
  channel: VoiceBasedChannel,
  startedBy: string,
  autoConsentRoleIds: string[] = [],
): Promise<StartVcRecapResult> {
  if (activeSessions.has(channel.guild.id) || pendingGuildIds.has(channel.guild.id)) {
    return { status: 'already_active' };
  }
  pendingGuildIds.add(channel.guild.id);

  try {
    const members = channel.members.filter((member) => !member.user.bot);
    const memberUserIds = [...members.keys()];
    const baseConsentByUserId = await getVoiceTranscriptionConsentMap(prisma, memberUserIds);
    // 自動同意ロールが設定されている場合のみ、キャッシュに残った剥奪済みロールで
    // 誤って同意扱いにしないようforce fetchする(未設定なら従来通りcacheで十分)。
    const roleIdsByUser = new Map(
      await Promise.all(
        members.map(async (member) => {
          if (autoConsentRoleIds.length === 0) {
            return [member.id, [...member.roles.cache.keys()]] as const;
          }
          const fresh = await channel.guild.members
            .fetch({ user: member.id, force: true })
            .catch(() => null);
          return [member.id, [...(fresh ?? member).roles.cache.keys()]] as const;
        }),
      ),
    );
    const consentByUserId = applyAutoConsentRoles(
      baseConsentByUserId,
      memberUserIds,
      autoConsentRoleIds,
      roleIdsByUser,
    );
    const { consentingUserIds, nonConsentingUserIds } = splitVcRecapParticipants(
      memberUserIds,
      consentByUserId,
    );

    if (consentingUserIds.length === 0) {
      return { status: 'no_consenting_members', nonConsentingUserIds };
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
      guild: channel.guild,
      connection,
      autoConsentRoleIds,
      consentingUserIds: new Set(consentingUserIds),
      activeTranscriptions: new Map(),
      pendingTranscriptions: new Set(),
      activeStreams: new Map(),
      stopping: false,
      acceptingSegments: true,
      pendingSegmentWrites: new Set(),
      localWhisperControllers: new Map(),
      localWhisperFailure: false,
      openAiAudioSeconds: 0,
    };

    connection.on('stateChange', (oldState, newState) => {
      logger.info(
        {
          guildId: channel.guild.id,
          from: oldState.status,
          to: newState.status,
          ...(newState.status === VoiceConnectionStatus.Disconnected
            ? {
                reason: newState.reason,
                closeCode: 'closeCode' in newState ? newState.closeCode : undefined,
              }
            : {}),
        },
        'VC接続状態が変化しました',
      );
      // 4014以外のclose codeではDisconnectedを経由せずSignallingへ戻るため、
      // stateChangeだけでは切断理由(例: 4017 DAVE必須)がログに残らない。
      const networking = 'networking' in newState ? newState.networking : undefined;
      const previousNetworking = 'networking' in oldState ? oldState.networking : undefined;
      if (networking && networking !== previousNetworking) {
        networking.on('close', (closeCode) => {
          logger.warn({ guildId: channel.guild.id, closeCode }, 'VC音声WebSocketが切断されました');
        });
      }
    });
    connection.on('error', (err) => {
      logger.warn({ err, guildId: channel.guild.id }, 'VC接続でエラーが発生しました');
    });

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
      nonConsentingUserIds,
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

    let task: Promise<void>;
    const clearCapture = () => {
      if (session.activeTranscriptions.get(userId) === task) {
        session.activeTranscriptions.delete(userId);
      }
    };
    task = (async () => {
      // 同意状態はセッション開始時点で固定せず、発言開始のたびに都度再確認する。
      // `/herta-privacy voice-consent false`で同意を取り消した後の発言は対象外にするため。
      // ロールによる自動同意はDBへ永続化しないランタイムオーバーレイのため、ロール剥奪時は
      // 次の発言開始イベントで即座に明示的な同意状態へ戻る。本人が拒否・取り消しを選んで
      // いる場合はロールがあっても対象外(applyAutoConsentRoles)。
      const baseConsentMap = await getVoiceTranscriptionConsentMap(prisma, [userId]);
      // GuildMembers intentは任意設定のため、speaking.cacheだけではロール剥奪が
      // 反映されない場合がある(Intent無しだとGuildMemberUpdateイベントを受信できず
      // キャッシュが更新されない)。単一メンバーのfetchはIntent不要でREST経由で
      // 常に最新を取得できるため、都度fetchする。
      const member = await session.guild.members
        .fetch({ user: userId, force: true })
        .catch(() => null);
      const roleIds = [...(member?.roles.cache.keys() ?? [])];
      const consentMap = applyAutoConsentRoles(
        baseConsentMap,
        [userId],
        session.autoConsentRoleIds,
        new Map([[userId, roleIds]]),
      );
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

      await transcribeSpeaker(prisma, logger, session, userId, clearCapture);
    })()
      .catch((error: unknown) => {
        logger.warn({ err: error, guildId: session.guildId, userId }, 'VC文字起こし開始に失敗');
      })
      .finally(() => {
        clearCapture();
        session.pendingTranscriptions.delete(task);
      });
    session.activeTranscriptions.set(userId, task);
    session.pendingTranscriptions.add(task);
  };
  session.speakingHandler = speakingHandler;
  session.connection.receiver.speaking.on('start', speakingHandler);
}

async function transcribeSpeaker(
  prisma: PrismaClient,
  logger: Logger,
  session: ActiveVcRecapSession,
  userId: string,
  onCaptureEnd: () => void,
): Promise<void> {
  const config = resolveVcRecapTranscriberConfig();
  // Preserve the established AWS-only consent path for people who have not
  // separately approved sending raw speech to OpenAI. Never auto-upgrade them.
  const cloudProvider = config.provider === 'whisper-1' || config.provider === 'gpt-transcribe';
  const useOpenAi =
    cloudProvider &&
    config.openAiAudioEnabled &&
    (await hasVcRecapOpenAiAudioConsent(prisma, userId));
  // A deliberately selected local provider NEVER falls back to AWS or OpenAI.
  // Only one explicitly allowlisted canary Guild can override AWS default.
  // Global local-whisper mode without an explicit allowlist is disabled, NOT
  // silently routed to a cloud/paid provider.
  const provider = canUseLocalWhisperCanary(config, session.guildId)
    ? 'local-whisper'
    : config.provider === 'local-whisper'
      ? 'disabled'
      : useOpenAi
        ? config.provider
        : 'aws';
  if (provider === 'disabled') {
    logger.warn({ guildId: session.guildId }, 'Local WhisperのCanary設定が未完了です');
    return;
  }
  const credential = provider === 'aws' ? await resolveAwsTranscribeCredential(prisma) : null;
  const openAiCredential =
    provider === 'whisper-1' || provider === 'gpt-transcribe'
      ? await resolveAiOpenAiCredential({ prisma })
      : null;
  if (provider === 'aws' && !credential) {
    logger.warn({ guildId: session.guildId, userId }, 'AWS Transcribe認証情報が未設定です');
    return;
  }
  if ((provider === 'whisper-1' || provider === 'gpt-transcribe') && !openAiCredential?.apiKey) {
    logger.warn({ guildId: session.guildId, userId }, 'OpenAI音声処理の認証情報が未設定です');
    return;
  }
  if (session.stopping || !session.consentingUserIds.has(userId)) return;

  const opusStream = session.connection.receiver.subscribe(userId, {
    end: { behavior: EndBehaviorType.AfterSilence, duration: SPEECH_END_SILENCE_MS },
  });
  const speakerStream = linkSpeakerAudioStream(
    opusStream,
    new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 }),
  );
  session.activeStreams.set(userId, speakerStream);
  const localController = provider === 'local-whisper' ? new AbortController() : null;
  if (localController) {
    let set = session.localWhisperControllers.get(userId);
    if (!set) {
      set = new Set();
      session.localWhisperControllers.set(userId, set);
    }
    set.add(localController);
  }
  // Preserve the existing AWS streaming lifetime. Only OpenAI file uploads
  // release capture ownership on PCM end so a new speech burst is not lost.
  if (provider !== 'aws') {
    speakerStream.pcm.once('end', onCaptureEnd);
    speakerStream.pcm.once('close', onCaptureEnd);
  }

  let localConsentDenied = false;
  try {
    const onSegment = async (segment: { text: string; startedAt: Date; endedAt: Date }) => {
      // 文字起こし中に同意が取り消された、またはstopVcRecapのflushが打ち切られた場合、
      // 確定済みセグメントであっても保存しない。
      if (!session.acceptingSegments || !session.consentingUserIds.has(userId)) return;
      const append =
        provider === 'local-whisper'
          ? appendLocalVcRecapSegmentIfConsented
          : appendVcRecapTranscriptSegment;
      const write = append(prisma, {
        sessionId: session.sessionId,
        userId,
        text: segment.text,
        startedAt: segment.startedAt,
        endedAt: segment.endedAt,
      });
      session.pendingSegmentWrites.add(write);
      try {
        await write;
      } finally {
        session.pendingSegmentWrites.delete(write);
      }
    };
    if (provider === 'aws') {
      if (!credential) return;
      await transcribePcmStream(credential, toMonoChunks(speakerStream.pcm), onSegment);
    } else if (provider === 'local-whisper') {
      await transcribePcmWithLocalWhisper(toMonoChunks(speakerStream.pcm), onSegment, {
        token: process.env['VC_RECAP_LOCAL_WHISPER_TOKEN'] ?? '',
        signal: localController?.signal,
        mayProcess: async () => {
          if (!session.acceptingSegments || !session.consentingUserIds.has(userId)) {
            localConsentDenied = true;
            return false;
          }
          // An explicit existing transcription consent is required for new
          // local processing; role-based inferred consent is insufficient.
          const [consent, erasure] = await Promise.all([
            prisma.userDataConsent.findUnique({
              where: { userId },
              select: {
                voiceTranscriptionConsent: true,
                voiceTranscriptRetentionConsentedAt: true,
              },
            }),
            prisma.vcRecapErasureRequest.findUnique({
              where: { userId },
              select: { userId: true },
            }),
          ]);
          const allowed =
            erasure === null &&
            consent?.voiceTranscriptionConsent === true &&
            !!consent.voiceTranscriptRetentionConsentedAt &&
            session.acceptingSegments &&
            session.consentingUserIds.has(userId);
          if (!allowed) localConsentDenied = true;
          return allowed;
        },
      });
    } else {
      if (!openAiCredential?.apiKey) return;
      await transcribePcmWithOpenAi(toMonoChunks(speakerStream.pcm), onSegment, {
        apiKey: openAiCredential.apiKey,
        model: provider,
        mayUpload: async (audioSeconds) => {
          if (!session.acceptingSegments || !session.consentingUserIds.has(userId)) return false;
          if (!(await hasVcRecapOpenAiAudioConsent(prisma, userId))) return false;
          // The user may revoke consent or stop the session while the DB
          // query is in flight. Re-check the in-memory state BEFORE upload.
          if (!session.acceptingSegments || !session.consentingUserIds.has(userId)) return false;
          if (session.openAiAudioSeconds + audioSeconds > config.maxSessionAudioSeconds) {
            logger.warn({ guildId: session.guildId }, 'VC OpenAI音声処理のセッション予算上限');
            return false;
          }
          // Event-loop execution is synchronous after await: concurrent
          // speakers cannot increment this counter between check and reserve.
          session.openAiAudioSeconds += audioSeconds;
          return true;
        },
      });
    }
  } catch (error) {
    if (
      provider === 'local-whisper' &&
      shouldMarkLocalWhisperSessionFailed(localConsentDenied, localController?.signal.aborted ?? false)
    ) {
      session.localWhisperFailure = true;
    }
    // 1人の文字起こし失敗でセッション全体を失敗させない(他の参加者の文字起こしは継続する)。
    logger.warn({ err: error, guildId: session.guildId, userId }, 'VC文字起こしに失敗しました');
  } finally {
    if (localController) {
      const set = session.localWhisperControllers.get(userId);
      set?.delete(localController);
      if (set?.size === 0) session.localWhisperControllers.delete(userId);
    }
    if (session.activeStreams.get(userId) === speakerStream) {
      session.activeStreams.delete(userId);
    }
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
  flushingSessions.add(session);

  // stoppingをtrueにし、wireSpeakingHandlerが登録したリスナーだけ外すことで、
  // 後続の'start'イベントによる新規購読(cleanup後の書き込み)を防ぐ。
  session.stopping = true;
  if (session.speakingHandler) {
    session.connection.receiver.speaking.off('start', session.speakingHandler);
  }

  // 参加者が話し続けている場合、OpusストリームはAfterSilence条件に到達せず
  // activeTranscriptionsのPromiseが解決しないままになる。受信を止めてPCMを流し切り、
  // 発話中だった分の最終セグメントを受け取ってから要約する。Transcribeが応答しない
  // 場合でもstopが止まらないよう、上限を超えたら強制中断する。
  for (const stream of session.activeStreams.values()) {
    stream.end();
  }
  // File transcription is not streaming; allow a bounded post-speech upload.
  // AWS streaming keeps its existing 5s flush budget.
  const config = resolveVcRecapTranscriberConfig();
  const isLocalCanary = canUseLocalWhisperCanary(config, guildId);
  const flushMs = config.provider === 'aws' && !isLocalCanary ? STOP_FLUSH_TIMEOUT_MS : 20_000;
  const flushed = await settleWithin(session.pendingTranscriptions.values(), flushMs);
  session.acceptingSegments = false;
  if (!flushed) {
    logger.warn({ guildId, sessionId: session.sessionId }, 'VC文字起こしのflushを打ち切りました');
    for (const stream of session.activeStreams.values()) {
      stream.abort();
    }
    for (const controllers of session.localWhisperControllers.values()) {
      for (const controller of controllers) controller.abort();
    }
    await settleWithin(session.pendingTranscriptions.values(), STOP_ABORT_TIMEOUT_MS);
  }
  flushingSessions.delete(session);
  // acceptingSegments=false以降に新しい書き込みは始まらないため、既に始まった分だけ待てばよい。
  await Promise.allSettled([...session.pendingSegmentWrites]);
  session.connection.destroy();

  // Local inference may outlast the bounded flush interval or fail mid-queue.
  // Never silently summarize only the recognized prefix of the conversation.
  if (rejectIncompleteLocalVcRecap(isLocalCanary, flushed, session.localWhisperFailure)) {
    await failVcRecapSession(prisma, session.sessionId, []);
    logger.warn(
      { guildId, sessionId: session.sessionId },
      'Local Whisperが未確定のため要約を中止しました',
    );
    return { status: 'summarize_failed', sessionId: session.sessionId };
  }

  const segments = await listVcRecapTranscriptSegments(prisma, session.sessionId);
  // 本文保存に同意した参加者の本文だけを保持期間まで残す(stop時点の同意状態で判定する)。
  // 取得に失敗した場合は誰の本文も残さない側に倒し、要約とセッションの終了は続ける
  // (失敗で止めるとセッションがactiveのまま未同意者の本文が残る)。
  const retainedUserIds = await getVoiceTranscriptRetentionUserIds(prisma, [
    ...session.consentingUserIds,
  ]).then(
    (userIds) => [...userIds],
    (error: unknown) => {
      logger.warn(
        { err: error, guildId, sessionId: session.sessionId },
        'VC本文保存同意の取得に失敗したため、本文を保存せずに終了します',
      );
      return [];
    },
  );
  const result = await summarizeVcRecapSession(prisma, guildId, segments);
  if (!result) {
    await failVcRecapSession(prisma, session.sessionId, retainedUserIds);
    logger.warn({ guildId, sessionId: session.sessionId }, 'VC要約の生成に失敗しました');
    return { status: 'summarize_failed', sessionId: session.sessionId };
  }

  await completeVcRecapSession(prisma, session.sessionId, { ...result, retainedUserIds });
  return { status: 'completed', sessionId: session.sessionId };
}

/**
 * `/herta-privacy voice-consent false`実行時に呼ぶ。進行中のVC Recapセッションがあれば
 * 即座にそのユーザーを対象外にし、購読中のストリームを破棄する(次の発言開始イベントでの
 * 同意再確認だけでは、取り消し時点で発言中だった分の文字起こし・segment保存を止められないため)。
 */
export function revokeVcRecapConsent(userId: string): void {
  for (const session of [...activeSessions.values(), ...flushingSessions]) {
    session.consentingUserIds.delete(userId);
    session.activeStreams.get(userId)?.abort();
    for (const controller of session.localWhisperControllers.get(userId) ?? []) {
      controller.abort();
    }
  }
}

/** 全Promiseがms以内に決着すればtrue、上限に達した場合はfalseを返す。 */
async function settleWithin(promises: Iterable<Promise<unknown>>, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  try {
    return await Promise.race([Promise.allSettled([...promises]).then(() => true), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function isVcRecapActive(guildId: string): boolean {
  return activeSessions.has(guildId);
}

export function activeVcRecapChannelId(guildId: string): string | null {
  return activeSessions.get(guildId)?.channelId ?? null;
}
