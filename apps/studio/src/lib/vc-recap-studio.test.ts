import assert from 'node:assert/strict';
import test from 'node:test';
import type { VcRecapSessionSummary } from '@herta/db';
import {
  formatVcRecapDuration,
  groupVcRecapSessionsByDay,
  parseVcRecapQuery,
  toVcRecapSessionDisplay,
  toVcRecapTranscriptEntries,
  vcRecapTranscriptExpiresAt,
} from './vc-recap-studio.ts';
import type { GuildMemberOption } from './bot-guild-members.ts';

function session(overrides: Partial<VcRecapSessionSummary> = {}): VcRecapSessionSummary {
  return {
    id: 'session-1',
    guildId: 'guild-1',
    channelId: '111111111111111111',
    startedBy: 'user-1',
    status: 'completed',
    consentingUserIds: ['user-1'],
    nonConsentingUserIds: ['user-2'],
    summary: 'テストの要約です',
    topics: ['ゲーム', '雑談'],
    startedAt: new Date('2026-07-01T00:00:00.000Z'),
    endedAt: new Date('2026-07-01T01:00:00.000Z'),
    ...overrides,
  };
}

function member(overrides: Partial<GuildMemberOption> = {}): GuildMemberOption {
  return {
    id: 'user-1',
    username: 'alice',
    displayName: 'Alice',
    avatarUrl: 'https://example.com/avatar.png',
    bot: false,
    roleIds: [],
    ...overrides,
  };
}

test('VC Recap検索条件を正規化する', () => {
  const query = parseVcRecapQuery(
    new URLSearchParams({
      page: '2',
      pageSize: '500',
      channelId: '111111111111111111',
    }),
  );

  assert.equal(query.page, 2);
  assert.equal(query.pageSize, 50);
  assert.equal(query.channelId, '111111111111111111');
});

test('不正な検索条件を安全な既定値へ戻す', () => {
  const query = parseVcRecapQuery(
    new URLSearchParams({
      page: '-1',
      pageSize: '0',
      channelId: 'not-a-snowflake',
    }),
  );

  assert.equal(query.page, 1);
  assert.equal(query.pageSize, 20);
  assert.equal(query.channelId, '');
});

test('channelId未指定時は既定でページサイズ20・空文字(すべてのVC)になる', () => {
  const query = parseVcRecapQuery(new URLSearchParams());

  assert.equal(query.page, 1);
  assert.equal(query.pageSize, 20);
  assert.equal(query.channelId, '');
});

test('メンバー・チャンネル名を解決してdisplayへ変換する', () => {
  const memberDisplays = new Map([
    ['user-1', member({ id: 'user-1', displayName: 'Alice' })],
    ['user-2', member({ id: 'user-2', displayName: 'Bob' })],
  ]);
  const channelNames = new Map([['111111111111111111', '雑談VC']]);

  const display = toVcRecapSessionDisplay(session(), memberDisplays, channelNames);

  assert.equal(display.channelName, '雑談VC');
  assert.deepEqual(display.consentingParticipants, [
    { id: 'user-1', displayName: 'Alice', avatarUrl: 'https://example.com/avatar.png' },
  ]);
  assert.deepEqual(display.nonConsentingParticipants, [
    { id: 'user-2', displayName: 'Bob', avatarUrl: 'https://example.com/avatar.png' },
  ]);
  assert.equal(display.summary, 'テストの要約です');
  assert.deepEqual(display.topics, ['ゲーム', '雑談']);
});

test('Bot未稼働等でメンバー・チャンネル名が解決できない場合は生IDへフォールバックする', () => {
  const display = toVcRecapSessionDisplay(session(), new Map(), new Map());

  assert.equal(display.channelName, '#111111111111111111');
  assert.deepEqual(display.consentingParticipants, [
    { id: 'user-1', displayName: 'Unknown User (user-1)', avatarUrl: null },
  ]);
  assert.deepEqual(display.nonConsentingParticipants, [
    { id: 'user-2', displayName: 'Unknown User (user-2)', avatarUrl: null },
  ]);
});

test('参加者が空のセッションは空配列を返す', () => {
  const display = toVcRecapSessionDisplay(
    session({ consentingUserIds: [], nonConsentingUserIds: [] }),
    new Map(),
    new Map(),
  );

  assert.deepEqual(display.consentingParticipants, []);
  assert.deepEqual(display.nonConsentingParticipants, []);
});

test('セッションを並び順を保ったままJSTの日付ごとにまとめる', () => {
  const toDisplay = (id: string, startedAt: string) =>
    toVcRecapSessionDisplay(session({ id, startedAt: new Date(startedAt) }), new Map(), new Map());
  // 2026-07-02 00:30 JST / 2026-07-01 23:30 JST / 2026-07-01 09:00 JST
  const days = groupVcRecapSessionsByDay([
    toDisplay('a', '2026-07-01T15:30:00.000Z'),
    toDisplay('b', '2026-07-01T14:30:00.000Z'),
    toDisplay('c', '2026-07-01T00:00:00.000Z'),
  ]);

  assert.deepEqual(
    days.map((day) => [day.dateKey, day.items.map((item) => item.id)]),
    [
      ['2026-07-02', ['a']],
      ['2026-07-01', ['b', 'c']],
    ],
  );
});

test('経過時間を時間・分で表し、未終了ならnullを返す', () => {
  const start = new Date('2026-07-01T00:00:00.000Z');
  const after = (ms: number) => new Date(start.getTime() + ms);

  assert.equal(formatVcRecapDuration(start, null), null);
  assert.equal(formatVcRecapDuration(start, after(20_000)), '1分未満');
  assert.equal(formatVcRecapDuration(start, after(5 * 60_000)), '5分');
  assert.equal(formatVcRecapDuration(start, after(60 * 60_000)), '1時間');
  assert.equal(formatVcRecapDuration(start, after(65 * 60_000)), '1時間5分');
});

test('文字起こしを発言順のまま発言者名つきの行へ変換し、未解決の発言者は生IDで表す', () => {
  const entries = toVcRecapTranscriptEntries(
    [
      {
        id: 'segment-1',
        userId: 'user-1',
        text: 'こんにちは',
        startedAt: new Date('2026-07-01T00:00:01.000Z'),
        endedAt: new Date('2026-07-01T00:00:02.000Z'),
      },
      {
        userId: 'user-9',
        text: 'よろしく',
        startedAt: new Date('2026-07-01T00:00:03.000Z'),
        endedAt: new Date('2026-07-01T00:00:04.000Z'),
      },
    ],
    new Map([['user-1', member()]]),
  );

  assert.deepEqual(entries.map((entry) => entry.segmentId), ['segment-1', null]);
  assert.deepEqual(
    entries.map((entry) => [entry.speaker.displayName, entry.text]),
    [
      ['Alice', 'こんにちは'],
      ['Unknown User (user-9)', 'よろしく'],
    ],
  );
});

test('文字起こしの削除予定日時はセッション終了の30日後で、未終了ならnull', () => {
  assert.equal(
    vcRecapTranscriptExpiresAt(new Date('2026-07-01T01:00:00.000Z'))?.toISOString(),
    '2026-07-31T01:00:00.000Z',
  );
  assert.equal(vcRecapTranscriptExpiresAt(null), null);
});
