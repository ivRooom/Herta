import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { commonPointsJstDay, freezeCommonPointsTariff } from './common-points-accrual.js';
import {
  commitCommonPointAccrual,
  commitCommonPointAccrualInTransaction,
} from './common-points-outbox.js';
import type { CommonPointSourceIncrement } from './common-points-outbox.js';

test(
  'real isolated PG17: source mutation, daily floors/caps, receipt and outbox commit exactly once',
  {
    skip: process.env.HERTA_RUN_PG_POINTS_TESTS !== '1',
    timeout: 120_000,
  },
  async () => {
    const name = `herta-points-source-test-${randomUUID()}`;
    const docker = (...args: string[]) =>
      execFileSync('docker', args, {
        encoding: 'utf8',
        timeout: 30_000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
    let created = false,
      prisma: PrismaClient | undefined;
    try {
      docker(
        'create',
        '--pull',
        'never',
        '--name',
        name,
        '--label',
        `ivrm.points.fixture=${name}`,
        '--memory',
        '384m',
        '--memory-swap',
        '384m',
        '--pids-limit',
        '128',
        '--tmpfs',
        '/var/lib/postgresql/data:rw,size=256m',
        '-p',
        '127.0.0.1::5432',
        '-e',
        'POSTGRES_PASSWORD=synthetic-test-only',
        'postgres:17-alpine',
      );
      created = true;
      docker('start', name);
      const metadata = JSON.parse(docker('inspect', name))[0];
      const port = Number(metadata.NetworkSettings.Ports['5432/tcp'][0].HostPort);
      assert.ok(Number.isInteger(port) && port > 0);
      prisma = new PrismaClient({
        datasources: {
          db: {
            url: `postgresql://postgres:synthetic-test-only@127.0.0.1:${port}/postgres?connection_limit=12&pool_timeout=5`,
          },
        },
      });
      const db = prisma;
      let ready = false;
      for (let i = 0; i < 60; i++) {
        try {
          await db.$queryRaw`SELECT 1`;
          ready = true;
          break;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
      assert.ok(ready);
      execFileSync(
        'docker',
        ['exec', '-i', name, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'],
        {
          input: readFileSync(
            new URL(
              '../prisma/migrations/20261029000000_add_common_points_source_outbox/migration.sql',
              import.meta.url,
            ),
          ),
          encoding: 'utf8',
          timeout: 30_000,
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      );
      await db.$executeRaw`CREATE TABLE synthetic_source_events (id TEXT PRIMARY KEY, units BIGINT NOT NULL)`;
      const tariff = freezeCommonPointsTariff({
        messagePointsPerMessage: 2,
        reactionPointsPerReaction: 1,
        voicePointsPer10Minutes: 3,
        onlinePointsPerHour: 7,
        onlinePointsDailyCap: 10,
        gamePointsPerHour: 6,
        gamePointsDailyCap: 11,
        achievementPoints: 10,
        commandPointsPerUse: 3,
        commandPointsDailyCap: 8,
        lfgPointsPerJoin: 4,
        lfgPointsDailyCap: 9,
        teamSplitPointsPerJoin: 5,
        teamSplitPointsDailyCap: 12,
        pollPointsPerVote: 2,
        pollPointsDailyCap: 5,
      });
      const guildId = '100000000000000000',
        discordUserId = '200000000000000000';
      const epoch = randomUUID(),
        cutoff = new Date('2020-01-01T00:00:00.000Z'),
        occurredAt = new Date(Date.now() - 60_000);
      await db.$executeRaw`INSERT INTO common_points_policies (guild_id,epoch,rule_version,tariff_json,cutoff_at) VALUES (${guildId},${epoch}::uuid,${tariff.ruleVersion},${JSON.stringify(tariff)},${cutoff})`;
      const input = (
        sourceId: string,
        overrides: Partial<CommonPointSourceIncrement> = {},
      ): CommonPointSourceIncrement => ({
        guildId,
        discordUserId,
        metric: 'messages',
        sourceId,
        units: 1n,
        occurredAt,
        ...overrides,
      });
      const apply = (value: CommonPointSourceIncrement) =>
        commitCommonPointAccrual(db, value, async (tx) => {
          await tx.$executeRaw`INSERT INTO synthetic_source_events VALUES (${value.sourceId},${value.units})`;
        });
      await assert.rejects(apply(input('disabled')), /not_ready/);
      await assert.rejects(
        db.$executeRaw`UPDATE common_points_policies SET enabled=true WHERE guild_id=${guildId}`,
      );
      await db.$executeRaw`UPDATE common_points_policies SET baseline_complete=true,enabled=true WHERE guild_id=${guildId}`;
      await Promise.all(Array.from({ length: 20 }, (_, i) => apply(input(`parallel:${i}`))));
      const repeated = await Promise.all(Array.from({ length: 8 }, () => apply(input('replay'))));
      assert.equal(repeated.filter((row) => !row.replayed).length, 1);
      await assert.rejects(apply(input('replay', { units: 2n })), /source_conflict/);
      // Same values with a different object property order must still be a replay.
      const reversed = Object.fromEntries(
        Object.entries(input('replay')).reverse(),
      ) as unknown as CommonPointSourceIncrement;
      assert.equal((await apply(reversed)).replayed, true);
      await assert.rejects(
        commitCommonPointAccrual(db, input('failure'), async (tx) => {
          await tx.$executeRaw`INSERT INTO synthetic_source_events VALUES ('failure',1)`;
          throw new Error('synthetic_rollback');
        }),
        /synthetic_rollback/,
      );
      assert.equal((await apply(input('failure'))).creditedPoints, 2n);
      assert.equal(
        (await apply(input('voice:599', { metric: 'voice_seconds', units: 599n }))).creditedPoints,
        0n,
      );
      assert.equal((await apply(input('voice:1', { metric: 'voice_seconds' }))).creditedPoints, 3n);
      assert.equal(
        (await apply(input('commands:2', { metric: 'commands', units: 2n }))).creditedPoints,
        6n,
      );
      assert.equal((await apply(input('commands:3', { metric: 'commands' }))).creditedPoints, 2n);
      assert.equal((await apply(input('commands:4', { metric: 'commands' }))).creditedPoints, 0n);
      assert.equal((await apply(input('large', { units: 500_001n }))).creditedPoints, 1_000_002n);
      // Approved cutoff baseline carries the incomplete hour and consumed cap.
      const linkedUser = '300000000000000000';
      const day = commonPointsJstDay(occurredAt);
      await db.$executeRaw`INSERT INTO common_points_daily_counters VALUES (${guildId},${linkedUser},${day}::date,'voice_seconds',599),(${guildId},${linkedUser},${day}::date,'online_seconds',3600)`;
      assert.equal(
        (await apply(input('seeded-voice', { discordUserId: linkedUser, metric: 'voice_seconds' })))
          .creditedPoints,
        3n,
      );
      assert.equal(
        (
          await apply(
            input('seeded-online', {
              discordUserId: linkedUser,
              metric: 'online_seconds',
              units: 3600n,
            }),
          )
        ).creditedPoints,
        3n,
      );
      // A failure AFTER source/counter/receipt writes must roll all of them back.
      await db.$executeRawUnsafe(
        `CREATE FUNCTION synthetic_outbox_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.body::jsonb->>'discordUserId' = '400000000000000000' THEN RAISE EXCEPTION 'synthetic_outbox_failure'; END IF; RETURN NEW; END $$`,
      );
      await db.$executeRaw`CREATE TRIGGER synthetic_outbox_failure BEFORE INSERT ON common_points_outbox FOR EACH ROW EXECUTE FUNCTION synthetic_outbox_failure()`;
      const failedOutboxInput = input('outbox-failure', { discordUserId: '400000000000000000' });
      await assert.rejects(apply(failedOutboxInput));
      const absent = await db.$queryRaw<
        Array<{ count: bigint }>
      >`SELECT count(*)::bigint AS count FROM synthetic_source_events WHERE id='outbox-failure'`;
      assert.equal(absent[0]?.count, 0n);
      await db.$executeRaw`DROP TRIGGER synthetic_outbox_failure ON common_points_outbox`;
      assert.equal((await apply(failedOutboxInput)).creditedPoints, 2n);
      // An outer service transaction owns commit; the helper cannot commit early.
      await assert.rejects(
        db.$transaction(async (tx) => {
          await commitCommonPointAccrualInTransaction(tx, input('outer-rollback'), async () => {
            await tx.$executeRaw`INSERT INTO synthetic_source_events VALUES ('outer-rollback',1)`;
          });
          throw new Error('synthetic_outer_rollback');
        }),
        /synthetic_outer_rollback/,
      );
      const outerAbsent = await db.$queryRaw<
        Array<{ count: bigint }>
      >`SELECT count(*)::bigint AS count FROM synthetic_source_events WHERE id='outer-rollback'`;
      assert.equal(outerAbsent[0]?.count, 0n);
      assert.equal((await apply(input('outer-rollback'))).creditedPoints, 2n);
      await assert.rejects(apply(input('too-large', { units: 64_000_000n })), /event_bound/);
      await assert.rejects(apply(input('before-cutoff', { occurredAt: cutoff })), /before_cutoff/);
      await assert.rejects(apply(input('counter-overflow', { units: 9_223_372_036_854_775_807n })));
      await assert.rejects(
        db.$executeRaw`UPDATE common_points_policies SET rule_version=${'f'.repeat(64)} WHERE guild_id=${guildId}`,
      );
      await assert.rejects(db.$executeRaw`UPDATE common_points_outbox SET body='{}'`);
      await assert.rejects(db.$executeRaw`DELETE FROM common_points_source_receipts`);
      await assert.rejects(db.$executeRaw`TRUNCATE common_points_outbox`);
      const receipts = await db.$queryRaw<
        Array<{ total: bigint; count: bigint }>
      >`SELECT sum(credited_points)::bigint AS total,count(*)::bigint AS count FROM common_points_source_receipts`;
      const sourceCount = await db.$queryRaw<
        Array<{ count: bigint }>
      >`SELECT count(*)::bigint AS count FROM synthetic_source_events`;
      const outbox = await db.$queryRaw<
        Array<{ body: string; bodySha256: string; status: string }>
      >`SELECT body,body_sha256 AS "bodySha256",status FROM common_points_outbox`;
      let total = 0n;
      for (const event of outbox) {
        assert.equal(createHash('sha256').update(event.body).digest('hex'), event.bodySha256);
        const body = JSON.parse(event.body);
        assert.ok(body.amount > 0 && body.amount <= 1_000_000 && Number.isSafeInteger(body.amount));
        assert.equal(body.epoch, epoch);
        assert.equal(body.ruleVersion, tariff.ruleVersion);
        assert.equal(event.status, 'pending');
        total += BigInt(body.amount);
      }
      assert.equal(total, 1_000_067n);
      assert.equal(receipts[0]?.total, total);
      assert.equal(sourceCount[0]?.count, receipts[0]?.count);
      assert.equal(sourceCount[0]?.count, 32n);
    } finally {
      await prisma?.$disconnect();
      if (created) {
        const owner = docker(
          'inspect',
          '--format',
          '{{index .Config.Labels "ivrm.points.fixture"}}',
          name,
        );
        assert.equal(owner, name);
        docker('rm', '-f', name);
      }
    }
  },
);
