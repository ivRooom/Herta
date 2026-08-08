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
    name: { type: 'string', minLength: 3, maxLength: 12, pattern: '^[A-Za-z0-9_-]+$' },
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
        anyOf: [{ type: 'integer', minimum: 1 }, { type: 'string', minLength: 1 }],
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
