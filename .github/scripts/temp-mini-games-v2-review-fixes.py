from pathlib import Path
import re


def replace(path: str, old: str, new: str, count: int = 1) -> None:
    file = Path(path)
    text = file.read_text()
    actual = text.count(old)
    assert actual == count, f'{path}: expected {count}, got {actual}: {old[:120]!r}'
    file.write_text(text.replace(old, new, count))


def sub(path: str, pattern: str, replacement: str, count: int = 1) -> None:
    file = Path(path)
    text = file.read_text()
    updated, actual = re.subn(pattern, replacement, text, count=count, flags=re.S)
    assert actual == count, f'{path}: regex expected {count}, got {actual}: {pattern[:120]!r}'
    file.write_text(updated)


# Achievements: subscribe to explicit Mini Games completion events.
replace(
    'apps/bot/src/plugins/achievements.ts',
    "} from './custom-achievements.js';\n",
    "} from './custom-achievements.js';\nimport {\n  subscribeMiniGameCompletion,\n  unsubscribeMiniGameCompletion,\n} from './mini-games-completion-events.js';\n",
)
replace(
    'apps/bot/src/plugins/achievements.ts',
    "export const achievementsPlugin = definePlugin<AchievementsConfig, unknown, PrismaClient>({\n  manifest: achievementsManifest,\n",
    "export const achievementsPlugin = definePlugin<AchievementsConfig, unknown, PrismaClient>({\n  manifest: achievementsManifest,\n  async onEnable(context) {\n    subscribeMiniGameCompletion(`achievements:${context.guildId}`, async (event) => {\n      if (event.guildId !== context.guildId) return;\n      await maybeAutoSync(\n        context,\n        event.guildId,\n        event.userId,\n        {\n          guild: event.guild as unknown as AchievementGuild,\n          reply: (options) => event.reply(options),\n        },\n        true,\n      );\n    });\n  },\n",
)
sub(
    'apps/bot/src/plugins/achievements.ts',
    r"\n      \{\n        event: 'interactionCreate',\n        async handler\(context, \.\.\.args\) \{\n          scheduleMiniGameAchievementSync\(.*?\n        \},\n      \},",
    '',
)
replace(
    'apps/bot/src/plugins/achievements.ts',
    "  async onDisable(context) {\n    clearAutoSyncGuild(context.guildId);\n  },",
    "  async onDisable(context) {\n    unsubscribeMiniGameCompletion(`achievements:${context.guildId}`);\n    clearAutoSyncGuild(context.guildId);\n  },",
)
sub(
    'apps/bot/src/plugins/achievements.ts',
    r"\nfunction scheduleMiniGameAchievementSync\(.*?\n\}\n\nasync function maybeAutoSync",
    '\nasync function maybeAutoSync',
)

# Community Challenge: same explicit completion event, preserving interaction follow-up target.
replace(
    'apps/bot/src/plugins/community-challenge.ts',
    "} from './community-challenge-repository.js';\n",
    "} from './community-challenge-repository.js';\nimport {\n  subscribeMiniGameCompletion,\n  unsubscribeMiniGameCompletion,\n} from './mini-games-completion-events.js';\n",
)
replace(
    'apps/bot/src/plugins/community-challenge.ts',
    "  manifest: communityChallengeManifest,\n",
    "  manifest: communityChallengeManifest,\n  async onEnable(context) {\n    subscribeMiniGameCompletion(`community-challenge:${context.guildId}`, async (event) => {\n      if (event.guildId !== context.guildId) return;\n      await maybeAutoSync(\n        context,\n        event.guildId,\n        event.userId,\n        {\n          guild: event.guild as unknown as ChallengeGuild,\n          reply: (options) => event.reply(options),\n        },\n        true,\n      );\n    });\n  },\n",
)
sub(
    'apps/bot/src/plugins/community-challenge.ts',
    r"\n      \{\n        event: 'interactionCreate',\n        async handler\(context, \.\.\.args\) \{\n          scheduleMiniGameChallengeSync\(.*?\n        \},\n      \},",
    '',
)
replace(
    'apps/bot/src/plugins/community-challenge.ts',
    "  async onDisable(context) {\n    clearAutoSyncGuild(context.guildId);\n  },",
    "  async onDisable(context) {\n    unsubscribeMiniGameCompletion(`community-challenge:${context.guildId}`);\n    clearAutoSyncGuild(context.guildId);\n  },",
)
sub(
    'apps/bot/src/plugins/community-challenge.ts',
    r"\nfunction scheduleMiniGameChallengeSync\(.*?\n\}\n\nasync function maybeAutoSync",
    '\nasync function maybeAutoSync',
)

# Mini Games: emit only after metrics and Discord result/update are complete.
replace(
    'apps/bot/src/plugins/mini-games.ts',
    "import { formatMiniGameStats } from './mini-games-stats.js';\n",
    "import { formatMiniGameStats } from './mini-games-stats.js';\nimport { publishMiniGameCompletion } from './mini-games-completion-events.js';\n",
)
replace(
    'apps/bot/src/plugins/mini-games.ts',
    """    await interaction.reply({
      content: formatCoinFlipResult(result, choice),
      allowedMentions: { parse: [] },
    });
    return;""",
    """    await interaction.reply({
      content: formatCoinFlipResult(result, choice),
      allowedMentions: { parse: [] },
    });
    await publishMiniGameCompletion(interaction);
    return;""",
)
replace(
    'apps/bot/src/plugins/mini-games.ts',
    "  await interaction.editReply({ content: formatCoinFlipResult(result, choice) });\n}",
    "  await interaction.editReply({ content: formatCoinFlipResult(result, choice) });\n  await publishMiniGameCompletion(interaction);\n}",
)
replace(
    'apps/bot/src/plugins/mini-games.ts',
    """  await interaction.reply({
    content: renderHighLow(session),
    components: [buildHighLowRow(session.id)],
    allowedMentions: { parse: [] },
  });
}""",
    """  await interaction.reply({
    content: renderHighLow(session),
    components: [buildHighLowRow(session.id)],
    allowedMentions: { parse: [] },
  });
  await publishMiniGameCompletion(interaction);
}""",
)
replace(
    'apps/bot/src/plugins/mini-games.ts',
    """    await interaction.reply({
      content: renderBlackjackFinal(session),
      allowedMentions: { parse: [] },
    });
    return;""",
    """    await interaction.reply({
      content: renderBlackjackFinal(session),
      allowedMentions: { parse: [] },
    });
    await publishMiniGameCompletion(interaction);
    return;""",
)
replace(
    'apps/bot/src/plugins/mini-games.ts',
    """  await interaction.reply({
    content: renderBlackjack(session, false),
    components: [buildBlackjackRow(session.id)],
    allowedMentions: { parse: [] },
  });
}""",
    """  await interaction.reply({
    content: renderBlackjack(session, false),
    components: [buildBlackjackRow(session.id)],
    allowedMentions: { parse: [] },
  });
  await publishMiniGameCompletion(interaction);
}""",
)
replace(
    'apps/bot/src/plugins/mini-games.ts',
    """    await interaction.update({
      content: [
        '🎴 **High-Low**',
        `前: **${formatPlayingCard(previous)}** → 次: **${formatPlayingCard(next)}**`,
        '✅ 正解！',
        `🏆 **${session.streak}連勝でパーフェクトクリア！**`,
      ].join('\\n'),
      components: [],
    });
    return;""",
    """    await interaction.update({
      content: [
        '🎴 **High-Low**',
        `前: **${formatPlayingCard(previous)}** → 次: **${formatPlayingCard(next)}**`,
        '✅ 正解！',
        `🏆 **${session.streak}連勝でパーフェクトクリア！**`,
      ].join('\\n'),
      components: [],
    });
    await publishMiniGameCompletion(interaction);
    return;""",
)
replace(
    'apps/bot/src/plugins/mini-games.ts',
    """  await interaction.update({
    content: [
      '🎴 **High-Low**',
      `前: **${formatPlayingCard(previous)}** → 次: **${formatPlayingCard(next)}**`,
      `✅ 正解！ **${session.streak}連勝**`,
      '',
      renderHighLow(session),
    ].join('\\n'),
    components: [buildHighLowRow(session.id)],
  });
}""",
    """  await interaction.update({
    content: [
      '🎴 **High-Low**',
      `前: **${formatPlayingCard(previous)}** → 次: **${formatPlayingCard(next)}**`,
      `✅ 正解！ **${session.streak}連勝**`,
      '',
      renderHighLow(session),
    ].join('\\n'),
    components: [buildHighLowRow(session.id)],
  });
  await publishMiniGameCompletion(interaction);
}""",
)
replace(
    'apps/bot/src/plugins/mini-games.ts',
    """      await interaction.update({ content: renderBlackjackFinal(session), components: [] });
      return;""",
    """      await interaction.update({ content: renderBlackjackFinal(session), components: [] });
      await publishMiniGameCompletion(interaction);
      return;""",
    count=2,
)
replace(
    'apps/bot/src/plugins/mini-games.ts',
    """    await interaction.update({ content: renderBlackjackFinal(session), components: [] });
    return;""",
    """    await interaction.update({ content: renderBlackjackFinal(session), components: [] });
    await publishMiniGameCompletion(interaction);
    return;""",
)
replace(
    'apps/bot/src/plugins/mini-games.ts',
    """  if (outcome === 'push') metrics.push(['blackjack_pushes', 1]);
  if (outcome === 'player-blackjack') metrics.push(['blackjack_naturals', 1]);""",
    """  if (outcome === 'push') metrics.push(['blackjack_pushes', 1]);
  if (blackjackScore(session.player).blackjack) metrics.push(['blackjack_naturals', 1]);""",
)

# Make High-Low achievements reachable for every supported max-round setting.
replace(
    'packages/shared/src/achievement-catalog.ts',
    """    id: 'highlow-five',
    name: 'High-Low Heater',
    description: 'High-Lowで5連勝する',
    emoji: '🔥',
    rarity: 'uncommon',
    category: 'games',
    metric: 'highLowBestStreak',
    target: 5,""",
    """    id: 'highlow-five',
    name: 'High-Low Heater',
    description: 'High-Lowで3連勝する',
    emoji: '🔥',
    rarity: 'uncommon',
    category: 'games',
    metric: 'highLowBestStreak',
    target: 3,""",
)
replace(
    'packages/shared/src/achievement-catalog.ts',
    """    id: 'highlow-ten',
    name: 'High-Low Master',
    description: 'High-Lowで10連勝する',
    emoji: '🎴',
    rarity: 'epic',
    category: 'games',
    metric: 'highLowBestStreak',
    target: 10,""",
    """    id: 'highlow-ten',
    name: 'High-Low Master',
    description: 'High-Lowを10回パーフェクトクリアする',
    emoji: '🎴',
    rarity: 'epic',
    category: 'games',
    metric: 'highLowClears',
    target: 10,""",
)
