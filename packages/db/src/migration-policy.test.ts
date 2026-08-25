import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const migrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../prisma/migrations',
);

const historicalMultiConcurrentIndexMigrations = new Set([
  // 2026-08-25 production incident: Prisma wrapped the two statements in a
  // transaction, causing PostgreSQL 25001. Production was recovered manually;
  // do not edit this already-applied migration because its checksum is history.
  '20260825022000_suggestion_staff_queue_index',
]);

async function listMigrationSqlFiles() {
  const entries = await readdir(migrationsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      migrationName: entry.name,
      sqlPath: path.join(migrationsDir, entry.name, 'migration.sql'),
    }));
}

test('new migrations contain at most one CREATE INDEX CONCURRENTLY statement', async () => {
  const migrations = await listMigrationSqlFiles();
  const violations: string[] = [];
  let historicalExceptionSeen = false;

  for (const migration of migrations) {
    const sql = await readFile(migration.sqlPath, 'utf8');
    const concurrentIndexCount = (
      sql.match(/\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/gi) ?? []
    ).length;

    if (historicalMultiConcurrentIndexMigrations.has(migration.migrationName)) {
      historicalExceptionSeen = true;
      assert.equal(
        concurrentIndexCount,
        2,
        `${migration.migrationName} is a historical production incident and must not be silently changed`,
      );
      continue;
    }

    if (concurrentIndexCount > 1) {
      violations.push(`${migration.migrationName}: ${concurrentIndexCount} concurrent indexes`);
    }
  }

  assert.equal(
    historicalExceptionSeen,
    true,
    'historical concurrent-index migration exception disappeared unexpectedly',
  );
  assert.deepEqual(
    violations,
    [],
    `Split concurrent indexes into separate Prisma migrations:\n${violations.join('\n')}`,
  );
});
