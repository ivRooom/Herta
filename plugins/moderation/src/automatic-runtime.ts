import type { PluginEventHandler, PluginRuntimeContext } from '@herta/plugin-sdk';
import {
  normalizeModerationConfig,
  type ModerationConfig,
} from './config.js';
import {
  AutomaticModerationDetector,
  type AutomaticModerationFinding,
} from './detection.js';

interface ModerationMessageRoleCache {
  has(roleId: string): boolean;
}

interface ModerationMessage {
  guildId: string | null;
  channelId: string;
  content: string;
  createdTimestamp: number;
  webhookId: string | null;
  system: boolean;
  author: { id: string; bot: boolean };
  member: { roles: { cache: ModerationMessageRoleCache } } | null;
  mentions: {
    users: { size: number };
    roles: { size: number };
    everyone: boolean;
  };
}

type ModerationAutomaticRuntimeContext = PluginRuntimeContext<
  ModerationConfig,
  unknown,
  unknown
>;

const detectors = new Map<string, AutomaticModerationDetector>();

export function createModerationAutomaticEvents(
  context: ModerationAutomaticRuntimeContext,
): PluginEventHandler<ModerationConfig, unknown, unknown>[] {
  const config = normalizeModerationConfig(context.config);
  if (config.automaticMode !== 'observe') return [];

  return [
    {
      event: 'messageCreate',
      async handler(runtimeContext, ...args) {
        const message = args[0] as ModerationMessage | undefined;
        if (!message) return;
        observeAutomaticModeration(runtimeContext, message);
      },
    },
  ];
}

export function resetModerationAutomaticDetector(guildId: string): void {
  detectors.get(guildId)?.clearGuild(guildId);
  detectors.delete(guildId);
}

function observeAutomaticModeration(
  context: ModerationAutomaticRuntimeContext,
  message: ModerationMessage,
): void {
  if (
    !message.guildId ||
    message.guildId !== context.guildId ||
    message.author.bot ||
    message.webhookId ||
    message.system ||
    !message.content
  ) {
    return;
  }

  const config = normalizeModerationConfig(context.config);
  if (config.automaticMode !== 'observe') return;

  const detector = getDetector(context.guildId);
  const roleIds = config.autoExemptRoleIds.filter((roleId) =>
    message.member?.roles.cache.has(roleId),
  );
  const findings = detector.evaluate(
    {
      guildId: context.guildId,
      channelId: message.channelId,
      userId: message.author.id,
      roleIds,
      content: message.content,
      mentionCount:
        message.mentions.users.size +
        message.mentions.roles.size +
        (message.mentions.everyone ? 1 : 0),
      createdAtMs: message.createdTimestamp,
    },
    config,
  );

  for (const finding of findings) {
    logFinding(context, message, finding);
  }
}

function getDetector(guildId: string): AutomaticModerationDetector {
  const existing = detectors.get(guildId);
  if (existing) return existing;
  const detector = new AutomaticModerationDetector();
  detectors.set(guildId, detector);
  return detector;
}

function logFinding(
  context: ModerationAutomaticRuntimeContext,
  message: ModerationMessage,
  finding: AutomaticModerationFinding,
): void {
  context.logger.info(
    {
      guildId: context.guildId,
      channelId: message.channelId,
      userId: message.author.id,
      mode: 'observe',
      detectionKind: finding.kind,
      messageLength: finding.messageLength,
      observedCount: finding.observedCount,
      threshold: finding.threshold,
      ruleIndex: finding.ruleIndex,
    },
    'Moderation自動検知のobserveイベントを記録しました',
  );
}
