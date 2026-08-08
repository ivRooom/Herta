import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDiscordMessageUrl,
  normalizeDiscordMessageTarget,
  parseDiscordMessageReference,
} from './discord-message-target.ts';

const guildId = '964326043420872704';
const channelId = '1175075504940908635';
const messageId = '1175075504940908636';

test('Discord message URLからGuild内ChannelとMessage IDを抽出できる', () => {
  assert.deepEqual(
    parseDiscordMessageReference(
      `https://discord.com/channels/${guildId}/${channelId}/${messageId}`,
      guildId,
    ),
    { channelId, messageId },
  );
});

test('別Guildのmessage URLは拒否する', () => {
  assert.equal(
    parseDiscordMessageReference(
      `https://discord.com/channels/964326043420872799/${channelId}/${messageId}`,
      guildId,
    ),
    null,
  );
});

test('Message ID単体は選択済みChannelと組み合わせる', () => {
  assert.deepEqual(parseDiscordMessageReference(messageId, guildId, channelId), {
    channelId,
    messageId,
  });
  assert.equal(parseDiscordMessageReference(messageId, guildId), null);
});

test('保存済みobjectは未知キーを混ぜず正規化する', () => {
  assert.deepEqual(normalizeDiscordMessageTarget({ channelId, messageId, unexpected: true }), {
    channelId,
    messageId,
  });
});

test('Guild/Channel/Messageが揃った場合だけjump URLを生成する', () => {
  assert.equal(
    buildDiscordMessageUrl(guildId, { channelId, messageId }),
    `https://discord.com/channels/${guildId}/${channelId}/${messageId}`,
  );
  assert.equal(buildDiscordMessageUrl(guildId, { channelId: '', messageId }), null);
});
