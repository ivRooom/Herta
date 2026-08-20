import type { PluginManifest } from '@herta/shared';
import { moderationManifest as baseModerationManifest } from './manifest-base.js';

const baseProperties = isRecord(baseModerationManifest.configSchema.properties)
  ? baseModerationManifest.configSchema.properties
  : {};

export const moderationManifest: PluginManifest = {
  ...baseModerationManifest,
  version: '2.5.0',
  configSchema: {
    ...baseModerationManifest.configSchema,
    properties: {
      ...baseProperties,
      autoBurstScope: {
        type: 'string',
        title: '連投検知の集計範囲',
        description:
          'guildは同一ユーザーのサーバー全体投稿を集計し、channelはチャンネルごとに独立して集計します',
        enum: ['guild', 'channel'],
        default: 'guild',
      },
      autoDuplicateScope: {
        type: 'string',
        title: '重複投稿検知の集計範囲',
        description:
          'guildはサーバー内の別チャンネルも横断し、channelは同一チャンネル内だけで重複投稿を集計します',
        enum: ['guild', 'channel'],
        default: 'guild',
      },
      autoDuplicateMinimumLength: {
        type: 'integer',
        title: '重複投稿として数える最小文字数',
        description: '短い相づちや定型リアクションを重複投稿検知から除外できます',
        minimum: 1,
        maximum: 200,
        default: 1,
      },
    },
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
