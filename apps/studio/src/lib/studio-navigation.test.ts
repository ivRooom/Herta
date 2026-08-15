import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeDashboardCallbackUrl } from './auth-navigation.ts';
import { buildStudioCommandItems, filterStudioCommandItems } from './studio-navigation.ts';

const GUILD_ID = '123456789012345678';

test('Guild外ではWorkspaceコマンドだけを生成する', () => {
  const commands = buildStudioCommandItems(null, null);

  assert.ok(commands.length > 0);
  assert.ok(commands.every((command) => command.group === 'workspace'));
  assert.ok(commands.some((command) => command.href === '/dashboard/guilds'));
  assert.ok(
    commands.some((command) => command.id === 'account' && command.href === '/dashboard/account'),
  );
});

test('不正なGuild IDではGuild固有コマンドを生成しない', () => {
  for (const guildId of ['123', 'not-a-guild', '12345678901234567/path']) {
    const commands = buildStudioCommandItems(guildId, 'Invalid Guild');
    assert.ok(commands.every((command) => command.group === 'workspace'));
  }
});

test('現在Guildがある場合はGuild固有コマンドを安全なhrefで生成する', () => {
  const commands = buildStudioCommandItems(GUILD_ID, 'Test Guild');

  assert.ok(
    commands.some(
      (command) =>
        command.id === 'guild-activity-rules-diagnostics' &&
        command.href === `/dashboard/guilds/${GUILD_ID}/activity-rules/diagnostics`,
    ),
  );
  assert.ok(
    commands.some(
      (command) =>
        command.id === 'guild-xp-operations' &&
        command.href === `/dashboard/guilds/${GUILD_ID}/leaderboard/admin`,
    ),
  );
  assert.ok(
    commands.some(
      (command) =>
        command.id === 'guild-moderation-blacklist' &&
        command.href === `/dashboard/guilds/${GUILD_ID}/moderation/blacklist`,
    ),
  );
  assert.ok(
    commands.some(
      (command) => command.id === 'guild-overview' && command.description.includes('Test Guild'),
    ),
  );
});

test('日本語・英語キーワードでコマンドを検索できる', () => {
  const commands = buildStudioCommandItems(GUILD_ID, 'Test Guild');

  assert.deepEqual(
    filterStudioCommandItems(commands, '監査').map((command) => command.id),
    ['guild-audit-logs'],
  );
  assert.ok(
    filterStudioCommandItems(commands, 'activity rules').some(
      (command) => command.id === 'guild-activity-rules-diagnostics',
    ),
  );
  assert.ok(
    filterStudioCommandItems(commands, 'xp operations').some(
      (command) => command.id === 'guild-xp-operations',
    ),
  );
  assert.ok(
    filterStudioCommandItems(commands, 'profile settings').some(
      (command) => command.id === 'account',
    ),
  );
});

test('検索は大文字小文字と全角英数字を正規化する', () => {
  const commands = buildStudioCommandItems(GUILD_ID, 'Test Guild');

  assert.ok(
    filterStudioCommandItems(commands, 'ＬＥＡＤＥＲＢＯＡＲＤ').some(
      (command) => command.id === 'guild-leaderboard',
    ),
  );
  assert.ok(
    filterStudioCommandItems(commands, 'CUSTOM PLUGIN').some(
      (command) => command.id === 'custom-plugins',
    ),
  );
});

test('複数トークンはすべて一致するコマンドだけを返す', () => {
  const commands = buildStudioCommandItems(GUILD_ID, 'Test Guild');
  const results = filterStudioCommandItems(commands, 'moderation blacklist');

  assert.deepEqual(
    results.map((command) => command.id),
    ['guild-moderation-blacklist'],
  );
});

test('空検索では登録順を維持する', () => {
  const commands = buildStudioCommandItems(GUILD_ID, 'Test Guild');

  assert.deepEqual(filterStudioCommandItems(commands, '   '), commands);
});

test('OAuth callbackUrlはDashboard配下の相対URLだけを許可する', () => {
  assert.equal(normalizeDashboardCallbackUrl('/dashboard'), '/dashboard');
  assert.equal(
    normalizeDashboardCallbackUrl('/dashboard/account?from=login#security'),
    '/dashboard/account?from=login#security',
  );
  assert.equal(normalizeDashboardCallbackUrl(' /dashboard/guilds '), '/dashboard/guilds');
});

test('OAuth callbackUrlの外部URLと不正値はDashboardへフォールバックする', () => {
  for (const callbackUrl of [
    'https://example.com',
    '//example.com/dashboard',
    '/\\example.com/dashboard',
    '/login',
    '/dashboard-evil',
    '',
    null,
    undefined,
  ]) {
    assert.equal(normalizeDashboardCallbackUrl(callbackUrl), '/dashboard');
  }
});
