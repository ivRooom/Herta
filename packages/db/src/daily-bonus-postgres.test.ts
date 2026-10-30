import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import {
  reserveDailyAnnouncement,
  setDailyAnnouncement,
  getDailyAnnouncement,
  createDailyQuizSession,
  getDailyQuizSession,
  dailyFortuneSnapshot,
  recordDailyClaim,
  cleanDailyBonusHistory,
  saveDailyAnniversary,
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
      const event = {
        id: 'shared-id',
        title: 'test',
        summary: 'test',
        category: 'game',
        month: 1,
        day: 1,
        base_year: null,
        work_name: '',
        character_name: '',
        source_url: 'https://example.test/source',
        source_checked_at: new Date(),
        approved: false,
        public: false,
        priority: 0,
        pinned_date: null,
        anniversary_mode: 'annual' as const,
      };
      const concurrent = await Promise.allSettled(
        ['guild', 'other'].map((guild) => saveDailyAnniversary(db!, guild, event)),
      );
      assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 1);
      assert.equal(concurrent.filter((result) => result.status === 'rejected').length, 1);
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
