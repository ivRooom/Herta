import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCommandPaletteSections,
  COMMAND_PALETTE_MAX_FAVORITES,
  COMMAND_PALETTE_MAX_RECENT,
  createDefaultCommandPalettePreferences,
  parseCommandPalettePreferences,
  recordRecentCommand,
  serializeCommandPalettePreferences,
  toggleFavoriteCommand,
} from './command-palette-preferences.ts';
import { buildStudioCommandItems, filterStudioCommandItems } from './studio-navigation.ts';

const GUILD_ID = '123456789012345678';

test('壊れた保存データや未知versionは安全に初期化する', () => {
  assert.deepEqual(
    parseCommandPalettePreferences('{broken'),
    createDefaultCommandPalettePreferences(),
  );
  assert.deepEqual(
    parseCommandPalettePreferences(JSON.stringify({ version: 2, favoriteIds: ['dashboard'] })),
    createDefaultCommandPalettePreferences(),
  );
});

test('保存データは安全なCommand IDだけに正規化して件数を制限する', () => {
  const favoriteIds = [
    'dashboard',
    'dashboard',
    '../unsafe',
    ...Array.from({ length: 20 }, (_, index) => `favorite-${index}`),
  ];
  const recentIds = Array.from({ length: 20 }, (_, index) => `recent-${index}`);
  const parsed = parseCommandPalettePreferences(
    JSON.stringify({ version: 1, favoriteIds, recentIds }),
  );

  assert.equal(parsed.favoriteIds[0], 'dashboard');
  assert.equal(parsed.favoriteIds.includes('../unsafe'), false);
  assert.equal(new Set(parsed.favoriteIds).size, parsed.favoriteIds.length);
  assert.equal(parsed.favoriteIds.length, COMMAND_PALETTE_MAX_FAVORITES);
  assert.equal(parsed.recentIds.length, COMMAND_PALETTE_MAX_RECENT);
  assert.deepEqual(parseCommandPalettePreferences(serializeCommandPalettePreferences(parsed)), parsed);
});

test('お気に入りは追加・解除でき上限を維持する', () => {
  let preferences = createDefaultCommandPalettePreferences();
  preferences = toggleFavoriteCommand(preferences, 'dashboard');
  assert.deepEqual(preferences.favoriteIds, ['dashboard']);

  preferences = toggleFavoriteCommand(preferences, 'dashboard');
  assert.deepEqual(preferences.favoriteIds, []);

  for (let index = 0; index < COMMAND_PALETTE_MAX_FAVORITES + 3; index += 1) {
    preferences = toggleFavoriteCommand(preferences, `favorite-${index}`);
  }
  assert.equal(preferences.favoriteIds.length, COMMAND_PALETTE_MAX_FAVORITES);
  assert.equal(preferences.favoriteIds[0], `favorite-${COMMAND_PALETTE_MAX_FAVORITES + 2}`);
});

test('最近使った項目は再利用したCommandを先頭へ移動して上限を維持する', () => {
  let preferences = createDefaultCommandPalettePreferences();
  for (let index = 0; index < COMMAND_PALETTE_MAX_RECENT + 2; index += 1) {
    preferences = recordRecentCommand(preferences, `recent-${index}`);
  }

  assert.equal(preferences.recentIds.length, COMMAND_PALETTE_MAX_RECENT);
  preferences = recordRecentCommand(preferences, 'recent-3');
  assert.equal(preferences.recentIds[0], 'recent-3');
  assert.equal(preferences.recentIds.filter((id) => id === 'recent-3').length, 1);
});

test('空検索ではお気に入り・最近使った項目を先頭にし重複表示しない', () => {
  const commands = buildStudioCommandItems(GUILD_ID, 'Test Guild');
  const preferences = {
    version: 1 as const,
    favoriteIds: ['guild-birthday'],
    recentIds: ['guild-birthday', 'guild-audit-logs'],
  };
  const sections = buildCommandPaletteSections(commands, preferences, true);
  const visibleIds = sections.flatMap((section) => section.commands.map((command) => command.id));

  assert.equal(sections[0]?.id, 'favorites');
  assert.deepEqual(
    sections[0]?.commands.map((command) => command.id),
    ['guild-birthday'],
  );
  assert.equal(sections[1]?.id, 'recent');
  assert.deepEqual(
    sections[1]?.commands.map((command) => command.id),
    ['guild-audit-logs'],
  );
  assert.equal(new Set(visibleIds).size, visibleIds.length);
  assert.deepEqual([...visibleIds].sort(), commands.map((command) => command.id).sort());
});

test('現在Contextに存在しない保存IDは表示せず検索中は通常Group順へ戻す', () => {
  const commands = buildStudioCommandItems(GUILD_ID, 'Test Guild');
  const preferences = {
    version: 1 as const,
    favoriteIds: ['unknown-command', 'guild-birthday'],
    recentIds: ['another-unknown', 'guild-audit-logs'],
  };
  const quickSections = buildCommandPaletteSections(commands, preferences, true);
  const quickIds = quickSections.flatMap((section) => section.commands.map((command) => command.id));
  assert.equal(quickIds.includes('unknown-command'), false);
  assert.equal(quickIds.includes('another-unknown'), false);

  const searchResults = filterStudioCommandItems(commands, 'birthday');
  const searchSections = buildCommandPaletteSections(searchResults, preferences, false);
  assert.equal(searchSections.some((section) => section.id === 'favorites'), false);
  assert.equal(searchSections.some((section) => section.id === 'recent'), false);
  assert.deepEqual(
    searchSections.flatMap((section) => section.commands.map((command) => command.id)),
    ['guild-birthday'],
  );
});
