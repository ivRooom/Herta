from pathlib import Path


def replace(path: str, old: str, new: str, count: int = 1) -> None:
    file = Path(path)
    text = file.read_text()
    actual = text.count(old)
    assert actual == count, f'{path}: expected {count}, got {actual}: {old[:120]!r}'
    file.write_text(text.replace(old, new, count))


replace(
    'apps/bot/src/plugins/mini-games.ts',
    "import { formatMiniGameStats } from './mini-games-stats.js';\n",
    "import { formatMiniGameStats } from './mini-games-stats.js';\nimport { blackjackSettlementMetrics } from './mini-games-blackjack-metrics.js';\n",
)
replace(
    'apps/bot/src/plugins/mini-games.ts',
    """  const outcome = settleBlackjack(session.player, session.dealer);
  const metrics: Array<readonly [MiniGameMetric, number]> = [];
  if (outcome === 'player-win' || outcome === 'player-blackjack') {
    metrics.push(['blackjack_wins', 1], ['minigame_wins', 1]);
  }
  if (outcome === 'push') metrics.push(['blackjack_pushes', 1]);
  if (blackjackScore(session.player).blackjack) metrics.push(['blackjack_naturals', 1]);
  await recordMetricsSafely(context, metrics, session.userId);""",
    """  await recordMetricsSafely(
    context,
    blackjackSettlementMetrics(session.player, session.dealer),
    session.userId,
  );""",
)

replace(
    'packages/plugin-catalog/src/manifests/achievements.ts',
    "events: ['messageCreate', 'messageReactionAdd', 'interactionCreate', 'voiceStateUpdate'],",
    "events: ['messageCreate', 'messageReactionAdd', 'voiceStateUpdate'],",
)
replace(
    'packages/plugin-catalog/src/manifests/community-challenge.ts',
    "events: ['messageCreate', 'messageReactionAdd', 'interactionCreate', 'voiceStateUpdate'],",
    "events: ['messageCreate', 'messageReactionAdd', 'voiceStateUpdate'],",
)

replace(
    'apps/bot/src/plugins/mini-games-v2-integration.test.ts',
    """  it('AchievementとCommunity ChallengeがinteractionCreateを購読する', () => {
    expect(achievementsManifest.events).toContain('interactionCreate');
    expect(communityChallengeManifest.events).toContain('interactionCreate');
  });""",
    """  it('AchievementとCommunity ChallengeはMini Games同期のためにinteractionCreateへ依存しない', () => {
    expect(achievementsManifest.events).not.toContain('interactionCreate');
    expect(communityChallengeManifest.events).not.toContain('interactionCreate');
  });

  it('High-Low実績は最小3ラウンド設定でも到達可能にする', () => {
    const heater = ACHIEVEMENTS.find((achievement) => achievement.id === 'highlow-five');
    const master = ACHIEVEMENTS.find((achievement) => achievement.id === 'highlow-ten');
    expect(heater).toMatchObject({ metric: 'highLowBestStreak', target: 3 });
    expect(master).toMatchObject({ metric: 'highLowClears', target: 10 });
  });""",
)
