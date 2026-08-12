import assert from 'node:assert/strict';
import test from 'node:test';

import { createPluginConfigAjv } from './plugin-config-ajv.ts';

test('x-herta-ui付きPlugin Schemaをstrict modeのままcompileできる', () => {
  const ajv = createPluginConfigAjv();
  const validate = ajv.compile({
    type: 'object',
    additionalProperties: false,
    properties: {
      enabled: {
        type: 'boolean',
        default: true,
        'x-herta-ui': { section: '基本設定' },
      },
      channelId: {
        type: ['string', 'null'],
        default: null,
        'x-herta-ui': { widget: 'discord-channel' },
      },
    },
    required: ['enabled', 'channelId'],
  });

  const config: Record<string, unknown> = {};
  assert.equal(validate(config), true);
  assert.deepEqual(config, { enabled: true, channelId: null });
});

test('x-herta-uiは値検証に影響せず不正なPlugin設定は拒否する', () => {
  const ajv = createPluginConfigAjv();
  const validate = ajv.compile({
    type: 'object',
    additionalProperties: false,
    properties: {
      cooldownSeconds: {
        type: 'integer',
        minimum: 10,
        maximum: 600,
        'x-herta-ui': { section: '自動処理' },
      },
    },
    required: ['cooldownSeconds'],
  });

  assert.equal(validate({ cooldownSeconds: 5 }), false);
  assert.equal(validate.errors?.[0]?.keyword, 'minimum');
});

test('未登録の独自Schema keywordは引き続きstrict modeで拒否する', () => {
  const ajv = createPluginConfigAjv();
  assert.throws(
    () => ajv.compile({ type: 'object', 'x-unknown-herta-keyword': true }),
    /strict mode: unknown keyword/,
  );
});
