import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BIRTHDAY_CARD_PREVIEW_HEIGHT,
  BIRTHDAY_CARD_PREVIEW_WIDTH,
  birthdayCardAvatarGeometry,
  birthdayCardTextStrokeWidth,
  nudgeBirthdayCardPosition,
  pointerToBirthdayCardPosition,
} from './birthday-card-preview.ts';

test('pointer座標をBirthday Cardの0-100%座標へ変換する', () => {
  const rect = { left: 100, top: 50, width: 800, height: 400 };

  assert.deepEqual(pointerToBirthdayCardPosition(500, 250, rect), { x: 50, y: 50 });
  assert.deepEqual(pointerToBirthdayCardPosition(20, 500, rect), { x: 0, y: 100 });
});

test('サイズ0のpreviewではpointer位置を解決しない', () => {
  assert.equal(
    pointerToBirthdayCardPosition(10, 10, { left: 0, top: 0, width: 0, height: 100 }),
    null,
  );
});

test('keyboard移動はCard境界を越えない', () => {
  assert.deepEqual(nudgeBirthdayCardPosition({ x: 50, y: 50 }, -1, 5), { x: 49, y: 55 });
  assert.deepEqual(nudgeBirthdayCardPosition({ x: 0, y: 100 }, -5, 5), { x: 0, y: 100 });
});

test('Avatar geometryはBot rendererと同じ1672x941座標・edge clampを使う', () => {
  const centered = birthdayCardAvatarGeometry(50, 50, 10);
  assert.equal(centered.diameter, Math.round(BIRTHDAY_CARD_PREVIEW_WIDTH * 0.1));
  assert.equal(centered.centerX, BIRTHDAY_CARD_PREVIEW_WIDTH / 2);
  assert.ok(Math.abs(centered.centerY - BIRTHDAY_CARD_PREVIEW_HEIGHT / 2) <= 0.5);

  const edge = birthdayCardAvatarGeometry(0, 0, 16);
  assert.equal(edge.centerX, edge.diameter / 2);
  assert.equal(edge.centerY, edge.diameter / 2);
});

test('text stroke widthはBot rendererと同じ計算を使う', () => {
  assert.equal(birthdayCardTextStrokeWidth(16), 2);
  assert.equal(birthdayCardTextStrokeWidth(72), 4);
});
