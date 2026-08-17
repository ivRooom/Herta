import assert from 'node:assert/strict';
import test from 'node:test';
import {
  filterAndSortRoleInventory,
  paginateRoleInventory,
  summarizeRoleInventory,
  type RoleInventoryRole,
} from './role-access-inventory.ts';

const ROOT_ROLE_ID = '1069969919271252018';
const roles: RoleInventoryRole[] = [
  role(ROOT_ROLE_ID, 'OWNER', 100),
  role('200000000000000001', 'Moderator', 80),
  role('200000000000000002', 'Member', 20),
  { ...role('200000000000000003', 'Integration Bot', 60), managed: true },
  role('200000000000000004', 'Guest', 10),
];
const configuredRoleIds = new Set(['200000000000000001', '200000000000000004']);

test('Role Inventory summaryはrootを未設定Roleへ含めない', () => {
  assert.deepEqual(summarizeRoleInventory(roles, configuredRoleIds, ROOT_ROLE_ID), {
    total: 5,
    configured: 2,
    unconfigured: 2,
    managed: 1,
    root: 1,
  });
});

test('Role名とDiscord Role IDの両方で検索できる', () => {
  const byName = filterAndSortRoleInventory(roles, {
    query: 'moder',
    filter: 'all',
    sort: 'hierarchy',
    configuredRoleIds,
    rootRoleId: ROOT_ROLE_ID,
  });
  assert.deepEqual(
    byName.map((item) => item.name),
    ['Moderator'],
  );

  const byId = filterAndSortRoleInventory(roles, {
    query: '000000000000004',
    filter: 'all',
    sort: 'hierarchy',
    configuredRoleIds,
    rootRoleId: ROOT_ROLE_ID,
  });
  assert.deepEqual(
    byId.map((item) => item.name),
    ['Guest'],
  );
});

test('未設定filterはrootとPolicy設定済みRoleを除外する', () => {
  const result = filterAndSortRoleInventory(roles, {
    query: '',
    filter: 'unconfigured',
    sort: 'hierarchy',
    configuredRoleIds,
    rootRoleId: ROOT_ROLE_ID,
  });
  assert.deepEqual(
    result.map((item) => item.name),
    ['Integration Bot', 'Member'],
  );
});

test('Policy順はroot、設定済み、未設定の順に並べる', () => {
  const result = filterAndSortRoleInventory(roles, {
    query: '',
    filter: 'all',
    sort: 'policy',
    configuredRoleIds,
    rootRoleId: ROOT_ROLE_ID,
  });
  assert.deepEqual(
    result.map((item) => item.name),
    ['OWNER', 'Moderator', 'Guest', 'Integration Bot', 'Member'],
  );
});

test('Role hierarchy順はposition降順を維持する', () => {
  const result = filterAndSortRoleInventory(roles, {
    query: '',
    filter: 'all',
    sort: 'hierarchy',
    configuredRoleIds,
    rootRoleId: ROOT_ROLE_ID,
  });
  assert.deepEqual(
    result.map((item) => item.position),
    [100, 80, 60, 20, 10],
  );
});

test('ページングは範囲外pageを最終pageへclampする', () => {
  const result = paginateRoleInventory(roles, 99, 2);
  assert.equal(result.page, 3);
  assert.equal(result.pageCount, 3);
  assert.equal(result.from, 5);
  assert.equal(result.to, 5);
  assert.deepEqual(
    result.items.map((item) => item.name),
    ['Guest'],
  );
});

function role(id: string, name: string, position: number): RoleInventoryRole {
  return {
    id,
    name,
    color: '#5865F2',
    position,
    managed: false,
    mentionable: false,
    editable: true,
  };
}
