import { readFileSync, writeFileSync } from 'node:fs';

function replaceOrThrow(path, before, after) {
  const current = readFileSync(path, 'utf8');
  if (!current.includes(before)) {
    throw new Error(`${path}: expected source block was not found`);
  }
  writeFileSync(path, current.replace(before, after));
}

replaceOrThrow(
  'plugins/auto-response/src/service.ts',
  `    if (input.guildCooldownSeconds > 0) {
      const latest = await tx.autoResponseExecutionEvent.findFirst({
        where: { guildId: input.guildId, status: 'success' },
        orderBy: { executedAt: 'desc' },
      });
      if (
        latest &&
        now.getTime() - latest.executedAt.getTime() < input.guildCooldownSeconds * 1000
      ) {
        return false;
      }
    }`,
  `    if (input.guildCooldownSeconds > 0) {
      const latestClaimedRule = await tx.autoResponse.findFirst({
        where: { guildId: input.guildId, lastTriggeredAt: { not: null } },
        orderBy: { lastTriggeredAt: 'desc' },
      });
      if (
        latestClaimedRule?.lastTriggeredAt &&
        now.getTime() - latestClaimedRule.lastTriggeredAt.getTime() <
          input.guildCooldownSeconds * 1000
      ) {
        return false;
      }
    }`,
);

replaceOrThrow(
  'plugins/auto-response/src/service.test.ts',
  `  it('Guild Cooldown中は別Ruleでも実行権を取得しない', async () => {
    const now = new Date('2026-07-28T10:00:00Z');
    const { client, tx } = mockClient();
    vi.mocked(tx.autoResponseExecutionEvent.findFirst).mockResolvedValue({
      id: '22222222-2222-4222-8222-222222222222',
      guildId: GUILD_ID,
      ruleId: RULE_ID,
      status: 'success',
      durationMs: 2,
      errorName: null,
      executedAt: new Date(now.getTime() - 500),
    });

    await expect(
      claimAutoResponseRule(client, {
        guildId: GUILD_ID,
        ruleId: RULE_ID,
        guildCooldownSeconds: 1,
        now,
      }),
    ).resolves.toBe(false);
    expect(tx.autoResponse.update).not.toHaveBeenCalled();
  });`,
  `  it('Guild Cooldown中は別Ruleでも実行権を取得しない', async () => {
    const now = new Date('2026-07-28T10:00:00Z');
    const { client, tx } = mockClient();
    vi.mocked(tx.autoResponse.findFirst)
      .mockResolvedValueOnce(rule())
      .mockResolvedValueOnce(
        rule({
          id: '33333333-3333-4333-8333-333333333333',
          lastTriggeredAt: new Date(now.getTime() - 500),
        }),
      );

    await expect(
      claimAutoResponseRule(client, {
        guildId: GUILD_ID,
        ruleId: RULE_ID,
        guildCooldownSeconds: 1,
        now,
      }),
    ).resolves.toBe(false);
    expect(tx.autoResponse.update).not.toHaveBeenCalled();
    expect(tx.autoResponseExecutionEvent.findFirst).not.toHaveBeenCalled();
  });`,
);

replaceOrThrow(
  'plugins/auto-response/src/service.test.ts',
  `  it('Cooldown外ではlastTriggeredAtを更新して実行権を取得する', async () => {
    const now = new Date('2026-07-28T10:00:00Z');
    const { client, tx } = mockClient();

    await expect(`,
  `  it('直前の予約がない場合はlastTriggeredAtを更新して実行権を取得する', async () => {
    const now = new Date('2026-07-28T10:00:00Z');
    const { client, tx } = mockClient();
    vi.mocked(tx.autoResponse.findFirst).mockResolvedValueOnce(rule()).mockResolvedValueOnce(null);

    await expect(`,
);

replaceOrThrow(
  'packages/db/prisma/schema.prisma',
  '  @@index([guildId, priority, createdAt])',
  '  @@index([guildId, priority(sort: Desc), createdAt])',
);

replaceOrThrow(
  'docs/plugins/AUTO_RESPONSE.md',
  'Rule CooldownとGuild Cooldownは、PostgreSQL Transaction Advisory LockをGuild単位で取得して判定します。複数メッセージが同時に到着しても、同じGuildで送信権を同時取得しない設計です。',
  'Rule CooldownとGuild Cooldownは、PostgreSQL Transaction Advisory LockをGuild単位で取得し、Guild内で最後に送信権を予約した`lastTriggeredAt`を参照して判定します。複数メッセージが同時に到着しても、同じGuildで送信権を同時取得しない設計です。',
);

console.log('Auto Response concurrency fix applied.');
