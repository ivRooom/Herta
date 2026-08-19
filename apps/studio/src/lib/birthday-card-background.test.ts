import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BIRTHDAY_CARD_BACKGROUND_MAX_BYTES,
  inspectBirthdayCardBackgroundImage,
} from '@herta/shared';

test('PNG magicとIHDRから寸法を検証する', () => {
  const png = new Uint8Array(24);
  png.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  png.set([73, 72, 68, 82], 12);
  writeUint32Be(png, 16, 1672);
  writeUint32Be(png, 20, 941);

  assert.deepEqual(inspectBirthdayCardBackgroundImage(png), {
    contentType: 'image/png',
    width: 1672,
    height: 941,
  });
});

test('JPEG SOFから寸法を検証する', () => {
  const jpeg = new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    0x03,
    0xad,
    0x06,
    0x88,
    0x03,
    0x01,
    0x11,
    0x00,
    0x02,
    0x11,
    0x00,
    0x03,
    0x11,
    0x00,
  ]);

  assert.deepEqual(inspectBirthdayCardBackgroundImage(jpeg), {
    contentType: 'image/jpeg',
    width: 1672,
    height: 941,
  });
});

test('WebP VP8Xから寸法を検証する', () => {
  const webp = new Uint8Array(30);
  webp.set([82, 73, 70, 70], 0);
  webp.set([87, 69, 66, 80], 8);
  webp.set([86, 80, 56, 88], 12);
  writeUint24Le(webp, 24, 1671);
  writeUint24Le(webp, 27, 940);

  assert.deepEqual(inspectBirthdayCardBackgroundImage(webp), {
    contentType: 'image/webp',
    width: 1672,
    height: 941,
  });
});

test('SVGや巨大画像、不正寸法を拒否する', () => {
  assert.equal(inspectBirthdayCardBackgroundImage(new TextEncoder().encode('<svg></svg>')), null);
  assert.equal(
    inspectBirthdayCardBackgroundImage(new Uint8Array(BIRTHDAY_CARD_BACKGROUND_MAX_BYTES + 1)),
    null,
  );

  const oversizedPng = new Uint8Array(24);
  oversizedPng.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  oversizedPng.set([73, 72, 68, 82], 12);
  writeUint32Be(oversizedPng, 16, 8192);
  writeUint32Be(oversizedPng, 20, 8192);
  assert.equal(inspectBirthdayCardBackgroundImage(oversizedPng), null);
});

function writeUint32Be(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function writeUint24Le(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
}
