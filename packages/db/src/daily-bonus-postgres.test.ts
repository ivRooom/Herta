import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import {
  reserveDailyAnnouncement,
  captureDailyAnnouncementPopulation,
  setDailyAnnouncement,
  getDailyAnnouncement,
  createDailyQuizSession,
  getDailyQuizSession,
  dailyFortuneSnapshot,
  recordDailyClaim,
  cleanDailyBonusHistory,
  listDailySpecialDayRules,
  saveDailySpecialDayRule,
  deleteDailySpecialDayRule,
} from './daily-bonus.js';

test(
  'isolated PG: daily reservation, durable quiz ownership, first fortune wins and bounded retention',
  {
    skip: process.env.HERTA_RUN_PG_DAILY_TESTS !== '1',
    timeout: 120000,
  },
  async () => {
    const name = `herta-daily-test-${randomUUID()}`;
    let created = false,
      db: PrismaClient | undefined;
    const docker = (...args: string[]) =>
      execFileSync('docker', args, {
        encoding: 'utf8',
        timeout: 30000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
    try {
      docker(
        'create',
        '--pull',
        'never',
        '--name',
        name,
        '--label',
        `herta.daily.fixture=${name}`,
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
      const metadata = JSON.parse(docker('inspect', name))[0],
        port = Number(metadata.NetworkSettings.Ports['5432/tcp'][0].HostPort);
      let ready = false;
      for (let index = 0; index < 60; index++) {
        try {
          docker('exec', name, 'pg_isready', '-U', 'postgres');
          ready = true;
          break;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
      assert.ok(ready);
      const sql = `CREATE TABLE guilds(id TEXT PRIMARY KEY); INSERT INTO guilds VALUES('guild'),('other');\n${readFileSync(new URL('../prisma/migrations/20261029090000_daily_bonus/migration.sql', import.meta.url), 'utf8')}`;
      execFileSync(
        'docker',
        ['exec', '-i', name, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'],
        { input: sql, encoding: 'utf8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] },
      );
      db = new PrismaClient({
        datasources: {
          db: { url: `postgresql://postgres:synthetic-test-only@127.0.0.1:${port}/postgres` },
        },
      });
      const results = await Promise.all(
        Array.from({ length: 20 }, () =>
          reserveDailyAnnouncement(db!, 'guild', '2026-10-29', 'channel', 'role'),
        ),
      );
      assert.equal(results.filter(Boolean).length, 1);
      const capturedAt = new Date();
      await captureDailyAnnouncementPopulation(db, 'guild', '2026-10-29', 'role', {
        count: 42,
        capturedAt,
      });
      assert.equal((await getDailyAnnouncement(db, 'guild', '2026-10-29'))!.eligible_count, 42);
      await captureDailyAnnouncementPopulation(db, 'guild', '2026-10-29', 'wrong-role', {
        count: 9,
        capturedAt,
      });
      assert.equal((await getDailyAnnouncement(db, 'guild', '2026-10-29'))!.eligible_count, 42);
      await setDailyAnnouncement(
        db,
        'guild',
        '2026-10-29',
        'failed',
        null,
        'TargetOrPermissionInvalid',
      );
      await db.$executeRaw`UPDATE daily_bonus_announcements SET status='pending' WHERE guild_id='guild' AND target_date='2026-10-29'`;
      const retried = await reserveDailyAnnouncement(
        db,
        'guild',
        '2026-10-29',
        'corrected-channel',
        'corrected-role',
      );
      assert.equal(retried!.channel_id, 'corrected-channel');
      assert.equal(retried!.role_id, 'corrected-role');
      assert.equal(retried!.eligible_count, null);
      assert.equal(retried!.eligible_captured_at, null);
      await setDailyAnnouncement(db, 'guild', '2026-10-29', 'sent', 'message', null);
      assert.equal((await getDailyAnnouncement(db, 'guild', '2026-10-29'))!.message_id, 'message');
      const session = await createDailyQuizSession(
        db,
        'guild',
        'user',
        '2026-10-29',
        'message',
        'quiz',
      );
      assert.equal((await getDailyQuizSession(db, session, 'guild', 'user'))!.quiz_id, 'quiz');
      assert.equal(await getDailyQuizSession(db, session, 'guild', 'other-user'), null);
      assert.equal(await getDailyQuizSession(db, session, 'other', 'user'), null);
      const fortunes = await Promise.all(
        Array.from({ length: 12 }, (_, index) =>
          dailyFortuneSnapshot(db!, 'guild', 'user', '2026-10-29', 'v1', async () => ({
            stars: index,
          })),
        ),
      );
      assert.ok(fortunes.every((result) => result.stars === fortunes[0]!.stars));
      await recordDailyClaim(db, 'guild', 'user', '2026-10-29', 'confirmed', { rewardPoints: 15 });
      await recordDailyClaim(db, 'guild', 'user', '2026-10-29', 'unavailable');
      const claims = await db.$queryRaw<
        Array<{ status: string; receipt_json: { rewardPoints: number } }>
      >`SELECT status,receipt_json FROM daily_bonus_claims`;
      assert.equal(claims[0]!.status, 'confirmed');
      assert.equal(claims[0]!.receipt_json.rewardPoints, 15);
      await db.$executeRaw`UPDATE daily_fortune_results SET created_at=NOW()-INTERVAL '181 days'`;
      for (const status of ['pending', 'unavailable', 'unlinked'])
        await recordDailyClaim(db, 'guild', `stale-${status}`, '2026-10-29', status);
      await db.$executeRaw`UPDATE daily_bonus_claims SET updated_at=NOW()-INTERVAL '181 days'`;
      await recordDailyClaim(db, 'guild', 'fresh-pending', '2026-10-30', 'pending');
      await db.$executeRaw`UPDATE daily_bonus_quiz_sessions SET created_at=NOW()-INTERVAL '2 days'`;
      process.env.DAILY_BONUS_ENABLED = 'false';
      await cleanDailyBonusHistory(db);
      const counts = await db.$queryRaw<
        Array<{ n: number }>
      >`SELECT COUNT(*)::int AS n FROM daily_fortune_results`;
      assert.equal(counts[0]!.n, 0);
      assert.equal(await getDailyQuizSession(db, session, 'guild', 'user'), null);
      const remaining = await db.$queryRaw<
        Array<{ discord_user_id: string }>
      >`SELECT discord_user_id FROM daily_bonus_claims`;
      assert.deepEqual(
        remaining.map((row) => row.discord_user_id),
        ['fresh-pending'],
      );
    } finally {
      await db?.$disconnect();
      if (created) {
        const metadata = JSON.parse(docker('inspect', name))[0];
        assert.equal(metadata.Config.Labels['herta.daily.fixture'], name);
        docker('rm', '-f', '-v', name);
        assert.equal(docker('ps', '-aq', '--filter', `label=herta.daily.fixture=${name}`), '');
      }
    }
  },
);

test(
  'isolated PG: special-day rules save, uniqueness, guild guard and delete',
  {
    skip: process.env.HERTA_RUN_PG_DAILY_TESTS !== '1',
    timeout: 120000,
  },
  async () => {
    const name = `herta-special-day-test-${randomUUID()}`;
    let created = false,
      db: PrismaClient | undefined;
    const docker = (...args: string[]) =>
      execFileSync('docker', args, {
        encoding: 'utf8',
        timeout: 30000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
    try {
      docker(
        'create',
        '--pull',
        'never',
        '--name',
        name,
        '--label',
        `herta.daily.fixture=${name}`,
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
      const metadata = JSON.parse(docker('inspect', name))[0],
        port = Number(metadata.NetworkSettings.Ports['5432/tcp'][0].HostPort);
      let ready = false;
      for (let index = 0; index < 60; index++) {
        try {
          docker('exec', name, 'pg_isready', '-U', 'postgres');
          ready = true;
          break;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
      assert.ok(ready);
      const sql = `CREATE TABLE guilds(id TEXT PRIMARY KEY); INSERT INTO guilds VALUES('guild'),('other');\n${readFileSync(new URL('../prisma/migrations/20261119230000_daily_special_day_rules/migration.sql', import.meta.url), 'utf8')}`;
      execFileSync(
        'docker',
        ['exec', '-i', name, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'],
        { input: sql, encoding: 'utf8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] },
      );
      db = new PrismaClient({
        datasources: {
          db: { url: `postgresql://postgres:synthetic-test-only@127.0.0.1:${port}/postgres` },
        },
      });
      const annual = await saveDailySpecialDayRule(db, 'guild', {
        id: 'halloween',
        kind: 'annual',
        exactDate: null,
        monthDay: '10-31',
        title: '🎃 Happy Halloween!',
        intro: null,
        enabled: true,
        createdBy: 'tester',
      });
      assert.equal(annual?.month_day, '10-31');
      const dated = await saveDailySpecialDayRule(db, 'guild', {
        id: 'halloween-2026',
        kind: 'date',
        exactDate: '2026-10-31',
        monthDay: null,
        title: null,
        intro: '今年だけの本文',
        enabled: true,
        createdBy: 'tester',
      });
      assert.equal(dated?.exact_date, '2026-10-31');
      assert.equal((await listDailySpecialDayRules(db, 'guild')).length, 2);
      assert.equal((await listDailySpecialDayRules(db, 'other')).length, 0);
      // Same guild + same target under a different id violates the unique index.
      await assert.rejects(
        saveDailySpecialDayRule(db, 'guild', {
          id: 'halloween-copy',
          kind: 'annual',
          exactDate: null,
          monthDay: '10-31',
          title: '複製',
          intro: null,
          enabled: true,
          createdBy: 'tester',
        }),
      );
      // A rule id owned by another guild cannot be hijacked by an upsert.
      const hijack = await saveDailySpecialDayRule(db, 'other', {
        id: 'halloween',
        kind: 'annual',
        exactDate: null,
        monthDay: '12-25',
        title: '乗っ取り',
        intro: null,
        enabled: true,
        createdBy: 'attacker',
      });
      assert.equal(hijack, null);
      assert.equal(
        (await listDailySpecialDayRules(db, 'guild')).find((row) => row.id === 'halloween')
          ?.month_day,
        '10-31',
      );
      // Re-saving the same id in its own guild updates in place.
      const updated = await saveDailySpecialDayRule(db, 'guild', {
        id: 'halloween',
        kind: 'annual',
        exactDate: null,
        monthDay: '10-31',
        title: '🎃 更新後のタイトル',
        intro: null,
        enabled: false,
        createdBy: 'tester',
      });
      assert.equal(updated?.title, '🎃 更新後のタイトル');
      assert.equal(updated?.enabled, false);
      await deleteDailySpecialDayRule(db, 'other', 'halloween');
      assert.equal((await listDailySpecialDayRules(db, 'guild')).length, 2);
      await deleteDailySpecialDayRule(db, 'guild', 'halloween');
      assert.deepEqual(
        (await listDailySpecialDayRules(db, 'guild')).map((row) => row.id),
        ['halloween-2026'],
      );
    } finally {
      await db?.$disconnect();
      if (created) {
        const metadata = JSON.parse(docker('inspect', name))[0];
        assert.equal(metadata.Config.Labels['herta.daily.fixture'], name);
        docker('rm', '-f', '-v', name);
        assert.equal(docker('ps', '-aq', '--filter', `label=herta.daily.fixture=${name}`), '');
      }
    }
  },
);
