from pathlib import Path

path = Path('apps/bot/src/plugins/mini-games.ts')
text = path.read_text()
old = """  const userId = interaction.options.getUser('user')?.id ?? interaction.user.id;
  const stats = await getMiniGameStats(context.prisma, interaction.guildId, userId);
  await interaction.reply({
    content: formatMiniGameStats(userId, stats),
    allowedMentions: { parse: [] },
  });"""
new = """  const userId = interaction.options.getUser('user')?.id ?? interaction.user.id;
  await interaction.deferReply();
  const stats = await getMiniGameStats(context.prisma, interaction.guildId, userId);
  await interaction.editReply({
    content: formatMiniGameStats(userId, stats),
    allowedMentions: { parse: [] },
  });"""
assert text.count(old) == 1, text.count(old)
path.write_text(text.replace(old, new, 1))
