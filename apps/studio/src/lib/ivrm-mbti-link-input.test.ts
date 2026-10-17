import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMemberMbtiLinkInput } from './ivrm-mbti-link-input.ts';
test('member links accept only the scoped subject and supported actions', () => {
  const valid = { discordUserId: '123456789012345678', action: 'quiz' };
  assert.deepEqual(parseMemberMbtiLinkInput(valid), valid);
  for (const bad of [
    null,
    [],
    {},
    { ...valid, action: 'delete' },
    { ...valid, discordUserId: '../' },
    { ...valid, guildId: 'other' },
    { ...valid, returnTo: 'https://evil.example' },
  ])
    assert.equal(parseMemberMbtiLinkInput(bad), null);
});
