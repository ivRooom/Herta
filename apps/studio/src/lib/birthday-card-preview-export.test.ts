import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BIRTHDAY_CARD_PREVIEW_HEIGHT,
  BIRTHDAY_CARD_PREVIEW_WIDTH,
} from './birthday-card-preview.ts';
import { birthdayCardPreviewCoverRect } from './birthday-card-preview-export.ts';

test('同じaspect ratioの背景はCard全体へ一致する', () => {
  assert.deepEqual(birthdayCardPreviewCoverRect(1672, 941), {
    x: 0,
    y: 0,
    width: BIRTHDAY_CARD_PREVIEW_WIDTH,
    height: BIRTHDAY_CARD_PREVIEW_HEIGHT,
  });
});

test('横長背景はcoverで左右を中央cropする', () => {
  const rect = birthdayCardPreviewCoverRect(2000, 941);
  assert.ok(rect);
  assert.equal(rect.height, BIRTHDAY_CARD_PREVIEW_HEIGHT);
  assert.ok(rect.width > BIRTHDAY_CARD_PREVIEW_WIDTH);
  assert.equal(rect.x, (BIRTHDAY_CARD_PREVIEW_WIDTH - rect.width) / 2);
  assert.equal(rect.y, 0);
});

test('縦長背景はcoverで上下を中央cropする', () => {
  const rect = birthdayCardPreviewCoverRect(1672, 1200);
  assert.ok(rect);
  assert.equal(rect.width, BIRTHDAY_CARD_PREVIEW_WIDTH);
  assert.ok(rect.height > BIRTHDAY_CARD_PREVIEW_HEIGHT);
  assert.equal(rect.x, 0);
  assert.equal(rect.y, (BIRTHDAY_CARD_PREVIEW_HEIGHT - rect.height) / 2);
});

test('不正な画像サイズは拒否する', () => {
  assert.equal(birthdayCardPreviewCoverRect(0, 941), null);
  assert.equal(birthdayCardPreviewCoverRect(1672, 0), null);
});
