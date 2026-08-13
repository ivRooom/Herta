from pathlib import Path

path = Path('apps/bot/src/plugins/mini-games.ts')
text = path.read_text()
old_import = """  getMiniGameStats,
  incrementMiniGameMetric,
  recordMiniGameMaximum,"""
new_import = """  getMiniGameStats,
  incrementMiniGameMetrics,
  recordMiniGameMaximum,"""
assert text.count(old_import) == 1
text = text.replace(old_import, new_import, 1)
old_helper = """  const results = await Promise.allSettled(
    metrics.map(([metric, amount]) =>
      incrementMiniGameMetric(context.prisma, context.guildId, userId, metric, amount),
    ),
  );
  if (results.some((result) => result.status === 'rejected')) {
    context.logger.warn({ guildId: context.guildId }, 'Mini Games戦績の保存に一部失敗しました');
  }"""
new_helper = """  try {
    await incrementMiniGameMetrics(context.prisma, context.guildId, userId, metrics);
  } catch (error) {
    context.logger.warn(
      { err: error, guildId: context.guildId, userId },
      'Mini Games戦績の保存に失敗しました',
    );
  }"""
assert text.count(old_helper) == 1
path.write_text(text.replace(old_helper, new_helper, 1))
