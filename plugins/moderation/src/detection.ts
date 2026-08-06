import {
  normalizeAutomaticText,
  type ModerationConfig,
} from './config.js';

export type AutomaticModerationFindingKind =
  | 'word_exact'
  | 'word_contains'
  | 'word_regex'
  | 'invite_link'
  | 'mention_burst'
  | 'message_burst'
  | 'duplicate_message';

export interface AutomaticModerationFinding {
  kind: AutomaticModerationFindingKind;
  messageLength: number;
  observedCount?: number;
  threshold?: number;
  ruleIndex?: number;
}

export interface AutomaticModerationMessageSnapshot {
  guildId: string;
  channelId: string;
  userId: string;
  roleIds: string[];
  content: string;
  mentionCount: number;
  createdAtMs?: number;
}

interface RecentMessage {
  at: number;
  fingerprint: string;
}

interface UserWindow {
  lastSeenAt: number;
  messages: RecentMessage[];
}

const MAX_RECENT_MESSAGES_PER_USER = 100;
const MAX_TRACKED_USERS = 5_000;
const USER_STATE_TTL_MS = 10 * 60 * 1000;
const INVITE_PATTERN = /(?:discord(?:app)?\.com\/invite|discord\.gg)\/([a-z0-9-]{2,64})/giu;

export class AutomaticModerationDetector {
  private readonly windows = new Map<string, UserWindow>();
  private evaluations = 0;

  evaluate(
    message: AutomaticModerationMessageSnapshot,
    config: ModerationConfig,
  ): AutomaticModerationFinding[] {
    const now = message.createdAtMs ?? Date.now();
    const normalizedContent = normalizeAutomaticText(message.content);
    if (!normalizedContent || message.content.length > config.autoMaxMessageLength) return [];
    if (isExempt(message, config)) return [];

    const findings: AutomaticModerationFinding[] = [];
    const messageLength = message.content.length;

    const exactIndex = config.autoExactWords.indexOf(normalizedContent);
    if (exactIndex >= 0) {
      findings.push({ kind: 'word_exact', messageLength, ruleIndex: exactIndex });
    }

    const containsIndex = config.autoContainsWords.findIndex((word) =>
      normalizedContent.includes(word),
    );
    if (containsIndex >= 0) {
      findings.push({ kind: 'word_contains', messageLength, ruleIndex: containsIndex });
    }

    const regexIndex = config.autoRegexPatterns.findIndex((pattern) =>
      new RegExp(pattern, 'iu').test(normalizedContent),
    );
    if (regexIndex >= 0) {
      findings.push({ kind: 'word_regex', messageLength, ruleIndex: regexIndex });
    }

    if (config.autoInviteFilterEnabled) {
      const inviteCodes = extractInviteCodes(normalizedContent);
      if (inviteCodes.some((code) => !config.autoInviteAllowlist.includes(code))) {
        findings.push({ kind: 'invite_link', messageLength, observedCount: inviteCodes.length });
      }
    }

    if (config.autoMentionLimit > 0 && message.mentionCount >= config.autoMentionLimit) {
      findings.push({
        kind: 'mention_burst',
        messageLength,
        observedCount: message.mentionCount,
        threshold: config.autoMentionLimit,
      });
    }

    this.evaluateSlidingWindows(message, normalizedContent, config, now, findings);
    this.evaluations += 1;
    if (this.evaluations % 256 === 0 || this.windows.size > MAX_TRACKED_USERS) {
      this.prune(now);
    }

    return findings;
  }

  clearGuild(guildId: string): void {
    const prefix = `${guildId}:`;
    for (const key of this.windows.keys()) {
      if (key.startsWith(prefix)) this.windows.delete(key);
    }
  }

  clearAll(): void {
    this.windows.clear();
  }

  private evaluateSlidingWindows(
    message: AutomaticModerationMessageSnapshot,
    normalizedContent: string,
    config: ModerationConfig,
    now: number,
    findings: AutomaticModerationFinding[],
  ): void {
    if (config.autoBurstMessageLimit === 0 && config.autoDuplicateMessageLimit === 0) return;

    const key = `${message.guildId}:${message.userId}`;
    const maxWindowMs =
      Math.max(config.autoBurstWindowSeconds, config.autoDuplicateWindowSeconds) * 1000;
    const existing = this.windows.get(key);
    const messages = (existing?.messages ?? []).filter((item) => now - item.at <= maxWindowMs);
    const fingerprint = createFingerprint(normalizedContent);
    messages.push({ at: now, fingerprint });
    if (messages.length > MAX_RECENT_MESSAGES_PER_USER) {
      messages.splice(0, messages.length - MAX_RECENT_MESSAGES_PER_USER);
    }
    this.windows.set(key, { lastSeenAt: now, messages });

    if (config.autoBurstMessageLimit > 0) {
      const burstWindowMs = config.autoBurstWindowSeconds * 1000;
      const burstCount = messages.filter((item) => now - item.at <= burstWindowMs).length;
      if (burstCount >= config.autoBurstMessageLimit) {
        findings.push({
          kind: 'message_burst',
          messageLength: message.content.length,
          observedCount: burstCount,
          threshold: config.autoBurstMessageLimit,
        });
      }
    }

    if (config.autoDuplicateMessageLimit > 0) {
      const duplicateWindowMs = config.autoDuplicateWindowSeconds * 1000;
      const duplicateCount = messages.filter(
        (item) => now - item.at <= duplicateWindowMs && item.fingerprint === fingerprint,
      ).length;
      if (duplicateCount >= config.autoDuplicateMessageLimit) {
        findings.push({
          kind: 'duplicate_message',
          messageLength: message.content.length,
          observedCount: duplicateCount,
          threshold: config.autoDuplicateMessageLimit,
        });
      }
    }
  }

  private prune(now: number): void {
    for (const [key, window] of this.windows) {
      if (now - window.lastSeenAt > USER_STATE_TTL_MS) this.windows.delete(key);
    }

    while (this.windows.size > MAX_TRACKED_USERS) {
      const oldestKey = this.windows.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.windows.delete(oldestKey);
    }
  }
}

export function isExempt(
  message: Pick<AutomaticModerationMessageSnapshot, 'channelId' | 'userId' | 'roleIds'>,
  config: Pick<
    ModerationConfig,
    'autoExemptChannelIds' | 'autoExemptUserIds' | 'autoExemptRoleIds'
  >,
): boolean {
  return (
    config.autoExemptChannelIds.includes(message.channelId) ||
    config.autoExemptUserIds.includes(message.userId) ||
    message.roleIds.some((roleId) => config.autoExemptRoleIds.includes(roleId))
  );
}

export function extractInviteCodes(content: string): string[] {
  const codes: string[] = [];
  for (const match of content.matchAll(INVITE_PATTERN)) {
    const code = match[1]?.toLocaleLowerCase('en-US');
    if (code) codes.push(code);
  }
  return [...new Set(codes)];
}

function createFingerprint(content: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
