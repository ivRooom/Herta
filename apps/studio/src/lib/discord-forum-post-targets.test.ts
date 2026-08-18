import assert from 'node:assert/strict';
import test from 'node:test';
import type { GuildChannelOption } from './bot-guild-options.ts';
import { resolveDiscordForumPostTargetSelection } from './discord-forum-post-targets.ts';

const forumA: GuildChannelOption = {
  id: '111111111111111111',
  name: 'announcements',
  kind: 'forum',
  position: 1,
  parentId: null,
  viewable: true,
  readMessageHistory: true,
};
const forumB: GuildChannelOption = {
  ...forumA,
  id: '222222222222222222',
  name: 'support',
  position: 2,
};
const threadA: GuildChannelOption = {
  id: '333333333333333333',
  name: 'release-1',
  kind: 'thread',
  position: 1,
  parentId: forumA.id,
  viewable: true,
  readMessageHistory: true,
};
const hiddenThread: GuildChannelOption = {
  ...threadA,
  id: '444444444444444444',
  name: 'hidden',
  viewable: false,
};
const otherForumThread: GuildChannelOption = {
  ...threadA,
  id: '555555555555555555',
  name: 'support-post',
  parentId: forumB.id,
};
const textThread: GuildChannelOption = {
  ...threadA,
  id: '666666666666666666',
  name: 'text-thread',
  parentId: '777777777777777777',
};
const options = [forumA, forumB, threadA, hiddenThread, otherForumThread, textThread];

test('Forum選択時は同じForum配下でBotが閲覧可能な既存投稿だけを返す', () => {
  const selection = resolveDiscordForumPostTargetSelection(options, forumA.id);
  assert.equal(selection.primaryChannelId, forumA.id);
  assert.equal(selection.forumId, forumA.id);
  assert.equal(selection.threadId, null);
  assert.deepEqual(
    selection.threads.map((thread) => thread.id),
    [threadA.id],
  );
});

test('Forum配下Threadを読み込むと親Forumをprimary選択として復元する', () => {
  const selection = resolveDiscordForumPostTargetSelection(options, threadA.id);
  assert.equal(selection.primaryChannelId, forumA.id);
  assert.equal(selection.forumId, forumA.id);
  assert.equal(selection.threadId, threadA.id);
});

test('別ForumのThreadを候補へ混ぜない', () => {
  const selection = resolveDiscordForumPostTargetSelection(options, forumB.id);
  assert.deepEqual(
    selection.threads.map((thread) => thread.id),
    [otherForumThread.id],
  );
});

test('Forum配下ではないThreadと未解決IDは従来どおり直接選択として扱う', () => {
  assert.deepEqual(resolveDiscordForumPostTargetSelection(options, textThread.id), {
    primaryChannelId: textThread.id,
    forumId: null,
    threadId: null,
    threads: [],
  });
  assert.deepEqual(resolveDiscordForumPostTargetSelection(options, '888888888888888888'), {
    primaryChannelId: '888888888888888888',
    forumId: null,
    threadId: null,
    threads: [],
  });
});
