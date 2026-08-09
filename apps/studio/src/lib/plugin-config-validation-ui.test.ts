import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mergeValidationIssues,
  readApiValidationIssues,
  validateStudioDraft,
  validationIssueCountUnderPath,
  validationIssuesAtPath,
} from './plugin-config-validation-ui.ts';
import type { JsonSchema } from './plugin-config-studio.ts';

const schema: JsonSchema = {
  type: 'object',
  required: ['name', 'rules'],
  properties: {
    name: { type: 'string', minLength: 3 },
    rules: {
      type: 'array',
      items: {
        type: 'object',
        required: ['retryCount'],
        properties: {
          retryCount: { type: 'integer', minimum: 1 },
        },
      },
    },
  },
};

test('visual draftをfield path付きissueへ変換する', () => {
  const result = validateStudioDraft(
    schema,
    'visual',
    {
      name: 'x',
      rules: [{ retryCount: 0 }],
    },
    '',
  );

  assert.equal(result.jsonError, null);
  assert.deepEqual(
    result.issues.map((issue) => [issue.path, issue.keyword]),
    [
      ['name', 'minLength'],
      ['rules[0].retryCount', 'minimum'],
    ],
  );
});

test('Advanced JSONのsyntax errorは保存可能なconfigを返さない', () => {
  const result = validateStudioDraft(schema, 'json', { name: 'valid', rules: [] }, '{');

  assert.equal(result.config, null);
  assert.equal(result.issues.length, 0);
  assert.match(result.jsonError ?? '', /JSON/u);
});

test('Advanced JSONもvisualと同じschema validationを通す', () => {
  const result = validateStudioDraft(
    schema,
    'json',
    {},
    JSON.stringify({ name: 'ok', rules: [{ retryCount: 0 }] }),
  );

  assert.equal(result.jsonError, null);
  assert.deepEqual(
    result.issues.map((issue) => issue.path),
    ['name', 'rules[0].retryCount'],
  );
});

test('API issuesは不正要素を無視してserver issueへ変換する', () => {
  assert.deepEqual(
    readApiValidationIssues({
      issues: [
        { path: 'rules[2].retryCount', keyword: 'minimum', message: '1以上で入力してください' },
        { path: 123, keyword: 'type', message: 'invalid' },
      ],
    }),
    [
      {
        path: 'rules[2].retryCount',
        keyword: 'minimum',
        message: '1以上で入力してください',
        source: 'server',
      },
    ],
  );
});

test('client/serverの同一issueを重複表示しない', () => {
  const clientIssue = {
    path: 'name',
    keyword: 'minLength',
    message: '3文字以上で入力してください',
    source: 'client' as const,
  };
  const serverIssue = { ...clientIssue, source: 'server' as const };

  assert.deepEqual(mergeValidationIssues([clientIssue], [serverIssue]), [clientIssue]);
});

test('field path単位の抽出とnested issue件数を返す', () => {
  const issues = [
    { path: 'rules', keyword: 'type', message: 'array', source: 'client' as const },
    {
      path: 'rules[0].retryCount',
      keyword: 'minimum',
      message: 'minimum',
      source: 'client' as const,
    },
    { path: 'name', keyword: 'minLength', message: 'name', source: 'client' as const },
  ];

  assert.equal(validationIssuesAtPath(issues, 'rules').length, 1);
  assert.equal(validationIssueCountUnderPath(issues, 'rules'), 2);
  assert.equal(validationIssueCountUnderPath(issues, 'name'), 1);
});
