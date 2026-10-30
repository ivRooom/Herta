import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { listValorantAgents, mutateValorantAgent } from './valorant-agents.js';

const url = process.env.HERTA_VALORANT_TEST_DATABASE_URL;
test(
  'real PostgreSQL: guild separation, CRUD, initialization, rollback, audit and concurrent uniqueness',
  { skip: !url },
  async () => {
    const target = new URL(url!);
    assert(['localhost', '127.0.0.1'].includes(target.hostname));
    assert.equal(target.pathname, '/valorant_test');
    const prisma = new PrismaClient({ datasourceUrl: url });
    const guildId = 'valorant-integration-a';
    const other = 'valorant-integration-b';
    const base = { agentId: 'jett', agentName: 'Jett', displayName: 'ジェット', enabled: false };
    const defaults = [base];
    const mutate = (input: Parameters<typeof mutateValorantAgent>[3], guild = guildId) =>
      mutateValorantAgent(prisma, guild, 'synthetic-manager', input, defaults);
    try {
      await prisma.guild.createMany({
        data: [guildId, other].map((id) => ({ id, name: 'Synthetic Valorant test' })),
      });
      assert.equal(await listValorantAgents(prisma, guildId), null);
      await mutate({ action: 'initialize' });
      await mutate({ action: 'initialize' });
      assert.equal((await listValorantAgents(prisma, guildId))!.length, 1);
      assert.equal((await listValorantAgents(prisma, guildId))![0]!.enabled, false);
      assert.equal(await listValorantAgents(prisma, other), null);
      await mutate({ action: 'update', agent: { ...base, displayName: '変更', enabled: true } });
      await mutate({ action: 'initialize' });
      assert.equal((await listValorantAgents(prisma, guildId))![0]!.displayName, '変更');
      assert.equal((await listValorantAgents(prisma, guildId))![0]!.enabled, true);
      await assert.rejects(
        mutate({ action: 'delete', agentId: 'not-in-defaults' }, other),
        /見つかりません/,
      );
      assert.equal(await listValorantAgents(prisma, other), null); // failed mutation rolled back first initialization and audit.
      const custom = {
        ...base,
        agentId: 'custom',
        agentName: 'Custom',
        displayName: '追加',
        enabled: true,
      };
      const outcomes = await Promise.allSettled([
        mutate({ action: 'create', agent: custom }),
        mutate({ action: 'create', agent: custom }),
      ]);
      assert.equal(outcomes.filter((result) => result.status === 'fulfilled').length, 1);
      await assert.rejects(mutate({ action: 'update', agent: custom }, other), /見つかりません/);
      assert.equal(await listValorantAgents(prisma, other), null);
      assert.equal(
        (await listValorantAgents(prisma, guildId))!.filter((agent) => agent.agentId === 'custom')
          .length,
        1,
      );
      await mutate({ action: 'delete', agentId: 'custom' });
      await mutate({ action: 'delete', agentId: 'jett' });
      assert.deepEqual(await listValorantAgents(prisma, guildId), []);
      const audit = await prisma.auditLog.findMany({
        where: { guildId, event: { startsWith: 'valorant.agent.' } },
      });
      assert(audit.some((entry) => entry.event === 'valorant.agent.created'));
      assert(audit.some((entry) => entry.event === 'valorant.agent.updated'));
      assert(audit.some((entry) => entry.event === 'valorant.agent.deleted'));
      assert(audit.every((entry) => entry.actorId === 'synthetic-manager'));
      assert.equal(await prisma.auditLog.count({ where: { guildId: other } }), 0);
      const indexes = await prisma.$queryRaw<
        { valid: boolean }[]
      >`SELECT bool_and(i.indisvalid AND i.indisready) AS valid FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid WHERE t.relname IN ('valorant_agents', 'valorant_rosters')`;
      assert.equal(indexes[0]?.valid, true);
    } finally {
      await prisma.guild.deleteMany({ where: { id: { in: [guildId, other] } } });
      await prisma.$disconnect();
    }
  },
);
