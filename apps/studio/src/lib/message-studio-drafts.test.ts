import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMessageStudioDraftPayload } from './message-studio-drafts.ts';

const base = {
  channelId: '123456789012345678',
  forumTitle: '',
  content: 'hello',
  messageFormat: 'text',
  embedTitle: '',
  embedDescription: '',
  embedColor: '#5865F2',
  embedImageUrl: '',
  embedThumbnailUrl: '',
  embedFooterText: '',
  embedFields: [],
  publishAnnouncement: false,
};

test('Message Studio下書きpayloadを正規化できる', () => {
  assert.deepEqual(parseMessageStudioDraftPayload(base), base);
});

test('Voice形式を保存できるがファイル本体をpayloadへ要求しない', () => {
  const payload = parseMessageStudioDraftPayload({ ...base, content: '', messageFormat: 'voice' });
  assert.equal(payload?.messageFormat, 'voice');
  assert.equal(payload?.content, '');
});

test('不正な形式・色・過大Fieldを拒否する', () => {
  assert.equal(parseMessageStudioDraftPayload({ ...base, messageFormat: 'unknown' }), null);
  assert.equal(parseMessageStudioDraftPayload({ ...base, embedColor: 'red' }), null);
  assert.equal(
    parseMessageStudioDraftPayload({
      ...base,
      embedFields: Array.from({ length: 26 }, () => ({ name: 'n', value: 'v' })),
    }),
    null,
  );
});
