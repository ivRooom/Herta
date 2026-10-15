import { getMbtiArtwork, MBTI_ARTWORK_URL } from './mbti-artwork';
import { createMbtiReport } from '@herta/shared/mbti-report';
import type { MbtiScores } from '@herta/shared/mbti-core';

/** Render the same report as the page, using native canvas and local system fonts. */
export async function createMbtiReportImage(scores: MbtiScores): Promise<Blob> {
  await document.fonts.ready;
  const report = createMbtiReport(scores);
  const artwork = getMbtiArtwork(report.resultType);
  // Same-origin asset keeps the export canvas readable; a missing asset must never prevent saving.
  let illustration: HTMLImageElement | null = null;
  if (artwork) {
    try {
      illustration = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        const timeout = window.setTimeout(
          () => reject(new Error('画像読み込みタイムアウト')),
          5000,
        );
        image.onload = () => {
          window.clearTimeout(timeout);
          resolve(image);
        };
        image.onerror = () => {
          window.clearTimeout(timeout);
          reject(new Error('画像読み込みエラー'));
        };
        image.src = MBTI_ARTWORK_URL;
      });
    } catch {
      /* Preserve a complete text report if artwork is unavailable. */
    }
  }
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('このブラウザでは画像を作成できません');
  const font = '"Noto Sans JP", "Yu Gothic", Meiryo, sans-serif';
  const width = 1080,
    padding = 72,
    textWidth = width - padding * 2;
  type Line = { text: string; y: number; size: number; color: string; bold: boolean };
  const lines: Line[] = [];
  const bars: { y: number; percent: number }[] = [];
  let y = 80;
  let availableTextWidth = illustration ? 530 : textWidth;
  function text(value: string, size = 25, color = '#ccd5e3', bold = false) {
    ctx!.font = `${bold ? 700 : 400} ${size}px ${font}`;
    let line = '';
    for (const char of value) {
      if (
        ctx!.measureText(line + char).width > availableTextWidth - size &&
        line &&
        !'、。，．！？）」』】…'.includes(char)
      ) {
        lines.push({ text: line, y, size, color, bold });
        y += size * 1.8;
        line = '';
      }
      line += char;
    }
    if (line) {
      lines.push({ text: line, y, size, color, bold });
      y += size * 1.8;
    }
    y += 12;
  }
  text('HERTA MBTI  /  あなたの診断レポート', 24, '#9af3d5', true);
  text(`${report.resultType}-${report.identity}`, 68, artwork?.accent ?? '#9af3d5', true);
  text(report.title, 42, '#f5f6fa', true);
  text(report.identityLabel, 27, '#c9a6f5');
  text(report.summary);
  if (report.boundaryNote) text(report.boundaryNote, 22, '#c9a6f5');
  y = Math.max(y + 24, illustration ? 490 : 0);
  availableTextWidth = textWidth;
  text('5つの軸から見る、あなたらしさ', 34, '#f5f6fa', true);
  for (const axis of report.axes) {
    text(axis.name, 28, '#9af3d5', true);
    text(
      `${axis.labels[0]} ${axis.percent}%  /  ${axis.labels[1]} ${100 - axis.percent}%  ·  ${axis.tendency}`,
      24,
      '#c9a6f5',
    );
    bars.push({ y, percent: axis.percent });
    y += 30;
    text(axis.description);
    y += 15;
  }
  for (const section of report.sections) {
    y += 25;
    text(section.title, 34, '#f5f6fa', true);
    for (const item of section.items) text(`・${item.text}`);
  }
  y += 30;
  text(report.disclaimer, 20, '#9ba9bd');
  canvas.width = width;
  canvas.height = Math.ceil(y + 50);
  ctx.fillStyle = '#101620';
  ctx.fillRect(0, 0, width, canvas.height);
  ctx.fillStyle = '#9af3d5';
  ctx.fillRect(padding, 35, 100, 5);
  for (const bar of bars) {
    ctx.fillStyle = '#c9a6f5';
    ctx.fillRect(padding, bar.y, textWidth, 10);
    ctx.fillStyle = '#9af3d5';
    ctx.fillRect(padding, bar.y, (textWidth * bar.percent) / 100, 10);
  }
  if (illustration && artwork) {
    const tileWidth = illustration.naturalWidth / 4;
    const tileHeight = illustration.naturalHeight / 4;
    const layer = document.createElement('canvas');
    layer.width = layer.height = 360;
    const layerContext = layer.getContext('2d');
    if (layerContext) {
      layerContext.drawImage(
        illustration,
        artwork.column * tileWidth,
        artwork.row * tileHeight,
        tileWidth,
        tileHeight,
        0,
        0,
        360,
        360,
      );
      const fade = layerContext.createLinearGradient(0, 0, 0, 360);
      fade.addColorStop(0.94, '#000');
      fade.addColorStop(0.99, 'transparent');
      layerContext.globalCompositeOperation = 'destination-in';
      layerContext.fillStyle = fade;
      layerContext.fillRect(0, 0, 360, 360);
      ctx.drawImage(layer, width - padding - 360, 95);
    }
  }
  ctx.textBaseline = 'top';
  for (const line of lines) {
    ctx.font = `${line.bold ? 700 : 400} ${line.size}px ${font}`;
    ctx.fillStyle = line.color;
    ctx.fillText(line.text, padding, line.y);
  }
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('画像の生成に失敗しました'))),
      'image/png',
    ),
  );
}
