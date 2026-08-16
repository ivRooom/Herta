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

export type AmidakujiComplexity = 'simple' | 'standard' | 'chaos';
export type AmidakujiTheme = 'arcade' | 'midnight' | 'classic';

export interface AmidakujiGenerationOptions {
  complexity?: AmidakujiComplexity;
}

export interface AmidakujiRenderOptions {
  hidden?: boolean;
  hiddenPercent?: number;
  revealProgress?: number;
  theme?: AmidakujiTheme;
  highlightStarts?: readonly number[];
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_RESULT_LABEL_LENGTH = 50;
const PATH_COLORS: readonly Rgba[] = [
  [250, 204, 21, 255],
  [56, 189, 248, 255],
  [244, 114, 182, 255],
  [74, 222, 128, 255],
  [192, 132, 252, 255],
  [251, 146, 60, 255],
  [45, 212, 191, 255],
  [248, 113, 113, 255],
  [129, 140, 248, 255],
  [163, 230, 53, 255],
];

export function parseAmidakujiResultLabels(input: string | null, slots: number): string[] | null {
  if (!Number.isInteger(slots) || slots < 2 || slots > 10) return null;
  const normalized = input?.trim() ?? '';
  if (!normalized) return Array.from({ length: slots }, (_, index) => `${index + 1}番`);

  const labels = normalized
    .split(/[\n,、]/u)
    .map((label) => label.trim())
    .filter(Boolean);
  if (labels.length !== slots) return null;
  if (labels.some((label) => label.length > MAX_RESULT_LABEL_LENGTH)) return null;
  return labels;
}

export function generateAmidakujiLadder(
  slots: number,
  optionsOrRandom: AmidakujiGenerationOptions | (() => number) = {},
  random: () => number = Math.random,
): AmidakujiLadder {
  if (!Number.isInteger(slots) || slots < 2 || slots > 10) {
    throw new RangeError('Amidakuji slots must be an integer between 2 and 10');
  }

  const options = typeof optionsOrRandom === 'function' ? {} : optionsOrRandom;
  const rng = typeof optionsOrRandom === 'function' ? optionsOrRandom : random;
  const complexity = normalizeComplexity(options.complexity);
  const settings =
    complexity === 'simple'
      ? { rowMultiplier: 3, minimumRows: 7, density: 0.24 }
      : complexity === 'chaos'
        ? { rowMultiplier: 7, minimumRows: 16, density: 0.55 }
        : { rowMultiplier: 5, minimumRows: 10, density: 0.38 };

  const rows = Math.max(settings.minimumRows, slots * settings.rowMultiplier);
  const bars: AmidakujiBar[] = [];
  for (let row = 0; row < rows; row += 1) {
    const occupied = new Set<number>();
    const direction = row % 2 === 0 ? 1 : -1;
    const start = direction === 1 ? 0 : slots - 2;
    const end = direction === 1 ? slots - 1 : -1;
    for (let left = start; left !== end; left += direction) {
      if (occupied.has(left) || occupied.has(left + 1)) continue;
      if (rng() >= settings.density) continue;
      bars.push({ row, left });
      occupied.add(left);
      occupied.add(left + 1);
    }
  }

  const minimumBars = complexity === 'chaos' ? slots * 2 : complexity === 'standard' ? slots : 1;
  while (bars.length < minimumBars) {
    const row = Math.floor(rng() * rows);
    const left = Math.floor(rng() * (slots - 1));
    if (bars.some((bar) => bar.row === row && Math.abs(bar.left - left) <= 1)) continue;
    bars.push({ row, left });
  }
  bars.sort((a, b) => a.row - b.row || a.left - b.left);

  const results = Array.from({ length: slots }, (_, startSlot) =>
    traceAmidakuji(slots, rows, bars, startSlot),
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
  const byRow = groupBarsByRow(bars);
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

export function renderAmidakujiPng(
  ladder: AmidakujiLadder,
  hiddenOrOptions: boolean | AmidakujiRenderOptions,
): Buffer {
  const options: AmidakujiRenderOptions =
    typeof hiddenOrOptions === 'boolean' ? { hidden: hiddenOrOptions } : hiddenOrOptions;
  const theme = normalizeTheme(options.theme);
  const palette = themePalette(theme);
  const hidden = options.hidden === true;
  const hiddenPercent = clamp(options.hiddenPercent ?? 42, 20, 70);
  const revealProgress = clampFloat(options.revealProgress ?? 0, 0, 1);
  const marginX = 52;
  const top = 64;
  const bottom = 430;
  const width = Math.max(440, marginX * 2 + (ladder.slots - 1) * 72);
  const height = 486;
  const pixels = Buffer.alloc(width * height * 4);
  fillRect(pixels, width, height, 0, 0, width, height, palette.background);

  for (let y = 0; y < height; y += 24) {
    fillRect(pixels, width, height, 0, y, width, 1, palette.grid);
  }
  for (let x = 0; x < width; x += 24) {
    fillRect(pixels, width, height, x, 0, 1, height, palette.grid);
  }

  const xFor = (column: number) =>
    Math.round(marginX + (column * (width - marginX * 2)) / (ladder.slots - 1));
  const rowHeight = (bottom - top) / ladder.rows;

  for (let column = 0; column < ladder.slots; column += 1) {
    const x = xFor(column);
    fillRect(pixels, width, height, x - 14, 25, 28, 28, palette.slotFill);
    fillRect(pixels, width, height, x - 14, 444, 28, 28, palette.slotFill);
    drawLine(pixels, width, height, x, top, x, bottom, palette.rail, 4);
    drawDigitNumber(pixels, width, height, x, 30, column + 1, palette.text);
    drawDigitNumber(pixels, width, height, x, 449, column + 1, palette.text);
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
      palette.bar,
      5,
    );
  }

  for (const start of options.highlightStarts ?? []) {
    if (!Number.isInteger(start) || start < 0 || start >= ladder.slots) continue;
    drawPath(pixels, width, height, ladder, start, xFor, top, rowHeight, PATH_COLORS[start % PATH_COLORS.length]!);
  }

  if (hidden) {
    const fullMaskHeight = Math.round((bottom - top) * (hiddenPercent / 100));
    const currentMaskHeight = Math.round(fullMaskHeight * (1 - revealProgress));
    if (currentMaskHeight > 0) {
      const maskTop = Math.round((top + bottom - currentMaskHeight) / 2);
      fillRect(
        pixels,
        width,
        height,
        14,
        maskTop,
        width - 28,
        currentMaskHeight,
        palette.mask,
      );
      drawBorder(pixels, width, height, 14, maskTop, width - 28, currentMaskHeight, palette.maskBorder, 2);
      const centerX = Math.floor(width / 2);
      drawQuestionMark(pixels, width, height, centerX, Math.floor(maskTop + currentMaskHeight / 2), palette.maskText);
    }
  }

  drawBorder(pixels, width, height, 8, 8, width - 16, height - 16, palette.frame, 2);
  return encodePng(width, height, pixels);
}

function drawPath(
  pixels: Buffer,
  width: number,
  height: number,
  ladder: AmidakujiLadder,
  start: number,
  xFor: (column: number) => number,
  top: number,
  rowHeight: number,
  color: Rgba,
) {
  const byRow = groupBarsByRow(ladder.bars);
  let column = start;
  let previousY = top;
  for (let row = 0; row < ladder.rows; row += 1) {
    const y = Math.round(top + (row + 0.5) * rowHeight);
    drawLine(pixels, width, height, xFor(column), previousY, xFor(column), y, color, 3);
    for (const bar of byRow.get(row) ?? []) {
      if (bar.left === column) {
        drawLine(pixels, width, height, xFor(column), y, xFor(column + 1), y, color, 3);
        column += 1;
        break;
      }
      if (bar.left + 1 === column) {
        drawLine(pixels, width, height, xFor(column), y, xFor(column - 1), y, color, 3);
        column -= 1;
        break;
      }
    }
    previousY = y;
  }
  drawLine(pixels, width, height, xFor(column), previousY, xFor(column), 430, color, 3);
}

function groupBarsByRow(bars: readonly AmidakujiBar[]): Map<number, AmidakujiBar[]> {
  const byRow = new Map<number, AmidakujiBar[]>();
  for (const bar of bars) {
    const rowBars = byRow.get(bar.row) ?? [];
    rowBars.push(bar);
    byRow.set(bar.row, rowBars);
  }
  return byRow;
}

function normalizeComplexity(value: AmidakujiComplexity | undefined): AmidakujiComplexity {
  return value === 'simple' || value === 'chaos' ? value : 'standard';
}

function normalizeTheme(value: AmidakujiTheme | undefined): AmidakujiTheme {
  return value === 'midnight' || value === 'classic' ? value : 'arcade';
}

function themePalette(theme: AmidakujiTheme) {
  if (theme === 'classic') {
    return {
      background: [250, 250, 249, 255] as Rgba,
      grid: [231, 229, 228, 255] as Rgba,
      frame: [120, 113, 108, 255] as Rgba,
      rail: [68, 64, 60, 255] as Rgba,
      bar: [37, 99, 235, 255] as Rgba,
      slotFill: [231, 229, 228, 255] as Rgba,
      text: [28, 25, 23, 255] as Rgba,
      mask: [214, 211, 209, 255] as Rgba,
      maskBorder: [120, 113, 108, 255] as Rgba,
      maskText: [87, 83, 78, 255] as Rgba,
    };
  }
  if (theme === 'midnight') {
    return {
      background: [9, 14, 28, 255] as Rgba,
      grid: [18, 29, 52, 255] as Rgba,
      frame: [71, 85, 105, 255] as Rgba,
      rail: [148, 163, 184, 255] as Rgba,
      bar: [96, 165, 250, 255] as Rgba,
      slotFill: [30, 41, 59, 255] as Rgba,
      text: [241, 245, 249, 255] as Rgba,
      mask: [15, 23, 42, 255] as Rgba,
      maskBorder: [100, 116, 139, 255] as Rgba,
      maskText: [148, 163, 184, 255] as Rgba,
    };
  }
  return {
    background: [17, 12, 35, 255] as Rgba,
    grid: [37, 28, 72, 255] as Rgba,
    frame: [168, 85, 247, 255] as Rgba,
    rail: [196, 181, 253, 255] as Rgba,
    bar: [34, 211, 238, 255] as Rgba,
    slotFill: [49, 36, 88, 255] as Rgba,
    text: [250, 245, 255, 255] as Rgba,
    mask: [45, 31, 78, 255] as Rgba,
    maskBorder: [217, 70, 239, 255] as Rgba,
    maskText: [232, 121, 249, 255] as Rgba,
  };
}

function drawQuestionMark(
  pixels: Buffer,
  width: number,
  height: number,
  cx: number,
  cy: number,
  color: Rgba,
) {
  fillRect(pixels, width, height, cx - 16, cy - 25, 24, 6, color);
  fillRect(pixels, width, height, cx + 4, cy - 19, 6, 18, color);
  fillRect(pixels, width, height, cx - 8, cy - 6, 18, 6, color);
  fillRect(pixels, width, height, cx - 8, cy, 6, 12, color);
  fillRect(pixels, width, height, cx - 8, cy + 22, 6, 6, color);
}

type Rgba = readonly [number, number, number, number];

function setPixel(pixels: Buffer, width: number, height: number, x: number, y: number, color: Rgba) {
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

function drawBorder(
  pixels: Buffer,
  width: number,
  height: number,
  x: number,
  y: number,
  rectWidth: number,
  rectHeight: number,
  color: Rgba,
  thickness: number,
) {
  fillRect(pixels, width, height, x, y, rectWidth, thickness, color);
  fillRect(pixels, width, height, x, y + rectHeight - thickness, rectWidth, thickness, color);
  fillRect(pixels, width, height, x, y, thickness, rectHeight, color);
  fillRect(pixels, width, height, x + rectWidth - thickness, y, thickness, rectHeight, color);
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function clampFloat(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}