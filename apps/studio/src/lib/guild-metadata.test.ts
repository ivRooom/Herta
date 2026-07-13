import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGuildPersistenceData } from './guild-metadata.ts';
import type { ManageableGuild } from './discord.ts';

const baseGuild: ManageableGuild = {
  id: '123456789012345678',
  name: 'Test Guild',
  icon: null,
  iconUrl: null,
  owner: false,
  hasAdministrator: true,
  hasManageGuild: true,
};

test('管理権限者をGuild ownerとして推測保存しない', () => {
  const result = buildGuildPersistenceData(baseGuild, 'manager-user-id');

  assert.equal(result.create.ownerId, null);
  assert.equal('ownerId' in result.update, false);
});

test('owner本人が選択した場合だけowner IDを保存する', () => {
  const result = buildGuildPersistenceData({ ...baseGuild, owner: true }, 'owner-user-id');

  assert.equal(result.create.ownerId, 'owner-user-id');
  assert.equal(result.update.ownerId, 'owner-user-id');
});
