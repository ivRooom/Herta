import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addGuildConsoleCommandHistory,
  executeGuildConsoleCommand,
  getGuildConsoleCommandSuggestions,
  GUILD_CONSOLE_COMMAND_HISTORY_LIMIT,
  GUILD_CONSOLE_MAX_INPUT_LENGTH,
  stepGuildConsoleCommandHistory,
  type GuildConsoleContext,
} from './guild-console.ts';

const context: GuildConsoleContext = {
  guildId: '123456789012345678',
  guildName: 'Herta Lab',
  enabledPlugins: 6,
  totalPlugins: 8,
  commands7d: 120,
  failedCommands7d: 3,
  commandSuccessRate7d: 98,
  attentionCount: 5,
  openSuggestions: 1,
  failedReminders: 1,
};

test('helpは許可済みread-only commandだけを案内する', () => {
  const result = executeGuildConsoleCommand('help', context);

  assert.equal(result.type, 'output');
  if (result.type !== 'output') return;
  assert.match(result.lines.join('\n'), /status/);
  assert.match(result.lines.join('\n'), /open <target>/);
  assert.doesNotMatch(result.lines.join('\n'), /shell|sudo|exec/iu);
});

test('statusはGuildスコープの運用サマリーだけを返す', () => {
  const result = executeGuildConsoleCommand('  STATUS  ', context);

  assert.equal(result.type, 'output');
  if (result.type !== 'output') return;
  assert.equal(result.tone, 'error');
  assert.deepEqual(result.lines, [
    'guild: Herta Lab',
    'plugins: 6/8 enabled',
    'commands(7d): 120 total / 3 failed / 98% success',
    'attention: 5',
  ]);
});

test('attentionは要確認項目を内訳付きで返す', () => {
  const result = executeGuildConsoleCommand('attention', context);

  assert.equal(result.type, 'output');
  if (result.type !== 'output') return;
  assert.deepEqual(result.lines, [
    '要確認: 5件',
    '未処理Suggestion: 1件',
    '失敗Reminder: 1件',
    '失敗Command(7d): 3件',
  ]);
});

test('openはallowlistされたGuild管理画面だけへ遷移する', () => {
  const result = executeGuildConsoleCommand('open commands', context);

  assert.deepEqual(result, {
    type: 'navigate',
    href: '/dashboard/guilds/123456789012345678/commands',
    lines: ['opening commands...'],
  });
});

test('openの不正targetはpathとして採用しない', () => {
  const result = executeGuildConsoleCommand('open ../../account', context);

  assert.equal(result.type, 'output');
  if (result.type !== 'output') return;
  assert.equal(result.tone, 'error');
  assert.doesNotMatch(result.lines.join('\n'), /\.\.\//u);
});

test('openはObject prototype由来のtargetを許可しない', () => {
  for (const command of ['open constructor', 'open __proto__']) {
    const result = executeGuildConsoleCommand(command, context);
    assert.equal(result.type, 'output');
    if (result.type !== 'output') continue;
    assert.equal(result.tone, 'error');
  }
});

test('Guild IDはnavigation pathへ埋め込む前にencodeする', () => {
  const unsafeContext = { ...context, guildId: 'guild/../other' };
  const result = executeGuildConsoleCommand('open plugins', unsafeContext);

  assert.equal(result.type, 'navigate');
  if (result.type !== 'navigate') return;
  assert.equal(result.href, '/dashboard/guilds/guild%2F..%2Fother/plugins');
});

test('未知commandと長すぎる入力を安全に拒否する', () => {
  const unknown = executeGuildConsoleCommand('<script>alert(1)</script>', context);
  assert.equal(unknown.type, 'output');
  if (unknown.type === 'output') {
    assert.equal(unknown.tone, 'error');
    assert.doesNotMatch(unknown.lines.join('\n'), /<script>/u);
  }

  const tooLong = executeGuildConsoleCommand(
    'x'.repeat(GUILD_CONSOLE_MAX_INPUT_LENGTH + 1),
    context,
  );
  assert.equal(tooLong.type, 'output');
  if (tooLong.type === 'output') {
    assert.equal(tooLong.tone, 'error');
    assert.match(tooLong.lines[0] ?? '', /120文字以内/u);
  }
});

test('clearは履歴消去命令として解釈する', () => {
  assert.deepEqual(executeGuildConsoleCommand('clear', context), { type: 'clear' });
});

test('autocompleteはprefixを優先しopen targetも候補化する', () => {
  assert.deepEqual(
    getGuildConsoleCommandSuggestions('op').map((suggestion) => suggestion.command),
    ['open plugins', 'open commands', 'open moderation', 'open audit'],
  );
  assert.deepEqual(
    getGuildConsoleCommandSuggestions('open c').map((suggestion) => suggestion.command),
    ['open commands'],
  );
  assert.deepEqual(getGuildConsoleCommandSuggestions('open commands'), []);
});

test('autocompleteは空入力・過大入力・不正limitで候補を返さない', () => {
  assert.deepEqual(getGuildConsoleCommandSuggestions('   '), []);
  assert.deepEqual(
    getGuildConsoleCommandSuggestions('x'.repeat(GUILD_CONSOLE_MAX_INPUT_LENGTH + 1)),
    [],
  );
  assert.deepEqual(getGuildConsoleCommandSuggestions('o', 0), []);
});

test('command履歴は連続重複を除外して上限を維持する', () => {
  let history: string[] = [];
  history = addGuildConsoleCommandHistory(history, ' status ');
  history = addGuildConsoleCommandHistory(history, 'status');
  assert.deepEqual(history, ['status']);

  for (let index = 0; index < GUILD_CONSOLE_COMMAND_HISTORY_LIMIT + 3; index += 1) {
    history = addGuildConsoleCommandHistory(history, `open command-${index}`);
  }

  assert.equal(history.length, GUILD_CONSOLE_COMMAND_HISTORY_LIMIT);
  assert.equal(history.at(-1), `open command-${GUILD_CONSOLE_COMMAND_HISTORY_LIMIT + 2}`);
  assert.doesNotMatch(history[0] ?? '', /^status$/u);
});

test('ArrowUp/Down用履歴stepは端で安全に停止し最新入力へ戻れる', () => {
  const history = ['status', 'plugins', 'open audit'];

  const latest = stepGuildConsoleCommandHistory(history, null, 'older');
  assert.deepEqual(latest, { cursor: 2, value: 'open audit' });

  const older = stepGuildConsoleCommandHistory(history, latest.cursor, 'older');
  assert.deepEqual(older, { cursor: 1, value: 'plugins' });

  const first = stepGuildConsoleCommandHistory(history, 0, 'older');
  assert.deepEqual(first, { cursor: 0, value: 'status' });

  const newer = stepGuildConsoleCommandHistory(history, older.cursor, 'newer');
  assert.deepEqual(newer, { cursor: 2, value: 'open audit' });

  const cleared = stepGuildConsoleCommandHistory(history, newer.cursor, 'newer');
  assert.deepEqual(cleared, { cursor: null, value: '' });
  assert.deepEqual(stepGuildConsoleCommandHistory([], null, 'older'), { cursor: null, value: '' });
});
