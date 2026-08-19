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
const archivedThread: GuildChannelOption = {
  ...activeChannel,
  id: '333333333333333333',
  name: 'release-archive',
  kind: 'thread',
  parentId: activeForum.id,
};

test('active Channel / Forumはcatalogを正本として解決する', () => {
  assert.equal(
    resolveMessageStudioPreviewTarget(
      [activeChannel, activeForum],
      activeChannel.id,
      archivedThread,
    ),
    activeChannel,
  );
  assert.equal(
    resolveMessageStudioPreviewTarget(
      [activeChannel, activeForum],
      activeForum.id,
      archivedThread,
    ),
    activeForum,
  );
});

test('catalogにないarchived Threadはpickerで解決済みのtargetをfallback表示する', () => {
  assert.equal(
    resolveMessageStudioPreviewTarget([activeChannel, activeForum], archivedThread.id, archivedThread),
    archivedThread,
  );
});

test('選択解除・別targetへ変更後は古いarchived fallbackを再利用しない', () => {
  assert.equal(
    resolveMessageStudioPreviewTarget([activeChannel, activeForum], '', archivedThread),
    null,
  );
  assert.equal(
    resolveMessageStudioPreviewTarget(
      [activeChannel, activeForum],
      '444444444444444444',
      archivedThread,
    ),
    null,
  );
});
