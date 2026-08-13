from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    source = target.read_text()
    assert old in source, f"anchor not found: {path}: {old[:100]!r}"
    target.write_text(source.replace(old, new, 1))


path = "apps/bot/src/plugins/mini-games.ts"
replace_once(
    path,
    "} from './mini-games-core.js';\nimport {\n  getMiniGameStats,",
    "} from './mini-games-core.js';\nimport {\n  formatChinchiroTurn,\n  formatDiceRoll,\n  playChinchiroTurn,\n  rollDice,\n} from './mini-games-dice.js';\nimport {\n  getMiniGameLeaderboard,\n  getMiniGameStats,",
)
replace_once(
    path,
    "  recordMiniGameMaximum,\n  type MiniGameMetric,\n} from './mini-games-repository.js';\nimport { formatMiniGameStats } from './mini-games-stats.js';",
    "  recordMiniGameMaximum,\n  type MiniGameLeaderboardMetric,\n  type MiniGameMetric,\n} from './mini-games-repository.js';\nimport { formatMiniGameLeaderboard, formatMiniGameStats } from './mini-games-stats.js';",
)
replace_once(
    path,
    "    const gamestats: CommandHandler<ChatInputCommandInteraction> = {\n      definition: miniGamesManifest.commands[3]!,\n      async execute(interaction) {\n        await executeGameStats(context, interaction);\n      },\n    };\n    return [coinflip, highlow, blackjack, gamestats];",
    "    const gamestats: CommandHandler<ChatInputCommandInteraction> = {\n      definition: miniGamesManifest.commands[3]!,\n      async execute(interaction) {\n        await executeGameStats(context, interaction);\n      },\n    };\n    const dice: CommandHandler<ChatInputCommandInteraction> = {\n      definition: miniGamesManifest.commands[4]!,\n      async execute(interaction) {\n        await executeDice(context, interaction);\n      },\n    };\n    const chinchiro: CommandHandler<ChatInputCommandInteraction> = {\n      definition: miniGamesManifest.commands[5]!,\n      async execute(interaction) {\n        await executeChinchiro(context, interaction);\n      },\n    };\n    const gameleaderboard: CommandHandler<ChatInputCommandInteraction> = {\n      definition: miniGamesManifest.commands[6]!,\n      async execute(interaction) {\n        await executeGameLeaderboard(context, interaction);\n      },\n    };\n    return [coinflip, highlow, blackjack, gamestats, dice, chinchiro, gameleaderboard];",
)

insert = r'''async function executeDice(
  context: MiniGamesRuntimeContext,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guildId) {
    await replyEphemeral(interaction, 'このコマンドはDiscordサーバー内でのみ利用できます。');
    return;
  }
  const config = normalizeMiniGamesConfig(context.config);
  if (!config.enabled) {
    await replyEphemeral(interaction, 'Mini Games Pluginは現在無効です。');
    return;
  }

  const count = clamp(interaction.options.getInteger('count') ?? 2, 1, 10);
  const sides = clamp(interaction.options.getInteger('sides') ?? 6, 2, 100);
  const values = rollDice(count, sides);
  await recordMetricsSafely(
    context,
    [
      ['minigame_plays', 1],
      ['dice_plays', 1],
    ],
    interaction.user.id,
  );
  await interaction.reply({
    content: formatDiceRoll(values, sides),
    allowedMentions: { parse: [] },
  });
}

async function executeChinchiro(
  context: MiniGamesRuntimeContext,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guildId) {
    await replyEphemeral(interaction, 'このコマンドはDiscordサーバー内でのみ利用できます。');
    return;
  }
  const config = normalizeMiniGamesConfig(context.config);
  if (!config.enabled) {
    await replyEphemeral(interaction, 'Mini Games Pluginは現在無効です。');
    return;
  }

  const turn = playChinchiroTurn();
  const metrics: Array<readonly [MiniGameMetric, number]> = [
    ['minigame_plays', 1],
    ['chinchiro_plays', 1],
  ];
  if (turn.result.kind === 'shigoro') metrics.push(['chinchiro_shigoro', 1]);
  if (turn.result.kind === 'triple') metrics.push(['chinchiro_zorome', 1]);
  if (turn.result.kind === 'hifumi') metrics.push(['chinchiro_hifumi', 1]);
  await recordMetricsSafely(context, metrics, interaction.user.id);
  await interaction.reply({
    content: formatChinchiroTurn(turn),
    allowedMentions: { parse: [] },
  });
}

async function executeGameLeaderboard(
  context: MiniGamesRuntimeContext,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guildId) {
    await replyEphemeral(interaction, 'このコマンドはDiscordサーバー内でのみ利用できます。');
    return;
  }
  const config = normalizeMiniGamesConfig(context.config);
  if (!config.enabled) {
    await replyEphemeral(interaction, 'Mini Games Pluginは現在無効です。');
    return;
  }
  if (!config.statsEnabled) {
    await replyEphemeral(interaction, 'Mini Gamesの戦績記録は現在無効です。');
    return;
  }

  const requested = interaction.options.getString('metric');
  const metric: MiniGameLeaderboardMetric =
    requested === 'plays' ||
    requested === 'coinflip' ||
    requested === 'highlow' ||
    requested === 'blackjack' ||
    requested === 'chinchiro'
      ? requested
      : 'wins';
  const limit = clamp(interaction.options.getInteger('limit') ?? 10, 3, 25);
  const records = await getMiniGameLeaderboard(context.prisma, interaction.guildId, metric, limit);
  await interaction.reply({
    content: formatMiniGameLeaderboard(metric, records),
    allowedMentions: { parse: [] },
  });
}

'''
replace_once(
    path,
    "async function recordBlackjackSettlement(\n",
    insert + "async function recordBlackjackSettlement(\n",
)

for sync_path in [
    "apps/bot/src/plugins/achievements.ts",
    "apps/bot/src/plugins/community-challenge.ts",
]:
    replace_once(
        sync_path,
        "      interaction.commandName === 'blackjack')",
        "      interaction.commandName === 'blackjack' ||\n      interaction.commandName === 'dice' ||\n      interaction.commandName === 'chinchiro')",
    )

replace_once(
    "apps/bot/src/plugins/mini-games.test.ts",
    "  it('Manifestに3ゲーム・戦績コマンド・interactionCreateを登録する', () => {\n    expect(miniGamesManifest.commands.map((command) => command.name)).toEqual([\n      'coinflip',\n      'highlow',\n      'blackjack',\n      'gamestats',\n    ]);",
    "  it('Manifestに5ゲーム・戦績・Leaderboardコマンドを登録する', () => {\n    expect(miniGamesManifest.commands.map((command) => command.name)).toEqual([\n      'coinflip',\n      'highlow',\n      'blackjack',\n      'gamestats',\n      'dice',\n      'chinchiro',\n      'gameleaderboard',\n    ]);",
)

replace_once(
    "apps/bot/src/plugins/mini-games-stats.test.ts",
    "      blackjackNaturals: 1,\n    });",
    "      blackjackNaturals: 1,\n      dicePlays: 4,\n      chinchiroPlays: 3,\n      chinchiroShigoro: 1,\n      chinchiroZorome: 1,\n      chinchiroHifumi: 1,\n    });",
)
replace_once(
    "apps/bot/src/plugins/mini-games-stats.test.ts",
    "    expect(message).toContain('60%');\n  });",
    "    expect(message).toContain('60%');\n    expect(message).toContain('Dice');\n    expect(message).toContain('シゴロ **1**');\n  });",
)

path = "apps/bot/src/plugins/mini-games-v2-integration.test.ts"
target = Path(path)
source = target.read_text()
old = "    const slash = miniGameInteraction({ commandName: 'blackjack' });\n    const button = miniGameInteraction({"
new = "    const slash = miniGameInteraction({ commandName: 'blackjack' });\n    const dice = miniGameInteraction({ commandName: 'dice' });\n    const chinchiro = miniGameInteraction({ commandName: 'chinchiro' });\n    const button = miniGameInteraction({"
assert old in source
source = source.replace(old, new, 1)
old = "    expect(isMiniGameChallengeInteraction(slash)).toBe(true);\n    expect(isMiniGameAchievementInteraction(button)).toBe(true);"
new = "    expect(isMiniGameChallengeInteraction(slash)).toBe(true);\n    expect(isMiniGameAchievementInteraction(dice)).toBe(true);\n    expect(isMiniGameChallengeInteraction(dice)).toBe(true);\n    expect(isMiniGameAchievementInteraction(chinchiro)).toBe(true);\n    expect(isMiniGameChallengeInteraction(chinchiro)).toBe(true);\n    expect(isMiniGameAchievementInteraction(button)).toBe(true);"
assert old in source
target.write_text(source.replace(old, new, 1))
