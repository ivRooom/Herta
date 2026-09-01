import type { Logger } from '@herta/logger';
import {
  isAiArtifactMessageCandidate,
  type AiArtifactDiscordMessage,
} from './artifact-message-handler.js';

const AI_TYPING_REFRESH_INTERVAL_MS = 8_000;

interface AiTypingCapableMessage extends AiArtifactDiscordMessage {
  channel?: {
    sendTyping?(): Promise<unknown>;
  } | null;
}

export interface AiTypingIndicator {
  stop(): void;
}

const NOOP_TYPING_INDICATOR: AiTypingIndicator = { stop() {} };

/**
 * Start Discord's native typing indicator only for a server-side verified AI candidate.
 * Typing is best-effort UX: Discord typing failures never fail or delay the AI request itself.
 */
export function startAiTypingIndicator(
  message: AiArtifactDiscordMessage | undefined,
  botUserId: string | null,
  logger: Pick<Logger, 'warn'>,
): AiTypingIndicator {
  if (!isAiArtifactMessageCandidate(message, botUserId)) return NOOP_TYPING_INDICATOR;

  const typingMessage = message as AiTypingCapableMessage;
  const sendTyping = typingMessage.channel?.sendTyping;
  if (typeof sendTyping !== 'function') return NOOP_TYPING_INDICATOR;

  let stopped = false;
  let inFlight = false;
  let refreshTimer: ReturnType<typeof setInterval> | null = null;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  };

  const refresh = async () => {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      await sendTyping.call(typingMessage.channel);
    } catch (error) {
      stop();
      logger.warn(
        {
          guildId: message.guildId,
          errorName: error instanceof Error ? error.name : 'UnknownError',
          result: 'typing_failed',
        },
        'AI Discord typing indicatorの送信に失敗しました',
      );
    } finally {
      inFlight = false;
    }
  };

  refreshTimer = setInterval(() => {
    void refresh();
  }, AI_TYPING_REFRESH_INTERVAL_MS);
  refreshTimer.unref?.();
  void refresh();

  return { stop };
}
