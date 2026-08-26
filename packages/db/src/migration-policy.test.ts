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

type SqlAnalysis = {
  concurrentIndexCount: number;
  executableStatementCount: number;
};

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

function analyzeSql(sql: string, backslashEscapesInStandardStrings: boolean): SqlAnalysis {
  const matchableSql = maskSqlCommentsAndLiterals(sql, backslashEscapesInStandardStrings);
  return {
    concurrentIndexCount: countConcurrentIndexStatements(matchableSql),
    executableStatementCount: matchableSql
      .split(';')
      .map((statement) => statement.trim())
      .filter(Boolean).length,
  };
}

function countConcurrentIndexStatements(matchableSql: string): number {
  const pattern = /CREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY/gi;
  let count = 0;

  for (const match of matchableSql.matchAll(pattern)) {
    const startIndex = match.index ?? 0;
    const endIndex = startIndex + match[0].length;
    const startsAtKeywordBoundary = !isIdentifierContinuationChar(
      codePointBefore(matchableSql, startIndex),
    );
    const endsAtKeywordBoundary = !isIdentifierContinuationChar(
      codePointAt(matchableSql, endIndex),
    );
    if (startsAtKeywordBoundary && endsAtKeywordBoundary) count += 1;
  }

  return count;
}

function analyzeSqlConservatively(sql: string): SqlAnalysis {
  const analyses = [analyzeSql(sql, false), analyzeSql(sql, true)];
  return {
    concurrentIndexCount: Math.max(...analyses.map((analysis) => analysis.concurrentIndexCount)),
    executableStatementCount: Math.max(
      ...analyses.map((analysis) => analysis.executableStatementCount),
    ),
  };
}

function countConcurrentIndexes(sql: string): number {
  return analyzeSqlConservatively(sql).concurrentIndexCount;
}

function maskSqlCommentsAndLiterals(
  sql: string,
  backslashEscapesInStandardStrings: boolean,
): string {
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
        !isIdentifierContinuationChar(codePointBefore(sql, index - 1));
      const backslashEscapes =
        quote === "'" && (isEscapeString || backslashEscapesInStandardStrings);
      const doubledQuote = `${quote}${quote}`;
      let cursor = index + 1;
      while (cursor < sql.length) {
        if (backslashEscapes && sql[cursor] === '\\') {
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

    if (sql[index] === '$' && !isIdentifierContinuationChar(codePointBefore(sql, index))) {
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

function codePointAt(value: string, index: number): string | undefined {
  if (index < 0 || index >= value.length) return undefined;
  const codePoint = value.codePointAt(index);
  return codePoint === undefined ? undefined : String.fromCodePoint(codePoint);
}

function codePointBefore(value: string, index: number): string | undefined {
  if (index <= 0 || index > value.length) return undefined;
  const trailingCodeUnit = value.charCodeAt(index - 1);
  if (trailingCodeUnit >= 0xdc00 && trailingCodeUnit <= 0xdfff && index >= 2) {
    const leadingCodeUnit = value.charCodeAt(index - 2);
    if (leadingCodeUnit >= 0xd800 && leadingCodeUnit <= 0xdbff) {
      return value.slice(index - 2, index);
    }
  }
  return value[index - 1];
}

function isIdentifierContinuationChar(value: string | undefined): boolean {
  if (value === undefined) return false;
  const codePoint = value.codePointAt(0);
  return codePoint !== undefined && (codePoint >= 0x80 || /[A-Za-z0-9_$]/u.test(value));
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

test('concurrent index matcher honors PostgreSQL identifier boundaries', () => {
  assert.equal(
    countConcurrentIndexes(`
      CREATE INDEX CONCURRENTLY first$tag$ ON example (id);
      CREATE INDEX CONCURRENTLY second$tag$ ON example (name);
    `),
    2,
  );

  assert.equal(
    countConcurrentIndexes(`
      CREATE INDEX CONCURRENTLY first😀$tag$ ON example (id);
      CREATE INDEX CONCURRENTLY second😀$tag$ ON example (name);
    `),
    2,
  );

  assert.equal(
    countConcurrentIndexes(`
      CREATE INDEX concurrently$archive ON example (id);
      CREATE INDEX concurrently𐐀 ON example (name);
      CREATE INDEX concurrently😀 ON example (created_at);
      𐐀CREATE INDEX CONCURRENTLY archive_idx ON example (created_at);
      ANALYZE example;
    `),
    0,
  );
});

test('concurrent index matcher is conservative across standard string backslash modes', () => {
  const standardConformingSql = String.raw`
    SELECT 'C:\';
    CREATE INDEX CONCURRENTLY first_real_idx ON example (id);
    CREATE INDEX CONCURRENTLY second_real_idx ON example (name);
  `;
  assert.equal(analyzeSql(standardConformingSql, false).concurrentIndexCount, 2);
  assert.equal(countConcurrentIndexes(standardConformingSql), 2);

  const legacyBackslashSql = String.raw`
    SELECT 'it\'s still a string: CREATE INDEX CONCURRENTLY fake_escape_idx ON example (id)';
    CREATE INDEX CONCURRENTLY first_real_idx ON example (id);
    CREATE INDEX CONCURRENTLY second_real_idx ON example (name);
  `;
  assert.equal(analyzeSql(legacyBackslashSql, true).concurrentIndexCount, 2);
  assert.equal(countConcurrentIndexes(legacyBackslashSql), 2);
});

test('concurrent index migration must contain exactly one executable statement', () => {
  assert.deepEqual(analyzeSqlConservatively('CREATE INDEX CONCURRENTLY idx ON example (id);'), {
    concurrentIndexCount: 1,
    executableStatementCount: 1,
  });

  assert.equal(
    analyzeSqlConservatively(`
      CREATE INDEX CONCURRENTLY idx ON example (id);
      ANALYZE example;
    `).executableStatementCount,
    2,
  );
});

test('new migrations keep CREATE INDEX CONCURRENTLY isolated as a single statement', async () => {
  const migrations = await listMigrationSqlFiles();
  const violations: string[] = [];
  const historicalExceptionsSeen = new Set<string>();

  for (const migration of migrations) {
    const sql = await readFile(migration.sqlPath, 'utf8');
    const analysis = analyzeSqlConservatively(sql);
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
        analysis.concurrentIndexCount,
        2,
        `${migration.migrationName} must remain the exact historical two-index incident`,
      );
      continue;
    }

    if (analysis.concurrentIndexCount > 1) {
      violations.push(
        `${migration.migrationName}: ${analysis.concurrentIndexCount} concurrent indexes`,
      );
      continue;
    }

    if (analysis.concurrentIndexCount === 1 && analysis.executableStatementCount !== 1) {
      violations.push(
        `${migration.migrationName}: CREATE INDEX CONCURRENTLY must be the only executable SQL statement (${analysis.executableStatementCount} found)`,
      );
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
    `Keep each concurrent index in its own single-statement Prisma migration:\n${violations.join('\n')}`,
  );
});
