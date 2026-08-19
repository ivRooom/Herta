import assert from 'node:assert/strict';
import test from 'node:test';
import type { GuildChannelOption } from './bot-guild-options.ts';
import { resolveMessageStudioPreviewTarget } from './message-studio-preview-target.ts';

const activeChannel: GuildChannelOption = {
  id: '111111111111111111',
  name: 'general',
  kind: 'text',
  position: 1,
  parentId: null,
  viewable: true,
  readMessageHistory: true,
};
const activeForum: GuildChannelOption = {
  ...activeChannel,
  id: '222222222222222222',
  name: 'announcements',
  kind: 'forum',
};
const activeThread: GuildChannelOption = {
  ...activeChannel,
  id: '333333333333333333',
  name: 'release-current',
  kind: 'thread',
  parentId: activeForum.id,
};
const archivedThread: GuildChannelOption = {
  ...activeThread,
  id: '444444444444444444',
  name: 'release-archive',
};
const catalog = [activeChannel, activeForum, activeThread];

test('active Channel / Forum / Threadはcatalogを正本として解決する', () => {
  assert.equal(
    resolveMessageStudioPreviewTarget(catalog, activeChannel.id, archivedThread),
    activeChannel,
  );
  assert.equal(
    resolveMessageStudioPreviewTarget(catalog, activeForum.id, archivedThread),
    activeForum,
  );
  assert.equal(
    resolveMessageStudioPreviewTarget(catalog, activeThread.id, archivedThread),
    activeThread,
  );
});

test('catalogにないarchived Threadはpickerで解決済みのtargetをfallback表示する', () => {
  assert.equal(
    resolveMessageStudioPreviewTarget(catalog, archivedThread.id, archivedThread),
    archivedThread,
  );
});

test('選択解除・別targetへ変更後は古いarchived fallbackを再利用しない', () => {
  assert.equal(resolveMessageStudioPreviewTarget(catalog, '', archivedThread), null);
  assert.equal(
    resolveMessageStudioPreviewTarget(catalog, '555555555555555555', archivedThread),
    null,
  );
});
