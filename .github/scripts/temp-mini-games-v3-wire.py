from pathlib import Path


def replace(path: str, old: str, new: str, count: int = 1) -> None:
    file = Path(path)
    content = file.read_text()
    actual = content.count(old)
    assert actual == count, f'{path}: expected {count} matches, got {actual}: {old[:100]!r}'
    file.write_text(content.replace(old, new, count))


replace(
    'apps/bot/src/plugins/mini-games.ts',
    "import { formatMiniGameStats } from './mini-games-stats.js';\n",
    "import { formatMiniGameStats } from './mini-games-stats.js';\nimport { createMiniGamesV3CommandHandlers } from './mini-games-v3.js';\n",
)
replace(
    'apps/bot/src/plugins/mini-games.ts',
    '    return [coinflip, highlow, blackjack, gamestats];',
    '    return [coinflip, highlow, blackjack, gamestats, ...createMiniGamesV3CommandHandlers(context)];',
)

old_detection = """    (interaction.commandName === 'coinflip' ||
      interaction.commandName === 'highlow' ||
      interaction.commandName === 'blackjack')"""
new_detection = """    (interaction.commandName === 'coinflip' ||
      interaction.commandName === 'highlow' ||
      interaction.commandName === 'blackjack' ||
      interaction.commandName === 'dice' ||
      interaction.commandName === 'chinchiro')"""
replace('apps/bot/src/plugins/achievements.ts', old_detection, new_detection)
replace('apps/bot/src/plugins/community-challenge.ts', old_detection, new_detection)

replace(
    'apps/bot/src/plugins/mini-games.test.ts',
    """      'blackjack',
      'gamestats',
    ]);""",
    """      'blackjack',
      'gamestats',
      'dice',
      'chinchiro',
      'gameleaderboard',
    ]);""",
)

replace(
    'apps/bot/src/plugins/mini-games-v2-integration.test.ts',
    """    const bot = miniGameInteraction({ commandName: 'coinflip', bot: true });

    expect(isMiniGameAchievementInteraction(slash)).toBe(true);""",
    """    const dice = miniGameInteraction({ commandName: 'dice' });
    const chinchiro = miniGameInteraction({ commandName: 'chinchiro' });
    const bot = miniGameInteraction({ commandName: 'coinflip', bot: true });

    expect(isMiniGameAchievementInteraction(slash)).toBe(true);""",
)
replace(
    'apps/bot/src/plugins/mini-games-v2-integration.test.ts',
    """    expect(isMiniGameChallengeInteraction(button)).toBe(true);
    expect(isMiniGameAchievementInteraction(unrelated)).toBe(false);""",
    """    expect(isMiniGameChallengeInteraction(button)).toBe(true);
    expect(isMiniGameAchievementInteraction(dice)).toBe(true);
    expect(isMiniGameChallengeInteraction(dice)).toBe(true);
    expect(isMiniGameAchievementInteraction(chinchiro)).toBe(true);
    expect(isMiniGameChallengeInteraction(chinchiro)).toBe(true);
    expect(isMiniGameAchievementInteraction(unrelated)).toBe(false);""",
)
