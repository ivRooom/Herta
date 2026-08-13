from pathlib import Path


def replace(path: str, old: str, new: str, count: int = 1) -> None:
    file = Path(path)
    text = file.read_text()
    actual = text.count(old)
    assert actual == count, f'{path}: expected {count}, got {actual}: {old[:120]!r}'
    file.write_text(text.replace(old, new, count))


path = 'apps/bot/src/plugins/mini-games.ts'

replace(
    path,
    """  const result = flipCoin();
  await recordMetricsSafely(
    context,
    [
      ['minigame_plays', 1],
      ['coinflip_plays', 1],
      ...(choice ? ([['coinflip_predictions', 1]] as const) : []),
      ...(choice === result
        ? ([
            ['coinflip_wins', 1],
            ['minigame_wins', 1],
          ] as const)
        : []),
    ],
    interaction.user.id,
  );

  if (!config.coinflipAnimation) {""",
    """  const result = flipCoin();
  const metrics: Array<readonly [MiniGameMetric, number]> = [
    ['minigame_plays', 1],
    ['coinflip_plays', 1],
    ...(choice ? ([['coinflip_predictions', 1]] as const) : []),
    ...(choice === result
      ? ([
          ['coinflip_wins', 1],
          ['minigame_wins', 1],
        ] as const)
      : []),
  ];

  if (!config.coinflipAnimation) {""",
)
replace(
    path,
    """    await interaction.reply({
      content: formatCoinFlipResult(result, choice),
      allowedMentions: { parse: [] },
    });
    await publishMiniGameCompletion(interaction);""",
    """    await interaction.reply({
      content: formatCoinFlipResult(result, choice),
      allowedMentions: { parse: [] },
    });
    await recordMetricsSafely(context, metrics, interaction.user.id);
    await publishMiniGameCompletion(interaction);""",
)
replace(
    path,
    """  await delay(COIN_FLIP_ANIMATION_MS);
  await interaction.editReply({ content: formatCoinFlipResult(result, choice) });
  await publishMiniGameCompletion(interaction);""",
    """  await delay(COIN_FLIP_ANIMATION_MS);
  await interaction.editReply({ content: formatCoinFlipResult(result, choice) });
  await recordMetricsSafely(context, metrics, interaction.user.id);
  await publishMiniGameCompletion(interaction);""",
)

replace(
    path,
    """  await recordMetricsSafely(
    context,
    [
      ['minigame_plays', 1],
      ['highlow_plays', 1],
    ],
    interaction.user.id,
  );
  const deck = createShuffledDeck();""",
    """  const deck = createShuffledDeck();""",
)
replace(
    path,
    """  await interaction.reply({
    content: renderHighLow(session),
    components: [buildHighLowRow(session.id)],
    allowedMentions: { parse: [] },
  });
  await publishMiniGameCompletion(interaction);""",
    """  await interaction.reply({
    content: renderHighLow(session),
    components: [buildHighLowRow(session.id)],
    allowedMentions: { parse: [] },
  });
  await recordMetricsSafely(
    context,
    [
      ['minigame_plays', 1],
      ['highlow_plays', 1],
    ],
    interaction.user.id,
  );
  await publishMiniGameCompletion(interaction);""",
)

replace(
    path,
    """  await recordMetricsSafely(
    context,
    [
      ['minigame_plays', 1],
      ['blackjack_plays', 1],
    ],
    interaction.user.id,
  );
  const deck = createShuffledDeck();""",
    """  const deck = createShuffledDeck();""",
)
replace(
    path,
    """  if (openingPlayer.blackjack || openingDealer.blackjack) {
    await recordBlackjackSettlement(context, session);
    await interaction.reply({
      content: renderBlackjackFinal(session),
      allowedMentions: { parse: [] },
    });
    await publishMiniGameCompletion(interaction);""",
    """  if (openingPlayer.blackjack || openingDealer.blackjack) {
    await interaction.reply({
      content: renderBlackjackFinal(session),
      allowedMentions: { parse: [] },
    });
    await recordMetricsSafely(
      context,
      [
        ['minigame_plays', 1],
        ['blackjack_plays', 1],
      ],
      interaction.user.id,
    );
    await recordBlackjackSettlement(context, session);
    await publishMiniGameCompletion(interaction);""",
)
replace(
    path,
    """  await interaction.reply({
    content: renderBlackjack(session, false),
    components: [buildBlackjackRow(session.id)],
    allowedMentions: { parse: [] },
  });
  await publishMiniGameCompletion(interaction);""",
    """  await interaction.reply({
    content: renderBlackjack(session, false),
    components: [buildBlackjackRow(session.id)],
    allowedMentions: { parse: [] },
  });
  await recordMetricsSafely(
    context,
    [
      ['minigame_plays', 1],
      ['blackjack_plays', 1],
    ],
    interaction.user.id,
  );
  await publishMiniGameCompletion(interaction);""",
)

replace(
    path,
    """  session.streak += 1;
  await recordMetricsSafely(context, [['highlow_round_wins', 1]], session.userId);
  await recordMaximumSafely(context, session.guildId, session.userId, session.streak);
  if (session.streak >= session.maxRounds) {""",
    """  session.streak += 1;
  if (session.streak >= session.maxRounds) {""",
)
replace(
    path,
    """  if (session.streak >= session.maxRounds) {
    await recordMetricsSafely(
      context,
      [
        ['highlow_clears', 1],
        ['minigame_wins', 1],
      ],
      session.userId,
    );
    endSession(session);
    await interaction.update({""",
    """  if (session.streak >= session.maxRounds) {
    endSession(session);
    await interaction.update({""",
)
replace(
    path,
    """      components: [],
    });
    await publishMiniGameCompletion(interaction);
    return;
  }

  armSessionTimeout(session, config.sessionTimeoutSeconds);""",
    """      components: [],
    });
    await recordMetricsSafely(
      context,
      [
        ['highlow_round_wins', 1],
        ['highlow_clears', 1],
        ['minigame_wins', 1],
      ],
      session.userId,
    );
    await recordMaximumSafely(context, session.guildId, session.userId, session.streak);
    await publishMiniGameCompletion(interaction);
    return;
  }

  armSessionTimeout(session, config.sessionTimeoutSeconds);""",
)
replace(
    path,
    """    components: [buildHighLowRow(session.id)],
  });
  await publishMiniGameCompletion(interaction);
}""",
    """    components: [buildHighLowRow(session.id)],
  });
  await recordMetricsSafely(context, [['highlow_round_wins', 1]], session.userId);
  await recordMaximumSafely(context, session.guildId, session.userId, session.streak);
  await publishMiniGameCompletion(interaction);
}""",
)

replace(
    path,
    """      endSession(session);
      await recordBlackjackSettlement(context, session);
      await interaction.update({ content: renderBlackjackFinal(session), components: [] });
      await publishMiniGameCompletion(interaction);""",
    """      endSession(session);
      await interaction.update({ content: renderBlackjackFinal(session), components: [] });
      await recordBlackjackSettlement(context, session);
      await publishMiniGameCompletion(interaction);""",
    count=2,
)
replace(
    path,
    """    playDealer(session);
    endSession(session);
    await recordBlackjackSettlement(context, session);
    await interaction.update({ content: renderBlackjackFinal(session), components: [] });
    await publishMiniGameCompletion(interaction);""",
    """    playDealer(session);
    endSession(session);
    await interaction.update({ content: renderBlackjackFinal(session), components: [] });
    await recordBlackjackSettlement(context, session);
    await publishMiniGameCompletion(interaction);""",
)

replace(
    'apps/bot/src/plugins/mini-games-v2-integration.test.ts',
    """    expect(withoutGames.some((challenge) => challenge.metric.startsWith('minigame_'))).toBe(false);
    expect(withoutGames.some((challenge) => challenge.metric === 'blackjack_wins')).toBe(false);""",
    """    expect(withoutGames.some((challenge) => challenge.metric.startsWith('minigame_'))).toBe(false);
    expect(withoutGames.some((challenge) => challenge.metric === 'highlow_round_wins')).toBe(false);
    expect(withoutGames.some((challenge) => challenge.metric === 'blackjack_wins')).toBe(false);""",
)
