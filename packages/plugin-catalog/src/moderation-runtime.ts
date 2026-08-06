import {
  createModerationAutomaticEvents,
  resetModerationAutomaticDetector,
} from '@herta/plugin-moderation';
import { moderationPlugin as baseModerationPlugin } from '@herta/plugin-moderation/runtime';

export const moderationPlugin: typeof baseModerationPlugin = {
  ...baseModerationPlugin,

  async onEnable(context) {
    resetModerationAutomaticDetector(context.guildId);
    await baseModerationPlugin.onEnable?.(context);
  },

  async onDisable(context) {
    resetModerationAutomaticDetector(context.guildId);
    await baseModerationPlugin.onDisable?.(context);
  },

  provideEvents(context) {
    return [
      ...(baseModerationPlugin.provideEvents?.(context) ?? []),
      ...createModerationAutomaticEvents(context),
    ];
  },
};
