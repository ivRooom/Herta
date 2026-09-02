import type { Logger } from '@herta/logger';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isAiArtifactMessageCandidate,
  normalizeAiTriggerRoleId,
  stripBotMention,
  type AiArtifactDiscordMessage,
} from './artifact-message-handler.js';
import { startAiTypingIndicator } from './typing-indicator.js';

const BOT_USER_ID = '123456789';
const TRIGGER_ROLE_ID = '1534857044589547662';
const OTHER_ROLE_ID = '999999999999999999';

type TypingMessage = AiArtifactDiscordMessage & {
  channel: { sendTyping(): Promise<unknown> };
};

function message(options: {
  content: string;
  mentionedRoleIds?: string[];
  mentionedUserIds?: string[];
  sendTyping?: () => Promise<unknown>;
}): TypingMessage {
  const roleIds = new Set(options.mentionedRoleIds ?? []);
  const userIds = new Set(options.mentionedUserIds ?? []);
  return {
    guildId: 'guild-1',
    channelId: 'channel-1',
    content: options.content,
    webhookId: null,
    author: { id: 'user-1', bot: false },
    member: { id: 'user-1' },
    mentions: {
      users: { has: (id: string) => userIds.has(id) },
      roles: { has: (id: string) => roleIds.has(id) },
    },
    reply: async () => undefined,
    channel: { sendTyping: options.sendTyping ?? (async () => undefined) },
  };
}

function logger(): Pick<Logger, 'warn'> {
  return { warn: vi.fn() } as unknown as Pick<Logger, 'warn'>;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('configured Discord Role AI trigger', () => {
  it('configured Roleのreal mentionだけをAI candidateにする', () => {
    const target = message({
      content: `<@&${TRIGGER_ROLE_ID}> ReactとVueを比較して`,
      mentionedRoleIds: [TRIGGER_ROLE_ID],
    });

    expect(isAiArtifactMessageCandidate(target, BOT_USER_ID, TRIGGER_ROLE_ID)).toBe(true);
  });

  it('別RoleのmentionではAI candidateにしない', () => {
    const target = message({
      content: `<@&${OTHER_ROLE_ID}> ReactとVueを比較して`,
      mentionedRoleIds: [OTHER_ROLE_ID],
    });

    expect(isAiArtifactMessageCandidate(target, BOT_USER_ID, TRIGGER_ROLE_ID)).toBe(false);
  });

  it('Role mention文字列だけをspoofしてもDiscord mention metadataなしではcandidateにしない', () => {
    const target = message({ content: `<@&${TRIGGER_ROLE_ID}> ReactとVueを比較して` });

    expect(isAiArtifactMessageCandidate(target, BOT_USER_ID, TRIGGER_ROLE_ID)).toBe(false);
  });

  it('configured Role tokenをuser inputから除去する', () => {
    expect(
      stripBotMention(
        `<@&${TRIGGER_ROLE_ID}> ReactとVueを詳しく比較して`,
        BOT_USER_ID,
        TRIGGER_ROLE_ID,
      ),
    ).toBe('ReactとVueを詳しく比較して');
  });

  it('Role mentionだけで本文が空ならcandidateにしない', () => {
    const target = message({
      content: `<@&${TRIGGER_ROLE_ID}>`,
      mentionedRoleIds: [TRIGGER_ROLE_ID],
    });

    expect(isAiArtifactMessageCandidate(target, BOT_USER_ID, TRIGGER_ROLE_ID)).toBe(false);
  });

  it('従来のHerta本人mentionはRole設定があっても維持する', () => {
    const target = message({
      content: `<@${BOT_USER_ID}> TypeScriptって何？`,
      mentionedUserIds: [BOT_USER_ID],
    });

    expect(isAiArtifactMessageCandidate(target, BOT_USER_ID, TRIGGER_ROLE_ID)).toBe(true);
  });

  it('invalid Role ID設定はfail closedで無効化する', () => {
    expect(normalizeAiTriggerRoleId(' role-admin ')).toBeNull();
    expect(normalizeAiTriggerRoleId('')).toBeNull();
    expect(normalizeAiTriggerRoleId(null)).toBeNull();
    expect(normalizeAiTriggerRoleId(` ${TRIGGER_ROLE_ID} `)).toBe(TRIGGER_ROLE_ID);
  });

  it('configured Role mentionでもtyping indicatorを開始する', async () => {
    vi.useFakeTimers();
    const sendTyping = vi.fn(async () => undefined);
    const target = message({
      content: `<@&${TRIGGER_ROLE_ID}> TypeScriptって何？`,
      mentionedRoleIds: [TRIGGER_ROLE_ID],
      sendTyping,
    });

    const indicator = startAiTypingIndicator(target, BOT_USER_ID, logger(), TRIGGER_ROLE_ID);
    await vi.advanceTimersByTimeAsync(0);

    expect(sendTyping).toHaveBeenCalledTimes(1);
    indicator.stop();
  });
});
