import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeDashboardCallbackUrl } from './auth-navigation.ts';
import {
  buildStudioCommandItems,
  filterStudioCommandItems,
  STUDIO_COMMAND_SEARCH_QUERY_MAX_LENGTH,
  STUDIO_COMMAND_SEARCH_RESULT_LIMIT,
  type StudioCommandItem,
} from './studio-navigation.ts';

const GUILD_ID = '123456789012345678';

test('Guild外ではWorkspaceコマンドだけを生成する', () => {
  const commands = buildStudioCommandItems(null, null);

  assert.ok(commands.length > 0);
  assert.ok(commands.every((command) => command.group === 'workspace'));
  assert.ok(commands.some((command) => command.href === '/dashboard/guilds'));
  assert.ok(
    commands.some((command) => command.id === 'plugins' && command.href === '/dashboard/plugins'),
  );
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
  assert.ok(
    commands.some(
      (command) =>
        command.id === 'guild-daily-content' &&
        command.group === 'current-server' &&
        command.label === 'Message Studio' &&
        command.href === `/dashboard/guilds/${GUILD_ID}/daily-content`,
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
    filterStudioCommandItems(commands, 'Bot発言 予約投稿').some(
      (command) => command.id === 'guild-daily-content',
    ),
  );
  assert.ok(
    filterStudioCommandItems(commands, 'プラグイン 管理').some(
      (command) => command.id === 'plugins' && command.href === '/dashboard/plugins',
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

test('exact lexical一致をintent一致より優先する', () => {
  const commands = buildStudioCommandItems(GUILD_ID, 'Test Guild');
  const results = filterStudioCommandItems(commands, 'moderation');

  assert.equal(results[0]?.id, 'guild-moderation');
});

test('自然文intentからMessage Studioへ到達できる', () => {
  const commands = buildStudioCommandItems(GUILD_ID, 'Test Guild');

  assert.equal(filterStudioCommandItems(commands, 'Botで予約投稿したい')[0]?.id, 'guild-daily-content');
  assert.equal(filterStudioCommandItems(commands, '定期的に投稿したい')[0]?.id, 'guild-daily-content');
});

test('自然文intentから監査ログとModeration Enforcementへ到達できる', () => {
  const commands = buildStudioCommandItems(GUILD_ID, 'Test Guild');

  assert.equal(
    filterStudioCommandItems(commands, '誰が設定を変更したか確認したい')[0]?.id,
    'guild-audit-logs',
  );
  assert.equal(
    filterStudioCommandItems(commands, 'サーバーの危険な設定を確認したい')[0]?.id,
    'guild-moderation-enforcement',
  );
});

test('Guild固有intentはGuild未選択時の検索結果へ漏らさない', () => {
  const commands = buildStudioCommandItems(null, null);

  assert.deepEqual(filterStudioCommandItems(commands, 'Botで予約投稿したい'), []);
  assert.deepEqual(filterStudioCommandItems(commands, '誰が設定を変更したか確認したい'), []);
});

test('intent metadataへGuild名や動的ユーザーデータを混入しない', () => {
  const commands = buildStudioCommandItems(GUILD_ID, 'Sensitive Guild Name');

  assert.ok(
    commands.every((command) =>
      (command.intents ?? []).every((intent) => !intent.includes('Sensitive Guild Name')),
    ),
  );
});

test('検索queryは上限内へ制限し、結果件数も固定上限を超えない', () => {
  assert.equal(STUDIO_COMMAND_SEARCH_QUERY_MAX_LENGTH, 100);
  assert.equal(STUDIO_COMMAND_SEARCH_RESULT_LIMIT, 20);

  const commands: StudioCommandItem[] = Array.from({ length: 30 }, (_, index) => ({
    id: `command-${index}`,
    href: `/dashboard/command-${index}`,
    label: `Command ${index}`,
    description: 'Common command',
    keywords: ['common'],
    icon: 'dashboard',
    group: 'workspace',
  }));
  const oversizedQuery = `common${' '.repeat(STUDIO_COMMAND_SEARCH_QUERY_MAX_LENGTH * 4)}`;
  const results = filterStudioCommandItems(commands, oversizedQuery);

  assert.equal(results.length, STUDIO_COMMAND_SEARCH_RESULT_LIMIT);
  assert.deepEqual(
    results.map((command) => command.id),
    Array.from({ length: STUDIO_COMMAND_SEARCH_RESULT_LIMIT }, (_, index) => `command-${index}`),
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
