import assert from 'node:assert/strict';
import test from 'node:test';
import type { ErrorObject } from 'ajv';
import { toPluginConfigValidationIssues } from './plugin-config-validation-issues.ts';

function error(
  keyword: string,
  instancePath: string,
  params: Record<string, unknown>,
  message?: string,
): ErrorObject {
  return {
    keyword,
    instancePath,
    schemaPath: '#',
    params,
    message,
  };
}

test('nested pathとarray indexをStudio field pathへ変換する', () => {
  assert.deepEqual(
    toPluginConfigValidationIssues([
      error('minLength', '/notification/email', { limit: 3 }),
      error('type', '/rules/2/retryCount', { type: 'integer' }),
    ]),
    [
      {
        path: 'notification.email',
        keyword: 'minLength',
        message: '3文字以上で入力してください',
      },
      {
        path: 'rules[2].retryCount',
        keyword: 'type',
        message: 'integer型で入力してください',
      },
    ],
  );
});

test('requiredはmissingPropertyをfield pathへ追加する', () => {
  assert.deepEqual(
    toPluginConfigValidationIssues([
      error(
        'required',
        '/notification',
        { missingProperty: 'email' },
        'must have required property',
      ),
    ]),
    [{ path: 'notification.email', keyword: 'required', message: '必須項目です' }],
  );
});

test('JSON Pointer escapeを復元する', () => {
  assert.deepEqual(
    toPluginConfigValidationIssues([
      error('type', '/properties/a~1b/~0meta', { type: 'string' }),
    ]),
    [
      {
        path: 'properties.a/b.~meta',
        keyword: 'type',
        message: 'string型で入力してください',
      },
    ],
  );
});

test('root errorは$ pathを返し未知keywordではAjv messageを保持する', () => {
  assert.deepEqual(
    toPluginConfigValidationIssues([
      error(
        'additionalProperties',
        '',
        { additionalProperty: 'unknown' },
        'must NOT have additional properties',
      ),
    ]),
    [
      {
        path: '$',
        keyword: 'additionalProperties',
        message: 'must NOT have additional properties',
      },
    ],
  );
});
