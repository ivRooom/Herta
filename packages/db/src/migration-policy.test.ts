import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const migrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../prisma/migrations',
);

const historicalMultiConcurrentIndexMigrations = new Map([
  [
    '20260825022000_suggestion_staff_queue_index',
    'cde65acc824d2895dc83f58465192de4ef002d0268fd2a2f93adc0388d90ed5c',
  ],
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

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function countConcurrentIndexes(sql: string): number {
  const matchableSql = maskSqlCommentsAndLiterals(sql);
  return (matchableSql.match(/\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/gi) ?? []).length;
}

function maskSqlCommentsAndLiterals(sql: string): string {
  let output = '';
  let index = 0;

  const maskUntil = (endIndex: number) => {
    while (index < endIndex) {
      output += sql[index] === '\n' ? '\n' : ' ';
      index += 1;
    }
  };

  while (index < sql.length) {
    if (sql.startsWith('--', index)) {
      const endIndex = sql.indexOf('\n', index + 2);
      maskUntil(endIndex === -1 ? sql.length : endIndex);
      continue;
    }

    if (sql.startsWith('/*', index)) {
      let cursor = index + 2;
      let depth = 1;
      while (cursor < sql.length && depth > 0) {
        if (sql.startsWith('/*', cursor)) {
          depth += 1;
          cursor += 2;
        } else if (sql.startsWith('*/', cursor)) {
          depth -= 1;
          cursor += 2;
        } else {
          cursor += 1;
        }
      }
      maskUntil(cursor);
      continue;
    }

    const quote = sql[index];
    if (quote === "'" || quote === '"') {
      const isEscapeString =
        quote === "'" &&
        (sql[index - 1] === 'E' || sql[index - 1] === 'e') &&
        (index < 2 || !/[A-Za-z0-9_$]/u.test(sql[index - 2] ?? ''));
      const doubledQuote = `${quote}${quote}`;
      let cursor = index + 1;
      while (cursor < sql.length) {
        if (isEscapeString && sql[cursor] === '\\') {
          cursor += cursor + 1 < sql.length ? 2 : 1;
          continue;
        }
        if (sql.startsWith(doubledQuote, cursor)) {
          cursor += 2;
          continue;
        }
        if (sql[cursor] === quote) {
          cursor += 1;
          break;
        }
        cursor += 1;
      }
      maskUntil(cursor);
      continue;
    }

    if (sql[index] === '$') {
      const tagMatch = sql.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/u);
      if (tagMatch) {
        const tag = tagMatch[0];
        const endIndex = sql.indexOf(tag, index + tag.length);
        maskUntil(endIndex === -1 ? sql.length : endIndex + tag.length);
        continue;
      }
    }

    output += sql[index];
    index += 1;
  }

  return output;
}

test('concurrent index matcher treats SQL comments as whitespace and ignores comment/literal text', () => {
  assert.equal(
    countConcurrentIndexes(`
      CREATE /* reason */ INDEX CONCURRENTLY first_idx ON example (id);
      CREATE
      -- operational note
      UNIQUE INDEX CONCURRENTLY second_idx ON example (name);
    `),
    2,
  );

  assert.equal(
    countConcurrentIndexes(`
      -- CREATE INDEX CONCURRENTLY fake_comment_idx ON example (id);
      /* CREATE UNIQUE INDEX CONCURRENTLY fake_block_idx ON example (id); */
      SELECT 'CREATE INDEX CONCURRENTLY fake_string_idx ON example (id)';
      SELECT $$CREATE INDEX CONCURRENTLY fake_dollar_idx ON example (id)$$;
      SELECT "CREATE INDEX CONCURRENTLY fake_identifier" FROM example;
    `),
    0,
  );

  assert.equal(
    countConcurrentIndexes(String.raw`
      SELECT E'it\'s still a string: CREATE INDEX CONCURRENTLY fake_escape_idx ON example (id)';
      CREATE INDEX CONCURRENTLY first_real_idx ON example (id);
      CREATE UNIQUE INDEX CONCURRENTLY second_real_idx ON example (name);
    `),
    2,
  );
});

test('new migrations contain at most one CREATE INDEX CONCURRENTLY statement', async () => {
  const migrations = await listMigrationSqlFiles();
  const violations: string[] = [];
  const historicalExceptionsSeen = new Set<string>();

  for (const migration of migrations) {
    const sql = await readFile(migration.sqlPath, 'utf8');
    const concurrentIndexCount = countConcurrentIndexes(sql);
    const expectedHistoricalSha256 = historicalMultiConcurrentIndexMigrations.get(
      migration.migrationName,
    );

    if (expectedHistoricalSha256 !== undefined) {
      historicalExceptionsSeen.add(migration.migrationName);
      assert.equal(
        sha256(sql),
        expectedHistoricalSha256,
        `${migration.migrationName} is already applied in production and its full SQL must remain immutable`,
      );
      assert.equal(
        concurrentIndexCount,
        2,
        `${migration.migrationName} must remain the exact historical two-index incident`,
      );
      continue;
    }

    if (concurrentIndexCount > 1) {
      violations.push(`${migration.migrationName}: ${concurrentIndexCount} concurrent indexes`);
    }
  }

  assert.deepEqual(
    [...historicalExceptionsSeen].sort(),
    [...historicalMultiConcurrentIndexMigrations.keys()].sort(),
    'historical concurrent-index migration exception disappeared unexpectedly',
  );
  assert.deepEqual(
    violations,
    [],
    `Split concurrent indexes into separate Prisma migrations:\n${violations.join('\n')}`,
  );
});
