import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatStudioValidationPath,
  validateConfigForStudio,
  type JsonSchema,
} from './plugin-config-studio.ts';

const validationSchema: JsonSchema = {
  type: 'object',
  required: ['name', 'retryCount', 'notification'],
  properties: {
    name: {
      type: 'string',
      minLength: 3,
      maxLength: 12,
      pattern: '^[A-Za-z0-9_-]+$',
    },
    retryCount: { type: 'integer', minimum: 0, maximum: 5 },
    mode: { type: 'string', enum: ['safe', 'fast'] },
    webhook: { type: ['string', 'null'], format: 'uri' },
    notification: {
      type: 'object',
      required: ['email'],
      properties: {
        email: { type: 'string', format: 'email' },
      },
    },
    tags: {
      type: 'array',
      items: { type: 'string', minLength: 2 },
    },
  },
};

test('required・型・範囲・文字列制約をpath付きで検証する', () => {
  const issues = validateConfigForStudio(validationSchema, {
    name: 'x!',
    retryCount: 8.5,
    mode: 'unsafe',
    notification: {},
    tags: ['ok', 'x'],
  });

  assert.deepEqual(
    issues.map((issue) => [formatStudioValidationPath(issue.path), issue.keyword]),
    [
      ['name', 'minLength'],
      ['name', 'pattern'],
      ['retryCount', 'type'],
      ['mode', 'enum'],
      ['notification.email', 'required'],
      ['tags[1]', 'minLength'],
    ],
  );
});

test('nullableとemail/url/date-time formatを検証する', () => {
  const schema: JsonSchema = {
    type: 'object',
    properties: {
      optionalUrl: { type: ['string', 'null'], format: 'url' },
      email: { type: 'string', format: 'email' },
      executedAt: { type: 'string', format: 'date-time' },
    },
  };

  assert.deepEqual(
    validateConfigForStudio(schema, {
      optionalUrl: null,
      email: 'admin@example.com',
      executedAt: '2026-08-09T08:30:00+09:00',
    }),
    [],
  );

  const issues = validateConfigForStudio(schema, {
    optionalUrl: 'not-a-url',
    email: 'invalid',
    executedAt: '2026/08/09',
  });
  assert.equal(issues.filter((issue) => issue.keyword === 'format').length, 3);
});

test('oneOfは1件だけ、anyOfはいずれか1件以上の一致を要求する', () => {
  const schema: JsonSchema = {
    type: 'object',
    properties: {
      selector: {
        oneOf: [
          { type: 'string', pattern: '^role:' },
          { type: 'string', pattern: '^channel:' },
        ],
      },
      target: {
        anyOf: [
          { type: 'integer', minimum: 1 },
          { type: 'string', minLength: 1 },
        ],
      },
    },
  };

  assert.deepEqual(
    validateConfigForStudio(schema, { selector: 'role:123', target: 'everyone' }),
    [],
  );

  const issues = validateConfigForStudio(schema, { selector: 'user:123', target: false });
  assert.deepEqual(
    issues.map((issue) => issue.keyword),
    ['oneOf', 'anyOf'],
  );
});

test('type配列はnull以外のunionもいずれかに一致すれば通過する', () => {
  const schema: JsonSchema = { type: ['string', 'integer'] };
  assert.deepEqual(validateConfigForStudio(schema, '42'), []);
  assert.deepEqual(validateConfigForStudio(schema, 42), []);
  assert.equal(validateConfigForStudio(schema, false)[0]?.keyword, 'type');
});

test('型未指定Schemaではnullを許可し、combinatorとenumはnullにも適用する', () => {
  assert.deepEqual(validateConfigForStudio({}, null), []);
  assert.deepEqual(
    validateConfigForStudio({ anyOf: [{ type: 'string' }, { type: 'null' }] }, null),
    [],
  );
  assert.deepEqual(
    validateConfigForStudio({ type: ['string', 'null'], enum: ['enabled'] }, null).map(
      (issue) => issue.keyword,
    ),
    ['enum'],
  );
});

test('object enumはproperty順に依存せず比較する', () => {
  const schema: JsonSchema = { enum: [{ a: 1, b: 2 }] };
  assert.deepEqual(validateConfigForStudio(schema, { b: 2, a: 1 }), []);
});

test('uriはhostを持たないabsolute URIを許可し、urlはhostを要求する', () => {
  assert.deepEqual(
    validateConfigForStudio({ type: 'string', format: 'uri' }, 'mailto:ops@example.com'),
    [],
  );
  assert.deepEqual(
    validateConfigForStudio({ type: 'string', format: 'uri' }, 'urn:isbn:0451450523'),
    [],
  );
  assert.equal(
    validateConfigForStudio({ type: 'string', format: 'url' }, 'mailto:ops@example.com')[0]
      ?.keyword,
    'format',
  );
});

test('dateとdate-timeは実在日付とRFC3339 timezoneを要求する', () => {
  assert.deepEqual(validateConfigForStudio({ type: 'string', format: 'date' }, '2024-02-29'), []);
  assert.equal(
    validateConfigForStudio({ type: 'string', format: 'date' }, '2025-02-30')[0]?.keyword,
    'format',
  );
  assert.equal(
    validateConfigForStudio({ type: 'string', format: 'date-time' }, '2025-02-30T00:00:00Z')[0]
      ?.keyword,
    'format',
  );
  assert.equal(
    validateConfigForStudio({ type: 'string', format: 'date-time' }, '2025-02-28T00:00:00')[0]
      ?.keyword,
    'format',
  );
});

test('正常なnested configはエラーなしで通過する', () => {
  assert.deepEqual(
    validateConfigForStudio(validationSchema, {
      name: 'Herta_01',
      retryCount: 3,
      mode: 'safe',
      webhook: 'https://example.com/hooks/herta',
      notification: { email: 'ops@example.com' },
      tags: ['ops', 'bot'],
    }),
    [],
  );
});
