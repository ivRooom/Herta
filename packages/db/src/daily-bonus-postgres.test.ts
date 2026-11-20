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
  createDailyBonusTemplateRevision,
  listDailyBonusTemplateRevisions,
  getDailyBonusTemplateRevision,
  getActiveDailyBonusTemplateRevision,
  updateDailyBonusTemplateRevisionDraft,
  submitDailyBonusTemplateRevision,
  approveDailyBonusTemplateRevision,
  returnDailyBonusTemplateRevision,
  activateDailyBonusTemplateRevision,
  deactivateDailyBonusTemplateRevision,
  deleteDailyBonusTemplateRevision,
  setDailyAnnouncementTemplateRevision,
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

test(
  'isolated PG: template revision lifecycle, self-approval guard, CAS activation and snapshot',
  {
    skip: process.env.HERTA_RUN_PG_DAILY_TESTS !== '1',
    timeout: 120000,
  },
  async () => {
    const name = `herta-template-revision-test-${randomUUID()}`;
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
      const sql = `CREATE TABLE guilds(id TEXT PRIMARY KEY); INSERT INTO guilds VALUES('guild'),('other');\nCREATE TABLE daily_bonus_announcements(guild_id TEXT NOT NULL, target_date TEXT NOT NULL, channel_id TEXT NOT NULL, role_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', message_id TEXT, error_code TEXT, eligible_count INT, eligible_captured_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(guild_id, target_date));\n${readFileSync(new URL('../prisma/migrations/20261121090000_daily_bonus_template_revisions/migration.sql', import.meta.url), 'utf8')}`;
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
      // Drafts are numbered per guild and start as drafts.
      const first = await createDailyBonusTemplateRevision(db, 'guild', {
        id: 'rev-1',
        messageTemplate: '最初の本文',
        createdBy: 'author',
      });
      assert.equal(first.revision, 1);
      assert.equal(first.status, 'draft');
      const second = await createDailyBonusTemplateRevision(db, 'guild', {
        id: 'rev-2',
        messageTemplate: '次の本文',
        createdBy: 'author',
      });
      assert.equal(second.revision, 2);
      assert.equal((await listDailyBonusTemplateRevisions(db, 'other')).length, 0);
      // Draft edit works; approval requires submission first.
      assert.equal(
        await updateDailyBonusTemplateRevisionDraft(db, 'guild', 'rev-1', '直した本文'),
        1,
      );
      assert.equal(await approveDailyBonusTemplateRevision(db, 'guild', 'rev-1', 'reviewer'), 0);
      assert.equal(await submitDailyBonusTemplateRevision(db, 'guild', 'rev-1'), 1);
      // The author can never approve their own revision, even at the SQL layer.
      assert.equal(await approveDailyBonusTemplateRevision(db, 'guild', 'rev-1', 'author'), 0);
      assert.equal(await approveDailyBonusTemplateRevision(db, 'guild', 'rev-1', 'reviewer'), 1);
      // Approved content is frozen.
      assert.equal(
        await updateDailyBonusTemplateRevisionDraft(db, 'guild', 'rev-1', '差し替え'),
        0,
      );
      // Activation is a CAS on the currently active revision.
      assert.equal(
        await activateDailyBonusTemplateRevision(db, 'guild', 'rev-1', 'rev-2'),
        'conflict',
      );
      assert.equal(
        await activateDailyBonusTemplateRevision(db, 'guild', 'rev-1', null),
        'activated',
      );
      assert.equal((await getActiveDailyBonusTemplateRevision(db, 'guild'))?.id, 'rev-1');
      // Activating the second revision supersedes the first.
      assert.equal(await submitDailyBonusTemplateRevision(db, 'guild', 'rev-2'), 1);
      assert.equal(await approveDailyBonusTemplateRevision(db, 'guild', 'rev-2', 'reviewer'), 1);
      assert.equal(
        await activateDailyBonusTemplateRevision(db, 'guild', 'rev-2', 'rev-1'),
        'activated',
      );
      assert.equal((await getActiveDailyBonusTemplateRevision(db, 'guild'))?.id, 'rev-2');
      assert.equal(
        (await getDailyBonusTemplateRevision(db, 'guild', 'rev-1'))?.status,
        'superseded',
      );
      // The delivery snapshot records the revision used for the day.
      await db.$executeRaw`INSERT INTO daily_bonus_announcements(guild_id,target_date,channel_id,role_id,status) VALUES('guild','2026-11-21','channel','role','sent')`;
      await setDailyAnnouncementTemplateRevision(db, 'guild', '2026-11-21', 'rev-2');
      assert.equal(
        (await getDailyAnnouncement(db, 'guild', '2026-11-21'))?.template_revision_id,
        'rev-2',
      );
      // Deactivation is CAS-guarded too and returns delivery to the config template.
      assert.equal(await deactivateDailyBonusTemplateRevision(db, 'guild', 'rev-1'), 0);
      assert.equal(await deactivateDailyBonusTemplateRevision(db, 'guild', 'rev-2'), 1);
      assert.equal(await getActiveDailyBonusTemplateRevision(db, 'guild'), null);
      // Return flow: pending -> rejected with a note, editable again, resubmittable.
      const third = await createDailyBonusTemplateRevision(db, 'guild', {
        id: 'rev-3',
        messageTemplate: '差戻し対象',
        createdBy: 'author',
      });
      assert.equal(third.revision, 3);
      assert.equal(await submitDailyBonusTemplateRevision(db, 'guild', 'rev-3'), 1);
      assert.equal(
        await returnDailyBonusTemplateRevision(db, 'guild', 'rev-3', '誤字があります'),
        1,
      );
      const returned = await getDailyBonusTemplateRevision(db, 'guild', 'rev-3');
      assert.equal(returned?.status, 'rejected');
      assert.equal(returned?.review_note, '誤字があります');
      assert.equal(
        await updateDailyBonusTemplateRevisionDraft(db, 'guild', 'rev-3', '直した差戻し対象'),
        1,
      );
      assert.equal((await getDailyBonusTemplateRevision(db, 'guild', 'rev-3'))?.status, 'draft');
      // Only drafts and returned revisions can be deleted.
      assert.equal(await deleteDailyBonusTemplateRevision(db, 'guild', 'rev-2'), 0);
      assert.equal(await deleteDailyBonusTemplateRevision(db, 'guild', 'rev-3'), 1);
      assert.equal((await listDailyBonusTemplateRevisions(db, 'guild')).length, 2);
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
