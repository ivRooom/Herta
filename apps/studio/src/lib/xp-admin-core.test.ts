import assert from 'node:assert/strict';
import test from 'node:test';
import {
  nextXpAfterAdminAction,
  parseXpAdminRequest,
  xpAdminLevelForXp,
} from './xp-admin-core.ts';

test('XP add/subtract/setを正規化する', () => {
  assert.deepEqual(parseXpAdminRequest({ action: 'add', userId: '123456', amount: 500 }, '999'), {
    action: 'add',
    userId: '123456',
    amount: 500,
    reason: null,
    confirmation: null,
  });
  assert.deepEqual(
    parseXpAdminRequest({ action: 'subtract', userId: '123456', amount: '250' }, '999'),
    {
      action: 'subtract',
      userId: '123456',
      amount: 250,
      reason: null,
      confirmation: null,
    },
  );
  assert.deepEqual(parseXpAdminRequest({ action: 'set', userId: '123456', amount: 0 }, '999'), {
    action: 'set',
    userId: '123456',
    amount: 0,
    reason: null,
    confirmation: null,
  });
});

test('XP操作は不正ID・空値・負数・過大値を拒否する', () => {
  assert.equal(parseXpAdminRequest({ action: 'add', userId: 'abc', amount: 100 }, '999'), null);
  assert.equal(parseXpAdminRequest({ action: 'set', userId: '123456', amount: '' }, '999'), null);
  assert.equal(parseXpAdminRequest({ action: 'add', userId: '123456', amount: -1 }, '999'), null);
  assert.equal(
    parseXpAdminRequest({ action: 'set', userId: '123456', amount: 100_000_001 }, '999'),
    null,
  );
});

test('個人resetはamount不要で受け入れる', () => {
  assert.deepEqual(
    parseXpAdminRequest({ action: 'reset_user', userId: '123456', reason: '誤付与修正' }, '999'),
    {
      action: 'reset_user',
      userId: '123456',
      amount: null,
      reason: '誤付与修正',
      confirmation: null,
    },
  );
});

test('Guild全体resetは理由と確認文字列の完全一致を要求する', () => {
  assert.equal(
    parseXpAdminRequest(
      { action: 'reset_guild', reason: 'Season reset', confirmation: 'RESET wrong' },
      '999',
    ),
    null,
  );
  assert.deepEqual(
    parseXpAdminRequest(
      { action: 'reset_guild', reason: 'Season reset', confirmation: 'RESET 999' },
      '999',
    ),
    {
      action: 'reset_guild',
      userId: null,
      amount: null,
      reason: 'Season reset',
      confirmation: 'RESET 999',
    },
  );
});

test('subtractは0未満にせずset/addは上限内で計算する', () => {
  assert.equal(nextXpAfterAdminAction(100, 'subtract', 250), 0);
  assert.equal(nextXpAfterAdminAction(100, 'add', 250), 350);
  assert.equal(nextXpAfterAdminAction(100, 'set', 900), 900);
});

test('XPからLevelを既存式と同じルールで算出する', () => {
  assert.equal(xpAdminLevelForXp(0), 0);
  assert.equal(xpAdminLevelForXp(100), 1);
  assert.equal(xpAdminLevelForXp(900), 3);
});
