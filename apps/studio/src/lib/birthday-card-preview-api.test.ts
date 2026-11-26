import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  authorizeBirthdayCardPreview,
  BIRTHDAY_CARD_PREVIEW_PATH,
  BIRTHDAY_CARD_PREVIEW_PURPOSE,
  buildBirthdayCardPreviewConfig,
} from './birthday-card-preview-api.ts';

const environment = {
  IVRM_INTEGRATION_GUILD_ID: '100000000000000001',
  IVRM_INTEGRATION_TOKEN: 'test-token-that-is-long-enough-32chars',
};
const input = {
  guildId: environment.IVRM_INTEGRATION_GUILD_ID,
  card: {
    preset: 'herta-night-board',
    backgroundUrl: null,
    showName: true,
    showAvatar: true,
    showBirthday: true,
  },
};

function signed(
  value: unknown = input,
  timestamp = new Date().toISOString(),
  secret = environment.IVRM_INTEGRATION_TOKEN,
) {
  const body = JSON.stringify(value),
    event = randomUUID(),
    key = createHmac('sha256', secret).update(BIRTHDAY_CARD_PREVIEW_PURPOSE).digest();
  return new Request(`https://studio.test${BIRTHDAY_CARD_PREVIEW_PATH}`, {
    method: 'POST',
    headers: {
      'X-IVRM-Timestamp': timestamp,
      'X-IVRM-Event-Id': event,
      'X-IVRM-Signature': createHmac('sha256', key)
        .update(`${timestamp}.${event}.POST.${BIRTHDAY_CARD_PREVIEW_PATH}.${body}`)
        .digest('hex'),
    },
    body,
  });
}

test('authenticates exact service body and binds Guild', async () => {
  assert.deepEqual(await authorizeBirthdayCardPreview(signed(), environment), input);
  for (const value of [
    { ...input, guildId: '100000000000000099' },
    { ...input, extra: true },
    { guildId: input.guildId },
    { ...input, card: { ...input.card, preset: 'unknown-preset' } },
    { ...input, card: { ...input.card, backgroundUrl: 'http://example.com/bg.png' } },
    { ...input, card: { ...input.card, backgroundUrl: 'not-a-url' } },
    { ...input, card: { ...input.card, showName: 'yes' } },
    { ...input, card: { ...input.card, showAge: 'yes' } },
    { ...input, card: { ...input.card, showAges: true } },
  ]) {
    const response = await authorizeBirthdayCardPreview(signed(value), environment);
    assert.ok(response instanceof Response);
    assert.equal(response.status, 422);
  }
});

test('accepts the optional showAge flag on the card (#1914 S-F)', async () => {
  for (const showAge of [true, false]) {
    const value = { ...input, card: { ...input.card, showAge } };
    assert.deepEqual(await authorizeBirthdayCardPreview(signed(value), environment), value);
  }
});

test('accepts a valid presetDefinition and rejects malformed ones (#1028 R3-E)', async () => {
  const presetDefinition = {
    id: 'my-custom-preset',
    label: 'カスタムプリセット',
    backgroundUrl: 'https://media.example.com/birthday/bg.webp',
    textColor: '#ff0000',
    textStroke: '#0000ff',
  };
  for (const value of [
    { ...input, card: { ...input.card, presetDefinition } },
    { ...input, card: { ...input.card, presetDefinition: null } },
  ]) {
    assert.deepEqual(await authorizeBirthdayCardPreview(signed(value), environment), value);
  }
  for (const bad of [
    { ...presetDefinition, backgroundUrl: 'http://media.example.com/birthday/bg.webp' },
    { ...presetDefinition, textColor: 'red' },
    { ...presetDefinition, id: 'Bad Slug' },
    { ...presetDefinition, extra: true },
    'not-a-definition',
  ]) {
    const response = await authorizeBirthdayCardPreview(
      signed({ ...input, card: { ...input.card, presetDefinition: bad } }),
      environment,
    );
    assert.ok(response instanceof Response);
    assert.equal(response.status, 422);
  }
});

test('rejects expired signature and wrong key, fails closed while unconfigured', async () => {
  const stale = await authorizeBirthdayCardPreview(
    signed(input, new Date(Date.now() - 400000).toISOString()),
    environment,
  );
  assert.ok(stale instanceof Response);
  assert.equal(stale.status, 401);
  const wrongKey = await authorizeBirthdayCardPreview(
    signed(input, new Date().toISOString(), 'another-token-that-is-long-enough-32'),
    environment,
  );
  assert.ok(wrongKey instanceof Response);
  assert.equal(wrongKey.status, 401);
  const unconfigured = await authorizeBirthdayCardPreview(signed(), {});
  assert.ok(unconfigured instanceof Response);
  assert.equal(unconfigured.status, 503);
});

test('preview config overrides preset and show flags, keeps Studio layout', () => {
  const config = buildBirthdayCardPreviewConfig(
    {
      birthdayCardEnabled: false,
      birthdayCardPreset: 'herta-lavender-tea',
      birthdayCardShowAge: true,
      birthdayCardNameX: 12,
      birthdayCardBackgroundSource: 'preset',
    },
    {
      preset: 'herta-lavender-gifts',
      backgroundUrl: null,
      showName: false,
      showAvatar: true,
      showBirthday: false,
    },
  );
  assert.equal(config.birthdayCardPreset, 'herta-lavender-gifts');
  assert.equal(config.birthdayCardShowName, false);
  assert.equal(config.birthdayCardShowAvatar, true);
  assert.equal(config.birthdayCardShowBirthday, false);
  // showAge absent from the request means off, even when the
  // Studio config has age display on.
  assert.equal(config.birthdayCardShowAge, false);
  assert.equal(config.birthdayCardEnabled, true);
  assert.equal(config.birthdayCardNameX, 12);
});

test('preview config follows an explicit showAge from the request (#1914 S-F)', () => {
  const config = buildBirthdayCardPreviewConfig(
    { birthdayCardShowAge: false, birthdayCardBackgroundSource: 'preset' },
    {
      preset: 'herta-night-board',
      backgroundUrl: null,
      showName: true,
      showAvatar: true,
      showBirthday: true,
      showAge: true,
    },
  );
  assert.equal(config.birthdayCardShowAge, true);
});
