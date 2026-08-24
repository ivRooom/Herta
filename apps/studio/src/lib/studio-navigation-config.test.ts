import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseStoredStudioNavigationConfig,
  parseStudioNavigationPatch,
  resolveEffectiveStudioPluginTabIds,
  STUDIO_PINNABLE_SERVER_TABS,
  studioNavigationSettingsResource,
} from './studio-navigation-config.ts';

const GUILD_ID = '123456789012345678';

test('保存設定がない場合は個別Pluginタブを表示しない', () => {
  assert.deepEqual(parseStoredStudioNavigationConfig(null), { visiblePluginTabIds: [] });
  assert.deepEqual(parseStoredStudioNavigationConfig({}), { visiblePluginTabIds: [] });
});

test('保存済みPluginタブはcatalog順へ正規化し未知IDを無視する', () => {
  const config = parseStoredStudioNavigationConfig({
    untouched: true,
    studioNavigation: {
      visiblePluginTabIds: ['birthday', 'unknown', 'message-studio', 'birthday'],
    },
  });

  assert.deepEqual(config.visiblePluginTabIds, ['message-studio', 'birthday']);
});

test('更新payloadはallowlist内の一意なPluginタブだけ受理する', () => {
  assert.deepEqual(parseStudioNavigationPatch({ visiblePluginTabIds: ['birthday', 'lfg'] }), {
    ok: true,
    value: { visiblePluginTabIds: ['birthday', 'lfg'] },
  });

  assert.equal(parseStudioNavigationPatch({ visiblePluginTabIds: ['unknown'] }).ok, false);
  assert.equal(parseStudioNavigationPatch({ visiblePluginTabIds: ['birthday', 'birthday'] }).ok, false);
  assert.equal(parseStudioNavigationPatch({ visiblePluginTabIds: 'birthday' }).ok, false);
  assert.equal(parseStudioNavigationPatch({ visiblePluginTabIds: [], extra: true }).ok, false);
});

test('Pluginタブ件数はcatalog上限を超えられない', () => {
  const oversized = [
    ...STUDIO_PINNABLE_SERVER_TABS.map((tab) => tab.id),
    STUDIO_PINNABLE_SERVER_TABS[0]!.id,
  ];
  assert.equal(parseStudioNavigationPatch({ visiblePluginTabIds: oversized }).ok, false);
});

test('将来のロール表示制御はGuild設定とのintersectionとして適用できる', () => {
  assert.deepEqual(
    resolveEffectiveStudioPluginTabIds(
      ['message-studio', 'birthday', 'lfg'],
      ['birthday', 'team-split'],
    ),
    ['birthday'],
  );
  assert.deepEqual(resolveEffectiveStudioPluginTabIds(['birthday', 'lfg']), ['birthday', 'lfg']);
});

test('Studio Navigation設定resourceはGuild scopeを固定する', () => {
  assert.equal(studioNavigationSettingsResource(GUILD_ID), `guild:${GUILD_ID}:studio-navigation`);
});
