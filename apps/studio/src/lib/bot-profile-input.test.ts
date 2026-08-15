import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BOT_AVATAR_MAX_BYTES,
  matchesBotAvatarSignature,
  parseBotNickname,
  validateBotAvatarMetadata,
} from './bot-profile-input.ts';

test('Bot nicknameをtrimし空文字は解除として扱う', () => {
  assert.equal(parseBotNickname('  Herta   Bot  '), 'Herta Bot');
  assert.equal(parseBotNickname('   '), null);
  assert.equal(parseBotNickname('a'.repeat(33)), undefined);
  assert.equal(parseBotNickname(null), undefined);
});

test('AvatarはDiscord Image Data対応形式と1MiB以下だけ許可する', () => {
  assert.equal(validateBotAvatarMetadata({ type: 'image/png', size: 100 }), true);
  assert.equal(validateBotAvatarMetadata({ type: 'image/jpeg', size: BOT_AVATAR_MAX_BYTES }), true);
  assert.equal(validateBotAvatarMetadata({ type: 'image/webp', size: 100 }), false);
  assert.equal(validateBotAvatarMetadata({ type: 'image/png', size: BOT_AVATAR_MAX_BYTES + 1 }), false);
  assert.equal(validateBotAvatarMetadata({ type: 'image/png', size: 0 }), false);
});

test('Avatar MIMEと実データのsignatureが一致することを検証する', () => {
  assert.equal(matchesBotAvatarSignature('image/jpeg', Uint8Array.from([0xff, 0xd8, 0xff, 0x00])), true);
  assert.equal(
    matchesBotAvatarSignature(
      'image/png',
      Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ),
    true,
  );
  assert.equal(
    matchesBotAvatarSignature('image/gif', new TextEncoder().encode('GIF89aexample')),
    true,
  );
  assert.equal(matchesBotAvatarSignature('image/png', Uint8Array.from([0xff, 0xd8, 0xff])), false);
});
