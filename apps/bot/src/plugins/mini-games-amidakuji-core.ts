import { deflateSync } from 'node:zlib';

export interface AmidakujiBar {
  row: number;
  left: number;
}

export interface AmidakujiLadder {
  slots: number;
  rows: number;
  bars: AmidakujiBar[];
  results: number[];
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function generateAmidakujiLadder(
  slots: number,
  random: () => number = Math.random,
): AmidakujiLadder {
  if (!Number.isInteger(slots) || slots < 2 || slots > 10) {
    throw new RangeError('Amidakuji slots must be an integer between 2 and 10');
  }

  const rows = Math.max(8, slots * 4);
  const bars: AmidakujiBar[] = [];
  for (let row = 0; row < rows; row += 1) {
    const occupied = new Set<number>();
    for (let left = 0; left < slots - 1; left += 1) {
      if (occupied.has(left) || occupied.has(left + 1)) continue;
      if (random() >= 0.36) continue;
      bars.push({ row, left });
      occupied.add(left);
      occupied.add(left + 1);
    }
  }

  // A completely straight ladder is visually uninteresting and makes the result obvious.
  if (bars.length === 0) {
    bars.push({ row: Math.floor(rows / 2), left: Math.floor(random() * (slots - 1)) });
  }

  const results = Array.from({ length: slots }, (_, start) =>
    traceAmidakuji(slots, rows, bars, start),
  );
  return { slots, rows, bars, results };
}

export function traceAmidakuji(
  slots: number,
  rows: number,
  bars: readonly AmidakujiBar[],
  start: number,
): number {
  if (!Number.isInteger(start) || start < 0 || start >= slots) {
    throw new RangeError('Amidakuji start slot is out of range');
  }
  let column = start;
  const byRow = new Map<number, AmidakujiBar[]>();
  for (const bar of bars) {
    const rowBars = byRow.get(bar.row) ?? [];
    rowBars.push(bar);
    byRow.set(bar.row, rowBars);
  }
  for (let row = 0; row < rows; row += 1) {
    for (const bar of byRow.get(row) ?? []) {
      if (bar.left === column) {
        column += 1;
        break;
      }
      if (bar.left + 1 === column) {
        column -= 1;
        break;
      }
    }
  }
  return column;
}

export function renderAmidakujiPng(ladder: AmidakujiLadder, hidden: boolean): Buffer {
  const marginX = 36;
  const top = 42;
  const bottom = 398;
  const width = Math.max(360, marginX * 2 + (ladder.slots - 1) * 62);
  const height = 440;
  const pixels = Buffer.alloc(width * height * 4, 255);
  const xFor = (column: number) =>
    ladder.slots === 1
      ? Math.floor(width / 2)
      : Math.round(marginX + (column * (width - marginX * 2)) / (ladder.slots - 1));
  const rowHeight = (bottom - top) / ladder.rows;

  for (let column = 0; column < ladder.slots; column += 1) {
    drawLine(pixels, width, height, xFor(column), top, xFor(column), bottom, [53, 57, 65, 255], 3);
    drawDigitNumber(pixels, width, height, xFor(column), 15, column + 1, [31, 41, 55, 255]);
    drawDigitNumber(pixels, width, height, xFor(column), 410, column + 1, [31, 41, 55, 255]);
  }

  for (const bar of ladder.bars) {
    const y = Math.round(top + (bar.row + 0.5) * rowHeight);
    drawLine(
      pixels,
      width,
      height,
      xFor(bar.left),
      y,
      xFor(bar.left + 1),
      y,
      [88, 101, 242, 255],
      4,
    );
  }

  if (hidden) {
    const maskTop = Math.round(top + (bottom - top) * 0.34);
    const maskBottom = Math.round(top + (bottom - top) * 0.68);
    fillRect(
      pixels,
      width,
      height,
      10,
      maskTop,
      width - 20,
      maskBottom - maskTop,
      [229, 231, 235, 255],
    );
    const centerX = Math.floor(width / 2);
    drawQuestionMark(pixels, width, height, centerX, Math.floor((maskTop + maskBottom) / 2));
  }

  return encodePng(width, height, pixels);
}

function drawQuestionMark(pixels: Buffer, width: number, height: number, cx: number, cy: number) {
  const color: Rgba = [107, 114, 128, 255];
  fillRect(pixels, width, height, cx - 16, cy - 25, 24, 6, color);
  fillRect(pixels, width, height, cx + 4, cy - 19, 6, 18, color);
  fillRect(pixels, width, height, cx - 8, cy - 6, 18, 6, color);
  fillRect(pixels, width, height, cx - 8, cy, 6, 12, color);
  fillRect(pixels, width, height, cx - 8, cy + 22, 6, 6, color);
}

type Rgba = readonly [number, number, number, number];

function setPixel(
  pixels: Buffer,
  width: number,
  height: number,
  x: number,
  y: number,
  color: Rgba,
) {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const index = (y * width + x) * 4;
  pixels[index] = color[0];
  pixels[index + 1] = color[1];
  pixels[index + 2] = color[2];
  pixels[index + 3] = color[3];
}

function fillRect(
  pixels: Buffer,
  width: number,
  height: number,
  x: number,
  y: number,
  rectWidth: number,
  rectHeight: number,
  color: Rgba,
) {
  for (let yy = Math.max(0, y); yy < Math.min(height, y + rectHeight); yy += 1) {
    for (let xx = Math.max(0, x); xx < Math.min(width, x + rectWidth); xx += 1) {
      setPixel(pixels, width, height, xx, yy, color);
    }
  }
}

function drawLine(
  pixels: Buffer,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: Rgba,
  thickness: number,
) {
  const dx = Math.abs(x1 - x0);
  const sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0);
  const sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  let x = x0;
  let y = y0;
  while (true) {
    fillRect(
      pixels,
      width,
      height,
      x - Math.floor(thickness / 2),
      y - Math.floor(thickness / 2),
      thickness,
      thickness,
      color,
    );
    if (x === x1 && y === y1) break;
    const twice = 2 * error;
    if (twice >= dy) {
      error += dy;
      x += sx;
    }
    if (twice <= dx) {
      error += dx;
      y += sy;
    }
  }
}

const DIGIT_SEGMENTS: Record<string, readonly string[]> = {
  '0': ['a', 'b', 'c', 'd', 'e', 'f'],
  '1': ['b', 'c'],
  '2': ['a', 'b', 'g', 'e', 'd'],
  '3': ['a', 'b', 'c', 'd', 'g'],
  '4': ['f', 'g', 'b', 'c'],
  '5': ['a', 'f', 'g', 'c', 'd'],
  '6': ['a', 'f', 'e', 'd', 'c', 'g'],
  '7': ['a', 'b', 'c'],
  '8': ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
  '9': ['a', 'b', 'c', 'd', 'f', 'g'],
};

function drawDigitNumber(
  pixels: Buffer,
  width: number,
  height: number,
  centerX: number,
  y: number,
  value: number,
  color: Rgba,
) {
  const text = String(value);
  const digitWidth = 10;
  const gap = 4;
  const total = text.length * digitWidth + (text.length - 1) * gap;
  let x = Math.round(centerX - total / 2);
  for (const digit of text) {
    drawDigit(pixels, width, height, x, y, digit, color);
    x += digitWidth + gap;
  }
}

function drawDigit(
  pixels: Buffer,
  width: number,
  height: number,
  x: number,
  y: number,
  digit: string,
  color: Rgba,
) {
  const segments = new Set(DIGIT_SEGMENTS[digit] ?? []);
  const h = (xx: number, yy: number) => fillRect(pixels, width, height, xx, yy, 8, 2, color);
  const v = (xx: number, yy: number) => fillRect(pixels, width, height, xx, yy, 2, 8, color);
  if (segments.has('a')) h(x + 1, y);
  if (segments.has('b')) v(x + 8, y + 1);
  if (segments.has('c')) v(x + 8, y + 10);
  if (segments.has('d')) h(x + 1, y + 18);
  if (segments.has('e')) v(x, y + 10);
  if (segments.has('f')) v(x, y + 1);
  if (segments.has('g')) h(x + 1, y + 9);
}

function encodePng(width: number, height: number, pixels: Buffer): Buffer {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const idat = deflateSync(raw, { level: 6 });
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
