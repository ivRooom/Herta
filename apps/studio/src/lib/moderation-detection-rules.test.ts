import assert from 'node:assert/strict';
import test from 'node:test';
import {
  legacyRuleReference,
  listCurrentModerationWordRuleGroups,
  resolveModerationDetectionRuleSnapshots,
  type ModerationDetectionRuleHistoryClient,
} from './moderation-detection-rules.ts';

test('現在設定のNGワードを部分一致優先で一覧化する', () => {
  const groups = listCurrentModerationWordRuleGroups({
    autoContainsWords: ['bad', 'danger'],
    autoExactWords: ['exact'],
    autoRegexPatterns: ['^spam\\d+$'],
  });

  assert.deepEqual(
    groups.map((group) => [group.kind, group.values]),
    [
      ['word_contains', ['bad', 'danger']],
      ['word_exact', ['exact']],
      ['word_regex', ['^spam\\d+$']],
    ],
  );
});

test('検知時点より後の設定変更を使わず当時のNGワードを解決する', async () => {
  const client = {
    guildPluginConfigHistory: {
      async findMany() {
        return [
          {
            createdAt: new Date('2026-08-18T10:00:00.000Z'),
            config: { autoContainsWords: ['old-word', 'second'] },
          },
          {
            createdAt: new Date('2026-08-18T12:00:00.000Z'),
            config: { autoContainsWords: ['new-word'] },
          },
        ];
      },
    },
  } as unknown as ModerationDetectionRuleHistoryClient;

  const snapshots = await resolveModerationDetectionRuleSnapshots(client, '100', [
    {
      id: 'before-change',
      detectionKind: 'word_contains',
      ruleIndex: 0,
      occurredAt: new Date('2026-08-18T11:00:00.000Z'),
    },
    {
      id: 'after-change',
      detectionKind: 'word_contains',
      ruleIndex: 0,
      occurredAt: new Date('2026-08-18T13:00:00.000Z'),
    },
  ]);

  assert.equal(snapshots.get('before-change'), 'old-word');
  assert.equal(snapshots.get('after-change'), 'new-word');
});

test('削除でindexが詰まっても過去検知は当時の配列から解決する', async () => {
  const calls: unknown[] = [];
  const client = {
    guildPluginConfigHistory: {
      async findMany(args: unknown) {
        calls.push(args);
        return [
          {
            createdAt: new Date('2026-08-18T10:00:00.000Z'),
            config: { autoExactWords: ['a', 'removed', 'c'] },
          },
          {
            createdAt: new Date('2026-08-18T12:00:00.000Z'),
            config: { autoExactWords: ['a', 'c'] },
          },
        ];
      },
    },
  } as unknown as ModerationDetectionRuleHistoryClient;

  const snapshots = await resolveModerationDetectionRuleSnapshots(client, '100', [
    {
      id: 'legacy-detection',
      detectionKind: 'word_exact',
      ruleIndex: 1,
      occurredAt: new Date('2026-08-18T11:00:00.000Z'),
    },
  ]);

  assert.equal(snapshots.get('legacy-detection'), 'removed');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    where: {
      guildId: '100',
      pluginId: 'moderation',
      createdAt: { lte: new Date('2026-08-18T11:00:00.000Z') },
    },
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true, config: true },
  });
});

test('word以外・不正indexでは履歴queryを発行しない', async () => {
  let called = false;
  const client = {
    guildPluginConfigHistory: {
      async findMany() {
        called = true;
        return [];
      },
    },
  } as unknown as ModerationDetectionRuleHistoryClient;

  const snapshots = await resolveModerationDetectionRuleSnapshots(client, '100', [
    {
      id: 'invite',
      detectionKind: 'invite_link',
      ruleIndex: null,
      occurredAt: new Date(),
    },
    {
      id: 'invalid-index',
      detectionKind: 'word_contains',
      ruleIndex: -1,
      occurredAt: new Date(),
    },
  ]);

  assert.equal(called, false);
  assert.equal(snapshots.size, 0);
});

test('履歴から根拠を解決できない場合の旧Rule表示を1始まりにする', () => {
  assert.equal(legacyRuleReference(0), '旧履歴 · Rule #1');
  assert.equal(legacyRuleReference(3), '旧履歴 · Rule #4');
  assert.equal(legacyRuleReference(null), null);
});
