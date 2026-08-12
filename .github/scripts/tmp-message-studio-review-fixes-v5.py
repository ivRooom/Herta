from pathlib import Path


def replace(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"pattern not found in {path}: {old[:140]!r}")
    p.write_text(text.replace(old, new, 1))


# Interaction acknowledgement + immediate content-length validation.
path = 'plugins/daily-content/src/plugin.ts'
replace(
    path,
    """  replied: boolean;
  deferred: boolean;
  reply(options: DailyContentReplyOptions): Promise<unknown>;
  followUp(options: DailyContentReplyOptions): Promise<unknown>;
}""",
    """  replied: boolean;
  deferred: boolean;
  deferReply(options: { flags: number }): Promise<unknown>;
  editReply(options: DailyContentReplyOptions): Promise<unknown>;
  reply(options: DailyContentReplyOptions): Promise<unknown>;
  followUp(options: DailyContentReplyOptions): Promise<unknown>;
}""",
)
replace(
    path,
    """  if (subcommand === 'send') {
    const channelId = resolveChannelId(interaction, config, false);""",
    """  if (subcommand === 'send') {
    await deferEphemeral(interaction);
    const channelId = resolveChannelId(interaction, config, false);""",
)
replace(
    path,
    """  if (subcommand === 'send') {
    const channelId = resolveChannelId(interaction, config, true);""",
    """  if (subcommand === 'send') {
    await deferEphemeral(interaction);
    const channelId = resolveChannelId(interaction, config, true);""",
)
replace(
    path,
    """  if (subcommand === 'reply') {
    const reference = parseDiscordMessageUrl(requiredOption(interaction, 'message_url'));""",
    """  if (subcommand === 'reply') {
    await deferEphemeral(interaction);
    const reference = parseDiscordMessageUrl(requiredOption(interaction, 'message_url'));""",
)
replace(
    path,
    """  const content = interaction.options.getString('content')?.trim() ?? '';
  assertSafeMentions(content, config.allowUserMentions);""",
    """  const content = interaction.options.getString('content')?.trim() ?? '';
  if (content.length > config.maxContentLength) {
    throw new DailyContentValidationError(
      `contentは${config.maxContentLength}文字以内で指定してください`,
    );
  }
  assertSafeMentions(content, config.allowUserMentions);""",
)
replace(
    path,
    """async function respond(
  interaction: DailyContentCommandInteraction,
  content: string,
  embeds?: unknown[],
): Promise<void> {
  const options: DailyContentReplyOptions = {
    content,
    ...(embeds?.length ? { embeds } : {}),
    flags: EPHEMERAL_FLAG,
    allowedMentions: { parse: [] },
  };
  if (interaction.replied || interaction.deferred) await interaction.followUp(options);
  else await interaction.reply(options);
}""",
    """async function deferEphemeral(interaction: DailyContentCommandInteraction): Promise<void> {
  if (!interaction.replied && !interaction.deferred) {
    await interaction.deferReply({ flags: EPHEMERAL_FLAG });
  }
}

async function respond(
  interaction: DailyContentCommandInteraction,
  content: string,
  embeds?: unknown[],
): Promise<void> {
  const baseOptions: DailyContentReplyOptions = {
    content,
    ...(embeds?.length ? { embeds } : {}),
    allowedMentions: { parse: [] },
  };
  if (interaction.deferred) {
    await interaction.editReply(baseOptions);
    return;
  }
  const ephemeralOptions = { ...baseOptions, flags: EPHEMERAL_FLAG };
  if (interaction.replied) await interaction.followUp(ephemeralOptions);
  else await interaction.reply(ephemeralOptions);
}""",
)

# Re-check the current schedule under the same guild advisory lock used by
# Studio/API updates before auto-completing a one-shot.
path = 'plugins/daily-content/src/service.ts'
replace(
    path,
    """    deliveryId: string;
    scheduleId: string;
    messageId: string;
    sentAt?: Date;
    completeOneShot?: boolean;
  },""",
    """    deliveryId: string;
    scheduleId: string;
    guildId: string;
    messageId: string;
    sentAt?: Date;
    completeOneShot?: boolean;
    expectedOneShotAt?: Date;
  },""",
)
replace(
    path,
    """  const sentAt = input.sentAt ?? new Date();
  await prisma.$transaction(async (tx) => {
    await tx.dailyContentDelivery.update({""",
    """  const sentAt = input.sentAt ?? new Date();
  await prisma.$transaction(async (tx) => {
    await lockGuild(tx, input.guildId);
    const currentSchedule = await tx.dailyContent.findFirst({
      where: { id: input.scheduleId, guildId: input.guildId },
    });
    const expectedOneShotAt = input.expectedOneShotAt?.getTime();
    const shouldCompleteOneShot =
      input.completeOneShot === true &&
      expectedOneShotAt !== undefined &&
      currentSchedule?.deletedAt === null &&
      currentSchedule.enabled === true &&
      currentSchedule.recurrenceType === 'once' &&
      currentSchedule.onceAt?.getTime() === expectedOneShotAt &&
      currentSchedule.lastScheduledAt?.getTime() === expectedOneShotAt;

    await tx.dailyContentDelivery.update({""",
)
replace(
    path,
    """        lastSentAt: sentAt,
        ...(input.completeOneShot ? { enabled: false, nextRunAt: null } : {}),""",
    """        lastSentAt: sentAt,
        ...(shouldCompleteOneShot ? { enabled: false, nextRunAt: null } : {}),""",
)

# Worker provides the guild and exact scheduled occurrence expected to complete.
replace(
    'apps/worker/src/daily-content.ts',
    """      deliveryId: delivery.id,
      scheduleId: delivery.dailyContent.id,
      messageId,
      completeOneShot:
        delivery.origin === 'scheduled' && delivery.dailyContent.recurrenceType === 'once',
    });""",
    """      deliveryId: delivery.id,
      scheduleId: delivery.dailyContent.id,
      guildId: delivery.guildId,
      messageId,
      completeOneShot:
        delivery.origin === 'scheduled' && delivery.dailyContent.recurrenceType === 'once',
      expectedOneShotAt:
        delivery.origin === 'scheduled' && delivery.dailyContent.recurrenceType === 'once'
          ? delivery.scheduledFor
          : undefined,
    });""",
)

# Service tests: update existing markDeliverySent call and add stale-snapshot
# regression for an edited one-shot.
p = Path('plugins/daily-content/src/service.test.ts')
text = p.read_text()
old = """      deliveryId: reserved!.id,
      scheduleId: 'schedule-1',
      messageId: 'message-1',
      sentAt,
      completeOneShot: true,
    });"""
new = """      deliveryId: reserved!.id,
      scheduleId: 'schedule-1',
      guildId: 'guild-1',
      messageId: 'message-1',
      sentAt,
      completeOneShot: true,
      expectedOneShotAt: harness.scheduledFor,
    });"""
if old not in text:
    raise SystemExit('existing markDeliverySent test call not found')
text = text.replace(old, new, 1)
insert = r'''

  it('配信中にone-shot日時が編集された場合は新しい予約を無効化しない', async () => {
    const originalAt = new Date('2030-01-01T00:10:00Z');
    const editedAt = new Date('2030-01-02T00:10:00Z');
    const harness = createHarness({
      onceAt: editedAt,
      lastScheduledAt: originalAt,
      nextRunAt: editedAt,
      enabled: true,
    });

    await markDeliverySent(harness.prisma, {
      deliveryId: 'delivery-1',
      scheduleId: 'schedule-1',
      guildId: 'guild-1',
      messageId: 'message-after-edit',
      completeOneShot: true,
      expectedOneShotAt: originalAt,
    }).catch(() => undefined);

    expect(harness.getSchedule().enabled).toBe(true);
    expect(harness.getSchedule().onceAt).toEqual(editedAt);
    expect(harness.getSchedule().nextRunAt).toEqual(editedAt);
  });
'''
if insert.strip() not in text:
    text = text.rsplit('\n});', 1)[0] + insert + '\n});\n'
p.write_text(text)
