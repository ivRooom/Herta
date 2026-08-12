import { PrismaClient } from '@herta/db';
import { autoResponseManifest } from '@herta/plugin-auto-response/manifest';
import { dailyContentManifest } from '@herta/plugin-daily-content/manifest';
import { lfgManifest } from '@herta/plugin-lfg/manifest';
import { moderationManifest } from '@herta/plugin-moderation/manifest';
import { quoteManifest } from '@herta/plugin-quote/manifest';
import { teamSplitManifest } from '@herta/plugin-team-split/manifest';
import type { PluginManifest } from '@herta/shared';
import { achievementsManifest } from './manifests/achievements.js';
import { activityRulesManifest } from './manifests/activity-rules.js';
import { afkManifest } from './manifests/afk.js';
import { birthdayRoleManifest } from './manifests/birthday-role.js';
import { channelPolicyManifest } from './manifests/channel-policy.js';
import { communityProfileManifest } from './manifests/community-profile.js';
import { communityChallengeManifest } from './manifests/community-challenge.js';
import { eventRsvpManifest } from './manifests/event-rsvp.js';
import { giveawayManifest } from './manifests/giveaway.js';
import { onboardingManifest } from './manifests/onboarding.js';
import { pollManifest } from './manifests/poll.js';
import { reminderManifest } from './manifests/reminder.js';
import { roleManagerManifest } from './manifests/role-manager.js';
import { suggestionManifest } from './manifests/suggestion.js';
import { serverStatsManifest } from './manifests/server-stats.js';
import { xpLevelManifest } from './manifests/xp-level.js';

export { achievementsManifest } from './manifests/achievements.js';
export { activityRulesManifest } from './manifests/activity-rules.js';
export { afkManifest } from './manifests/afk.js';
export { birthdayRoleManifest } from './manifests/birthday-role.js';
export { channelPolicyManifest } from './manifests/channel-policy.js';
export { communityProfileManifest } from './manifests/community-profile.js';
export { communityChallengeManifest } from './manifests/community-challenge.js';
export { eventRsvpManifest } from './manifests/event-rsvp.js';
export { giveawayManifest } from './manifests/giveaway.js';
export { onboardingManifest } from './manifests/onboarding.js';
export { pollManifest } from './manifests/poll.js';
export { reminderManifest } from './manifests/reminder.js';
export { roleManagerManifest } from './manifests/role-manager.js';
export { suggestionManifest } from './manifests/suggestion.js';
export { serverStatsManifest } from './manifests/server-stats.js';
export { xpLevelManifest } from './manifests/xp-level.js';

const rawPluginManifests: PluginManifest[] = [
  achievementsManifest,
  activityRulesManifest,
  afkManifest,
  autoResponseManifest,
  birthdayRoleManifest,
  channelPolicyManifest,
  communityProfileManifest,
  communityChallengeManifest,
  dailyContentManifest,
  eventRsvpManifest,
  giveawayManifest,
  lfgManifest,
  moderationManifest,
  onboardingManifest,
  pollManifest,
  reminderManifest,
  quoteManifest,
  roleManagerManifest,
  suggestionManifest,
  serverStatsManifest,
  teamSplitManifest,
  xpLevelManifest,
];

const pluginManifests: PluginManifest[] = rawPluginManifests.map((manifest) => ({
  ...manifest,
  configSchema: applyDiscordPickerMetadata(manifest.configSchema) as PluginManifest['configSchema'],
}));

const pluginManifestMap = new Map(pluginManifests.map((manifest) => [manifest.id, manifest]));

export function getPluginManifest(id: string): PluginManifest | undefined {
  return pluginManifestMap.get(id);
}

export function getAllPluginManifests(): PluginManifest[] {
  return [...pluginManifests];
}

export interface EnabledPlugin {
  manifest: PluginManifest;
  config: Record<string, unknown>;
  configVersion: number;
}

/**
 * Guildで有効な公式Pluginと検証済み設定を返す。
 * RuntimeはDB内のコードやpackage名を評価せず、静的Registryだけから実装を解決する。
 */
export async function getEnabledPlugins(
  prisma: PrismaClient,
  guildId: string,
): Promise<EnabledPlugin[]> {
  const rows = await prisma.guildPlugin.findMany({
    where: { guildId, enabled: true },
    include: { plugin: true },
  });

  return rows.flatMap((row: (typeof rows)[number]) => {
    const manifest = getPluginManifest(row.pluginId);
    if (!manifest) return [];

    return [
      {
        manifest,
        config: isRecord(row.config) ? row.config : {},
        configVersion: row.configVersion,
      },
    ];
  });
}

type DiscordPickerWidget = 'discord-channel' | 'discord-role' | 'discord-user' | 'discord-emoji';

const DISCORD_ENTITY_FIELDS: Array<{ pattern: RegExp; widget: DiscordPickerWidget }> = [
  { pattern: /channelIds?$/i, widget: 'discord-channel' },
  { pattern: /roleIds?$/i, widget: 'discord-role' },
  { pattern: /userIds?$/i, widget: 'discord-user' },
  { pattern: /emojiIds?$/i, widget: 'discord-emoji' },
];

/**
 * 公式PluginのSnowflake設定は、Manifest側でUI metadataを明示し忘れても
 * Config Studioでは生ID入力へ退行させずDiscord Entity Pickerへ正規化する。
 * 明示済みのx-herta-uiは常に優先し、Message Target配下は親Widgetへ委譲する。
 */
function applyDiscordPickerMetadata(schema: unknown, insideMessageTarget = false): unknown {
  if (!isRecord(schema)) return schema;

  const ui = isRecord(schema['x-herta-ui']) ? schema['x-herta-ui'] : undefined;
  const messageTarget = insideMessageTarget || ui?.widget === 'discord-message-target';
  const normalized: Record<string, unknown> = { ...schema };

  if (isRecord(schema.properties)) {
    normalized.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([key, property]) => {
        if (!isRecord(property)) return [key, property];

        const expected = DISCORD_ENTITY_FIELDS.find(({ pattern }) => pattern.test(key));
        const propertyUi = isRecord(property['x-herta-ui']) ? property['x-herta-ui'] : undefined;
        const shouldInfer =
          expected &&
          !propertyUi?.widget &&
          !(messageTarget && /^channelId$/i.test(key));
        const withPicker = shouldInfer
          ? {
              ...property,
              'x-herta-ui': {
                ...(propertyUi ?? {}),
                widget: expected.widget,
              },
            }
          : property;

        return [key, applyDiscordPickerMetadata(withPicker, messageTarget)];
      }),
    );
  }

  if (schema.items !== undefined) {
    normalized.items = Array.isArray(schema.items)
      ? schema.items.map((item) => applyDiscordPickerMetadata(item, messageTarget))
      : applyDiscordPickerMetadata(schema.items, messageTarget);
  }

  for (const keyword of ['oneOf', 'anyOf', 'allOf'] as const) {
    const branches = schema[keyword];
    if (Array.isArray(branches)) {
      normalized[keyword] = branches.map((branch) =>
        applyDiscordPickerMetadata(branch, messageTarget),
      );
    }
  }

  for (const keyword of ['if', 'then', 'else'] as const) {
    if (schema[keyword] !== undefined) {
      normalized[keyword] = applyDiscordPickerMetadata(schema[keyword], messageTarget);
    }
  }

  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
