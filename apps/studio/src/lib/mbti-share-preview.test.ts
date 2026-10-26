import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  createMbtiSharePreview,
  mbtiShareImagePath,
  mbtiShareImageRequiredCharacters,
  mbtiShareMetadataText,
} from './mbti-share-preview.ts';

const sample = { EI: 6, SN: 1, TF: -4, JP: 2, AT: 5 };

test('share metadata names the type, identity and axis percentages', () => {
  const { title, description } = mbtiShareMetadataText(sample, false);
  assert.equal(title, 'ESFJ-A 領事官 | Herta 性格診断');
  assert.match(description, /^思いやりがあり/);
  assert.match(description, /E \d+% \/ S \d+% \/ F \d+% \/ J \d+% \/ A \d+%$/);
  assert.doesNotMatch(description, /管理ダッシュボード/);
});

test('estimated results are labelled in metadata and image URL', () => {
  assert.match(mbtiShareMetadataText(sample, true).title, /^【推定】/);
  assert.match(mbtiShareImagePath(sample, true), /basis=estimate/);
  assert.equal(createMbtiSharePreview(sample, true).estimated, true);
});

test('invalid share links fall back to generic metadata and image', () => {
  const { title, description } = mbtiShareMetadataText(null, false);
  assert.equal(title, '性格診断レポート | Herta');
  assert.doesNotMatch(description, /管理ダッシュボード/);
  assert.equal(mbtiShareImagePath(null, false), '/api/mbti/share-image');
});

test('image URL carries only the aggregate share scores', () => {
  const url = new URL(mbtiShareImagePath(sample, false), 'https://example.com');
  assert.deepEqual([...url.searchParams.keys()].sort(), ['at', 'ei', 'jp', 'sn', 'tf', 'v']);
});

test('preview percentages describe the dominant side of each axis', () => {
  const preview = createMbtiSharePreview(sample, false);
  const tf = preview.axes.find((axis) => axis.axis === 'TF')!;
  assert.equal(tf.side, 1);
  assert.ok(tf.percent >= 50 && tf.percent <= 100);
});

/** TrueTypeのcmap(format 4 / 12)から収録コードポイントを読む。 */
function readCmapCodePoints(path: string): Set<number> {
  const view = new DataView(readFileSync(path).buffer.slice(0));
  const tableCount = view.getUint16(4);
  let cmap = -1;
  for (let i = 0; i < tableCount; i++) {
    const record = 12 + i * 16;
    const tag = String.fromCharCode(...[0, 1, 2, 3].map((j) => view.getUint8(record + j)));
    if (tag === 'cmap') cmap = view.getUint32(record + 8);
  }
  assert.ok(cmap >= 0, 'cmap table missing');
  const codePoints = new Set<number>();
  const subtableCount = view.getUint16(cmap + 2);
  for (let i = 0; i < subtableCount; i++) {
    const offset = cmap + view.getUint32(cmap + 4 + i * 8 + 4);
    const format = view.getUint16(offset);
    if (format === 4) {
      const segments = view.getUint16(offset + 6) / 2;
      const ends = offset + 14;
      const starts = ends + segments * 2 + 2;
      for (let s = 0; s < segments; s++) {
        const end = view.getUint16(ends + s * 2);
        for (let c = view.getUint16(starts + s * 2); c <= end && c !== 0xffff; c++) {
          codePoints.add(c);
        }
      }
    } else if (format === 12) {
      const groups = view.getUint32(offset + 12);
      for (let g = 0; g < groups; g++) {
        const group = offset + 16 + g * 12;
        const end = view.getUint32(group + 4);
        for (let c = view.getUint32(group); c <= end; c++) codePoints.add(c);
      }
    }
  }
  return codePoints;
}

for (const file of ['NotoSansJP-Regular-subset.ttf', 'NotoSansJP-ExtraBold-subset.ttf']) {
  test(`${file} contains every character the share image can draw`, () => {
    const codePoints = readCmapCodePoints(
      new URL(`../app/api/mbti/share-image/${file}`, import.meta.url).pathname,
    );
    const missing = [...mbtiShareImageRequiredCharacters()].filter(
      (character) => character !== ' ' && !codePoints.has(character.codePointAt(0)!),
    );
    assert.deepEqual(missing, [], `subset font is missing: ${missing.join('')}`);
  });
}
