from pathlib import Path

# Achievement catalog
p = Path('packages/shared/src/achievement-catalog.ts')
s = p.read_text()
assert "  'challenge',\n] as const;" in s
s = s.replace("  'challenge',\n] as const;", "  'challenge',\n  'games',\n] as const;", 1)
assert "  | 'seasonPoints';" in s
s = s.replace(
    "  | 'seasonPoints';",
    "  | 'seasonPoints'\n  | 'minigamePlays'\n  | 'minigameWins'\n  | 'coinflipWins'\n  | 'highLowBestStreak'\n  | 'highLowClears'\n  | 'blackjackWins'\n  | 'blackjackNaturals';",
    1,
)
marker = "  {\n    id: 'all-rounder',"
assert marker in s
game_achievements = """  {
    id: 'arcade-debut',
    name: 'Arcade Debut',
    description: 'Mini Gameを1回プレイする',
    emoji: '🎮',
    rarity: 'common',
    category: 'games',
    metric: 'minigamePlays',
    target: 1,
  },
  {
    id: 'arcade-regular',
    name: 'Arcade Regular',
    description: 'Mini Gameを25回プレイする',
    emoji: '🕹️',
    rarity: 'uncommon',
    category: 'games',
    metric: 'minigamePlays',
    target: 25,
  },
  {
    id: 'arcade-veteran',
    name: 'Arcade Veteran',
    description: 'Mini Gameを100回プレイする',
    emoji: '👾',
    rarity: 'epic',
    category: 'games',
    metric: 'minigamePlays',
    target: 100,
  },
  {
    id: 'arcade-winner',
    name: 'Arcade Winner',
    description: 'Mini Gameで10回勝利する',
    emoji: '🏅',
    rarity: 'rare',
    category: 'games',
    metric: 'minigameWins',
    target: 10,
  },
  {
    id: 'lucky-call',
    name: 'Lucky Call',
    description: 'Coin Flipの予想を10回的中させる',
    emoji: '🪙',
    rarity: 'rare',
    category: 'games',
    metric: 'coinflipWins',
    target: 10,
  },
  {
    id: 'highlow-five',
    name: 'High-Low Heater',
    description: 'High-Lowで5連勝する',
    emoji: '🔥',
    rarity: 'uncommon',
    category: 'games',
    metric: 'highLowBestStreak',
    target: 5,
  },
  {
    id: 'highlow-ten',
    name: 'High-Low Master',
    description: 'High-Lowで10連勝する',
    emoji: '🎴',
    rarity: 'epic',
    category: 'games',
    metric: 'highLowBestStreak',
    target: 10,
  },
  {
    id: 'highlow-perfect',
    name: 'Perfect Read',
    description: 'High-Lowをパーフェクトクリアする',
    emoji: '🔮',
    rarity: 'rare',
    category: 'games',
    metric: 'highLowClears',
    target: 1,
  },
  {
    id: 'blackjack-first-win',
    name: 'First Twenty-One',
    description: 'Blackjackで1回勝利する',
    emoji: '🃏',
    rarity: 'common',
    category: 'games',
    metric: 'blackjackWins',
    target: 1,
  },
  {
    id: 'natural-21',
    name: 'Natural 21',
    description: 'Natural Blackjackを1回出す',
    emoji: '✨',
    rarity: 'rare',
    category: 'games',
    metric: 'blackjackNaturals',
    target: 1,
  },
  {
    id: 'blackjack-shark',
    name: 'Blackjack Shark',
    description: 'Blackjackで25回勝利する',
    emoji: '🦈',
    rarity: 'epic',
    category: 'games',
    metric: 'blackjackWins',
    target: 25,
  },
"""
s = s.replace(marker, game_achievements + marker, 1)
assert "    challenge: 'Challenge',\n  }[category];" in s
s = s.replace("    challenge: 'Challenge',\n  }[category];", "    challenge: 'Challenge',\n    games: 'Games',\n  }[category];", 1)
p.write_text(s)

# Achievement repository metrics
p = Path('apps/bot/src/plugins/achievements-repository.ts')
s = p.read_text()
assert "  seasonPoints: number;\n}" in s
s = s.replace(
    "  seasonPoints: number;\n}",
    "  seasonPoints: number;\n  minigamePlays: number;\n  minigameWins: number;\n  coinflipWins: number;\n  highLowBestStreak: number;\n  highLowClears: number;\n  blackjackWins: number;\n  blackjackNaturals: number;\n}",
    1,
)
assert "      seasonPoints: bigint;\n    }>" in s
s = s.replace(
    "      seasonPoints: bigint;\n    }>",
    "      seasonPoints: bigint;\n      minigamePlays: bigint;\n      minigameWins: bigint;\n      coinflipWins: bigint;\n      highLowBestStreak: bigint;\n      highLowClears: bigint;\n      blackjackWins: bigint;\n      blackjackNaturals: bigint;\n    }>",
    1,
)
old = "      COALESCE((SELECT SUM(c.\"points\") FROM \"community_challenge_completions\" c WHERE c.\"guild_id\" = ${guildId} AND c.\"user_id\" = ${userId} AND c.\"season_key\" = ${seasonKey}), 0)::bigint AS \"seasonPoints\""
assert old in s
extra = """,
      COALESCE((SELECT SUM("value") FROM "community_activity_daily" WHERE "guild_id" = ${guildId} AND "user_id" = ${userId} AND "metric" = 'minigame_plays'), 0)::bigint AS "minigamePlays",
      COALESCE((SELECT SUM("value") FROM "community_activity_daily" WHERE "guild_id" = ${guildId} AND "user_id" = ${userId} AND "metric" = 'minigame_wins'), 0)::bigint AS "minigameWins",
      COALESCE((SELECT SUM("value") FROM "community_activity_daily" WHERE "guild_id" = ${guildId} AND "user_id" = ${userId} AND "metric" = 'coinflip_wins'), 0)::bigint AS "coinflipWins",
      COALESCE((SELECT MAX("value") FROM "community_activity_daily" WHERE "guild_id" = ${guildId} AND "user_id" = ${userId} AND "metric" = 'highlow_best_streak'), 0)::bigint AS "highLowBestStreak",
      COALESCE((SELECT SUM("value") FROM "community_activity_daily" WHERE "guild_id" = ${guildId} AND "user_id" = ${userId} AND "metric" = 'highlow_clears'), 0)::bigint AS "highLowClears",
      COALESCE((SELECT SUM("value") FROM "community_activity_daily" WHERE "guild_id" = ${guildId} AND "user_id" = ${userId} AND "metric" = 'blackjack_wins'), 0)::bigint AS "blackjackWins",
      COALESCE((SELECT SUM("value") FROM "community_activity_daily" WHERE "guild_id" = ${guildId} AND "user_id" = ${userId} AND "metric" = 'blackjack_naturals'), 0)::bigint AS "blackjackNaturals""" 
s = s.replace(old, old + extra, 1)
assert "    seasonPoints: Number(row?.seasonPoints ?? 0n),\n  };" in s
s = s.replace(
    "    seasonPoints: Number(row?.seasonPoints ?? 0n),\n  };",
    "    seasonPoints: Number(row?.seasonPoints ?? 0n),\n    minigamePlays: Number(row?.minigamePlays ?? 0n),\n    minigameWins: Number(row?.minigameWins ?? 0n),\n    coinflipWins: Number(row?.coinflipWins ?? 0n),\n    highLowBestStreak: Number(row?.highLowBestStreak ?? 0n),\n    highLowClears: Number(row?.highLowClears ?? 0n),\n    blackjackWins: Number(row?.blackjackWins ?? 0n),\n    blackjackNaturals: Number(row?.blackjackNaturals ?? 0n),\n  };",
    1,
)
p.write_text(s)

# Community challenge catalog
p = Path('packages/shared/src/community-challenge-catalog.ts')
s = p.read_text()
assert "  'minecraft_seconds',\n] as const;" in s
s = s.replace(
    "  'minecraft_seconds',\n] as const;",
    "  'minecraft_seconds',\n  'minigame_plays',\n  'minigame_wins',\n  'highlow_round_wins',\n  'blackjack_wins',\n] as const;",
    1,
)
assert "  includeMinecraft: boolean;\n}" in s
s = s.replace("  includeMinecraft: boolean;\n}", "  includeMinecraft: boolean;\n  includeMiniGames?: boolean;\n}", 1)
marker = "];\n\nexport const COMMUNITY_CHALLENGE_BY_ID"
assert marker in s
entries = """

  // Daily / Mini Games
  challenge('daily-arcade-break', 'Arcade Break', 'Mini Gameを2回プレイする', '🎮', 'daily', 'minigame_plays', 2, 10, 'easy'),
  challenge('daily-arcade-session', 'Arcade Session', 'Mini Gameを5回プレイする', '🕹️', 'daily', 'minigame_plays', 5, 15, 'normal'),
  challenge('daily-arcade-marathon', 'Arcade Marathon', 'Mini Gameを10回プレイする', '👾', 'daily', 'minigame_plays', 10, 25, 'hard'),
  challenge('daily-lucky-win', 'Lucky Win', 'Mini Gameで1回勝利する', '🍀', 'daily', 'minigame_wins', 1, 10, 'easy'),
  challenge('daily-winning-hand', 'Winning Hand', 'Mini Gameで3回勝利する', '🏅', 'daily', 'minigame_wins', 3, 20, 'normal'),
  challenge('daily-win-streak', 'Win Streak', 'Mini Gameで5回勝利する', '🔥', 'daily', 'minigame_wins', 5, 30, 'hard'),
  challenge('daily-highlow-warmup', 'High-Low Warmup', 'High-Lowで合計3Round正解する', '🎴', 'daily', 'highlow_round_wins', 3, 10, 'easy'),
  challenge('daily-highlow-reader', 'Card Reader', 'High-Lowで合計8Round正解する', '🔮', 'daily', 'highlow_round_wins', 8, 20, 'normal'),
  challenge('daily-highlow-run', 'High-Low Run', 'High-Lowで合計15Round正解する', '🃏', 'daily', 'highlow_round_wins', 15, 30, 'hard'),
  challenge('daily-blackjack-win', 'Twenty-One', 'Blackjackで1回勝利する', '♠️', 'daily', 'blackjack_wins', 1, 15, 'easy'),
  challenge('daily-blackjack-table', 'Blackjack Table', 'Blackjackで2回勝利する', '♦️', 'daily', 'blackjack_wins', 2, 20, 'normal'),
  challenge('daily-blackjack-shark', 'Table Shark', 'Blackjackで4回勝利する', '🦈', 'daily', 'blackjack_wins', 4, 35, 'hard'),

  // Weekly / Mini Games
  challenge('weekly-arcade-regular', 'Arcade Regular', '1週間でMini Gameを15回プレイする', '🎮', 'weekly', 'minigame_plays', 15, 40, 'easy'),
  challenge('weekly-arcade-fan', 'Arcade Fan', '1週間でMini Gameを35回プレイする', '🕹️', 'weekly', 'minigame_plays', 35, 60, 'normal'),
  challenge('weekly-arcade-veteran', 'Arcade Veteran', '1週間でMini Gameを70回プレイする', '👾', 'weekly', 'minigame_plays', 70, 100, 'hard'),
  challenge('weekly-winner', 'Winning Week', '1週間でMini Gameに8回勝利する', '🏅', 'weekly', 'minigame_wins', 8, 45, 'easy'),
  challenge('weekly-champion', 'Weekly Champion', '1週間でMini Gameに20回勝利する', '🏆', 'weekly', 'minigame_wins', 20, 70, 'normal'),
  challenge('weekly-arcade-ace', 'Arcade Ace', '1週間でMini Gameに40回勝利する', '🌟', 'weekly', 'minigame_wins', 40, 120, 'hard'),
  challenge('weekly-highlow-climber', 'High-Low Climber', '1週間でHigh-Lowを25Round正解する', '🎴', 'weekly', 'highlow_round_wins', 25, 45, 'easy'),
  challenge('weekly-highlow-reader', 'Card Reader Pro', '1週間でHigh-Lowを60Round正解する', '🔮', 'weekly', 'highlow_round_wins', 60, 70, 'normal'),
  challenge('weekly-highlow-master', 'High-Low Master', '1週間でHigh-Lowを120Round正解する', '🃏', 'weekly', 'highlow_round_wins', 120, 120, 'hard'),
  challenge('weekly-blackjack-regular', 'Blackjack Regular', '1週間でBlackjackに5回勝利する', '♠️', 'weekly', 'blackjack_wins', 5, 50, 'easy'),
  challenge('weekly-blackjack-pro', 'Blackjack Pro', '1週間でBlackjackに12回勝利する', '♦️', 'weekly', 'blackjack_wins', 12, 80, 'normal'),
  challenge('weekly-blackjack-shark', 'Blackjack Shark', '1週間でBlackjackに25回勝利する', '🦈', 'weekly', 'blackjack_wins', 25, 130, 'hard'),
"""
s = s.replace(marker, entries + "];\n\nexport const COMMUNITY_CHALLENGE_BY_ID", 1)
assert "      (input.includeMinecraft || definition.metric !== 'minecraft_seconds')," in s
s = s.replace(
    "      (input.includeMinecraft || definition.metric !== 'minecraft_seconds'),",
    "      (input.includeMinecraft || definition.metric !== 'minecraft_seconds') &&\n      (input.includeMiniGames === true || !isMiniGameChallengeMetric(definition.metric)),",
    1,
)
assert "    case 'minecraft_seconds':\n      return 'Minecraft';" in s
s = s.replace(
    "    case 'minecraft_seconds':\n      return 'Minecraft';",
    "    case 'minecraft_seconds':\n      return 'Minecraft';\n    case 'minigame_plays':\n      return 'Mini Game Plays';\n    case 'minigame_wins':\n      return 'Mini Game Wins';\n    case 'highlow_round_wins':\n      return 'High-Low Round Wins';\n    case 'blackjack_wins':\n      return 'Blackjack Wins';",
    1,
)
helper_marker = "function challenge(\n"
assert helper_marker in s
helper = """function isMiniGameChallengeMetric(metric: CommunityChallengeMetric): boolean {
  return (
    metric === 'minigame_plays' ||
    metric === 'minigame_wins' ||
    metric === 'highlow_round_wins' ||
    metric === 'blackjack_wins'
  );
}

"""
s = s.replace(helper_marker, helper + helper_marker, 1)
p.write_text(s)

# Challenge metrics repository
p = Path('apps/bot/src/plugins/community-challenge-repository.ts')
s = p.read_text()
old = "        'messages', 'reactions_given', 'reactions_received', 'voice_seconds', 'minecraft_seconds'\n      )"
assert old in s
s = s.replace(old, "        'messages', 'reactions_given', 'reactions_received', 'voice_seconds', 'minecraft_seconds',\n        'minigame_plays', 'minigame_wins', 'highlow_round_wins', 'blackjack_wins'\n      )", 1)
assert "    minecraft_seconds: 0,\n  };" in s
s = s.replace("    minecraft_seconds: 0,\n  };", "    minecraft_seconds: 0,\n    minigame_plays: 0,\n    minigame_wins: 0,\n    highlow_round_wins: 0,\n    blackjack_wins: 0,\n  };", 1)
p.write_text(s)

# Challenge runtime config and filtering
p = Path('apps/bot/src/plugins/community-challenge.ts')
s = p.read_text()
assert "  includeMinecraftChallenges: boolean;\n  autoSync: boolean;" in s
s = s.replace("  includeMinecraftChallenges: boolean;\n  autoSync: boolean;", "  includeMinecraftChallenges: boolean;\n  includeMiniGameChallenges: boolean;\n  autoSync: boolean;", 1)
old = "    includeMinecraftChallenges:\n      source.includeMinecraftChallenges === undefined\n        ? true\n        : source.includeMinecraftChallenges === true,\n    autoSync:"
assert old in s
s = s.replace(old, "    includeMinecraftChallenges:\n      source.includeMinecraftChallenges === undefined\n        ? true\n        : source.includeMinecraftChallenges === true,\n    includeMiniGameChallenges: source.includeMiniGameChallenges === true,\n    autoSync:", 1)
assert "    includeMinecraft: config.includeMinecraftChallenges,\n  });" in s
s = s.replace("    includeMinecraft: config.includeMinecraftChallenges,\n  });", "    includeMinecraft: config.includeMinecraftChallenges,\n    includeMiniGames: config.includeMiniGameChallenges,\n  });", 1)
assert "      (config.includeMinecraftChallenges || definition.metric !== 'minecraft_seconds')," in s
s = s.replace(
    "      (config.includeMinecraftChallenges || definition.metric !== 'minecraft_seconds'),",
    "      (config.includeMinecraftChallenges || definition.metric !== 'minecraft_seconds') &&\n      (config.includeMiniGameChallenges ||\n        (definition.metric !== 'minigame_plays' &&\n          definition.metric !== 'minigame_wins' &&\n          definition.metric !== 'highlow_round_wins' &&\n          definition.metric !== 'blackjack_wins')),",
    1,
)
p.write_text(s)

# Community Challenge manifest optional toggle
p = Path('packages/plugin-catalog/src/manifests/community-challenge.ts')
s = p.read_text()
marker = "      autoSync: {\n"
assert marker in s
field = """      includeMiniGameChallenges: {
        type: 'boolean',
        title: 'Mini Games Challengeを配布候補に含める',
        default: false,
        'x-herta-ui': {
          section: 'Challenge配布',
          help: 'Mini Games Pluginを有効にし、ゲーム戦績を記録しているGuildでONにしてください。',
        },
      },
"""
s = s.replace(marker, field + marker, 1)
p.write_text(s)
