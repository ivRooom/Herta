import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BIRTHDAY_CARD_PREVIEW_HEIGHT,
  BIRTHDAY_CARD_PREVIEW_WIDTH,
  birthdayCardAvatarGeometry,
  birthdayCardTextHitWidth,
  birthdayCardTextStrokeWidth,
  nudgeBirthdayCardPosition,
  nudgeBirthdayCardSize,
  pointerDeltaToBirthdayCardPixels,
  pointerToBirthdayCardPosition,
  resizeBirthdayCardAvatarSize,
  resizeBirthdayCardTextSize,
} from './birthday-card-preview.ts';

test('pointer座標をBirthday Cardの0-100%座標へ変換する', () => {
  const rect = { left: 100, top: 50, width: 800, height: 400 };

  assert.deepEqual(pointerToBirthdayCardPosition(500, 250, rect), { x: 50, y: 50 });
  assert.deepEqual(pointerToBirthdayCardPosition(20, 500, rect), { x: 0, y: 100 });
});

test('pointer移動量を1672x941のpreview pixelへ変換する', () => {
  const rect = { left: 100, top: 50, width: 836, height: 470.5 };

  assert.deepEqual(pointerDeltaToBirthdayCardPixels(200, 100, 618, 335.25, rect), {
    x: BIRTHDAY_CARD_PREVIEW_WIDTH / 2,
    y: BIRTHDAY_CARD_PREVIEW_HEIGHT / 2,
  });
});

test('サイズ0のpreviewではpointer位置と移動量を解決しない', () => {
  const invalidRect = { left: 0, top: 0, width: 0, height: 100 };
  assert.equal(pointerToBirthdayCardPosition(10, 10, invalidRect), null);
  assert.equal(pointerDeltaToBirthdayCardPixels(0, 0, 10, 10, invalidRect), null);
});

test('keyboard移動はCard境界を越えない', () => {
  assert.deepEqual(nudgeBirthdayCardPosition({ x: 50, y: 50 }, -1, 5), { x: 49, y: 55 });
  assert.deepEqual(nudgeBirthdayCardPosition({ x: 0, y: 100 }, -5, 5), { x: 0, y: 100 });
});

test('keyboardサイズ調整は設定されたmin/maxを越えない', () => {
  assert.equal(nudgeBirthdayCardSize(58, 1, 20, 96), 59);
  assert.equal(nudgeBirthdayCardSize(20, -5, 20, 96), 20);
  assert.equal(nudgeBirthdayCardSize(96, 5, 20, 96), 96);
});

test('Avatarのresizeは右handle移動をdiameterの変化として換算してclampする', () => {
  const halfPercentWidth = (BIRTHDAY_CARD_PREVIEW_WIDTH * 0.01) / 2;

  assert.equal(resizeBirthdayCardAvatarSize(16, halfPercentWidth, 6, 30), 17);
  assert.equal(resizeBirthdayCardAvatarSize(6, -1000, 6, 30), 6);
  assert.equal(resizeBirthdayCardAvatarSize(30, 1000, 6, 30), 30);
});

test('textのresizeはpreview hit widthと同じ比率でfont sizeを変更する', () => {
  const valueLength = 'Herta Member'.length;
  const beforeWidth = birthdayCardTextHitWidth(valueLength, 58);
  const afterWidth = birthdayCardTextHitWidth(valueLength, 68);
  const rightEdgeDelta = (afterWidth - beforeWidth) / 2;

  assert.equal(resizeBirthdayCardTextSize(58, rightEdgeDelta, valueLength, 20, 96), 68);
  assert.equal(resizeBirthdayCardTextSize(20, -1000, valueLength, 20, 96), 20);
  assert.equal(resizeBirthdayCardTextSize(96, 1000, valueLength, 20, 96), 96);
});

test('Avatar geometryはBot rendererと同じ1672x941座標・edge clampを使う', () => {
  const centered = birthdayCardAvatarGeometry(50, 50, 10);
  assert.equal(centered.diameter, Math.round(BIRTHDAY_CARD_PREVIEW_WIDTH * 0.1));
  assert.ok(Math.abs(centered.centerX - BIRTHDAY_CARD_PREVIEW_WIDTH / 2) <= 0.5);
  assert.ok(Math.abs(centered.centerY - BIRTHDAY_CARD_PREVIEW_HEIGHT / 2) <= 0.5);

  const edge = birthdayCardAvatarGeometry(0, 0, 16);
  assert.equal(edge.centerX, edge.diameter / 2);
  assert.equal(edge.centerY, edge.diameter / 2);
});

test('text stroke widthはBot rendererと同じ計算を使う', () => {
  assert.equal(birthdayCardTextStrokeWidth(16), 2);
  assert.equal(birthdayCardTextStrokeWidth(72), 4);
});
