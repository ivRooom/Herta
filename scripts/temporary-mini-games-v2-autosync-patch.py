from pathlib import Path

# Achievements runtime: delayed sync after Mini Games interactions.
p = Path('apps/bot/src/plugins/achievements.ts')
s = p.read_text()
marker = "interface AchievementNotificationTarget {\n"
assert marker in s
interaction_type = """interface MiniGameAchievementInteraction {
  guildId: string | null;
  user: { id: string; bot?: boolean };
  guild: AchievementGuild | null;
  commandName?: string;
  customId?: string;
  isChatInputCommand(): boolean;
  isButton(): boolean;
}

"""
s = s.replace(marker, interaction_type + marker, 1)
needle = "      {\n        event: 'voiceStateUpdate',\n        async handler(context, ...args) {\n          await handleAchievementVoice("
assert needle in s
# Insert interaction handler before voice handler.
interaction_handler = """      {
        event: 'interactionCreate',
        async handler(context, ...args) {
          scheduleMiniGameAchievementSync(
            context as AchievementsRuntimeContext,
            args[0] as MiniGameAchievementInteraction | undefined,
          );
        },
      },
"""
s = s.replace("      {\n        event: 'voiceStateUpdate',", interaction_handler + "      {\n        event: 'voiceStateUpdate',", 1)
insert_before = "async function maybeAutoSync(\n"
assert insert_before in s
autosync = """export function isMiniGameAchievementInteraction(
  interaction: MiniGameAchievementInteraction | undefined,
): boolean {
  if (!interaction?.guildId || interaction.user.bot) return false;
  if (
    interaction.isChatInputCommand() &&
    (interaction.commandName === 'coinflip' ||
      interaction.commandName === 'highlow' ||
      interaction.commandName === 'blackjack')
  ) {
    return true;
  }
  return interaction.isButton() && interaction.customId?.startsWith('herta:mini-games:v1:') === true;
}

function scheduleMiniGameAchievementSync(
  context: AchievementsRuntimeContext,
  interaction: MiniGameAchievementInteraction | undefined,
): void {
  if (!isMiniGameAchievementInteraction(interaction) || !interaction?.guildId) return;
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const target: AchievementNotificationTarget = { guild: interaction.guild };
  const timer = setTimeout(() => {
    void maybeAutoSync(context, guildId, userId, target, true).catch((error) => {
      context.logger.warn({ err: error, guildId, userId }, 'Mini Games後のAchievement同期に失敗しました');
    });
  }, 400);
  timer.unref?.();
}

"""
s = s.replace(insert_before, autosync + insert_before, 1)
p.write_text(s)

# Community Challenge runtime: delayed sync after game interactions.
p = Path('apps/bot/src/plugins/community-challenge.ts')
s = p.read_text()
marker = "interface CompletionNotificationTarget {\n"
assert marker in s
interaction_type = """interface MiniGameChallengeInteraction {
  guildId: string | null;
  user: { id: string; bot?: boolean };
  guild: ChallengeGuild | null;
  commandName?: string;
  customId?: string;
  isChatInputCommand(): boolean;
  isButton(): boolean;
}

"""
s = s.replace(marker, interaction_type + marker, 1)
s = s.replace("      {\n        event: 'voiceStateUpdate',", """      {
        event: 'interactionCreate',
        async handler(context, ...args) {
          scheduleMiniGameChallengeSync(
            context as CommunityChallengeContext,
            args[0] as MiniGameChallengeInteraction | undefined,
          );
        },
      },
      {
        event: 'voiceStateUpdate',""", 1)
insert_before = "async function maybeAutoSync(\n"
assert insert_before in s
autosync = """export function isMiniGameChallengeInteraction(
  interaction: MiniGameChallengeInteraction | undefined,
): boolean {
  if (!interaction?.guildId || interaction.user.bot) return false;
  if (
    interaction.isChatInputCommand() &&
    (interaction.commandName === 'coinflip' ||
      interaction.commandName === 'highlow' ||
      interaction.commandName === 'blackjack')
  ) {
    return true;
  }
  return interaction.isButton() && interaction.customId?.startsWith('herta:mini-games:v1:') === true;
}

function scheduleMiniGameChallengeSync(
  context: CommunityChallengeContext,
  interaction: MiniGameChallengeInteraction | undefined,
): void {
  if (!isMiniGameChallengeInteraction(interaction) || !interaction?.guildId) return;
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const target: CompletionNotificationTarget = { guild: interaction.guild };
  const timer = setTimeout(() => {
    void maybeAutoSync(context, guildId, userId, target, true).catch((error) => {
      context.logger.warn({ err: error, guildId, userId }, 'Mini Games後のChallenge同期に失敗しました');
    });
  }, 400);
  timer.unref?.();
}

"""
s = s.replace(insert_before, autosync + insert_before, 1)
p.write_text(s)

# Manifest event contracts and Games category choice.
p = Path('packages/plugin-catalog/src/manifests/achievements.ts')
s = p.read_text()
assert "events: ['messageCreate', 'messageReactionAdd', 'voiceStateUpdate']," in s
s = s.replace(
    "events: ['messageCreate', 'messageReactionAdd', 'voiceStateUpdate'],",
    "events: ['messageCreate', 'messageReactionAdd', 'interactionCreate', 'voiceStateUpdate'],",
    1,
)
assert "            { name: 'Challenge', value: 'challenge' }," in s
s = s.replace(
    "            { name: 'Challenge', value: 'challenge' },",
    "            { name: 'Challenge', value: 'challenge' },\n            { name: 'Games', value: 'games' },",
    1,
)
p.write_text(s)

p = Path('packages/plugin-catalog/src/manifests/community-challenge.ts')
s = p.read_text()
assert "events: ['messageCreate', 'messageReactionAdd', 'voiceStateUpdate']," in s
s = s.replace(
    "events: ['messageCreate', 'messageReactionAdd', 'voiceStateUpdate'],",
    "events: ['messageCreate', 'messageReactionAdd', 'interactionCreate', 'voiceStateUpdate'],",
    1,
)
p.write_text(s)
