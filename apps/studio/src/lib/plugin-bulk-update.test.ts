import assert from 'node:assert/strict';
import test from 'node:test';

import { parsePluginBulkUpdateRequest } from './plugin-bulk-update.ts';

test('重複しないPluginの一括ON/OFFを受け入れる', () => {
  assert.deepEqual(
    parsePluginBulkUpdateRequest({
      updates: [
        { pluginId: 'achievements', enabled: true },
        { pluginId: 'birthday-role', enabled: false },
      ],
    }),
    {
      updates: [
        { pluginId: 'achievements', enabled: true },
        { pluginId: 'birthday-role', enabled: false },
      ],
    },
  );
});

test('空配列・重複Plugin・不正なPlugin IDを拒否する', () => {
  assert.equal(parsePluginBulkUpdateRequest({ updates: [] }), null);
  assert.equal(
    parsePluginBulkUpdateRequest({
      updates: [
        { pluginId: 'poll', enabled: true },
        { pluginId: 'poll', enabled: false },
      ],
    }),
    null,
  );
  assert.equal(
    parsePluginBulkUpdateRequest({ updates: [{ pluginId: '../poll', enabled: true }] }),
    null,
  );
});

test('enabledはbooleanのみ許可し100件を超える更新を拒否する', () => {
  assert.equal(
    parsePluginBulkUpdateRequest({ updates: [{ pluginId: 'poll', enabled: 'true' }] }),
    null,
  );
  assert.equal(
    parsePluginBulkUpdateRequest({
      updates: Array.from({ length: 101 }, (_, index) => ({
        pluginId: `plugin-${index}`,
        enabled: true,
      })),
    }),
    null,
  );
});
