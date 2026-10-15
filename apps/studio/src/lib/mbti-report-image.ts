import { createMbtiReport } from '@herta/shared/mbti-report';
import type { MbtiScores } from '@herta/shared/mbti-core';

/** Render the same report as the page, using native canvas and local system fonts. */
export async function createMbtiReportImage(scores: MbtiScores): Promise<Blob> {
  await document.fonts.ready;
  const report = createMbtiReport(scores);
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
  function text(value: string, size = 25, color = '#ccd5e3', bold = false) {
    ctx!.font = `${bold ? 700 : 400} ${size}px ${font}`;
    let line = '';
    for (const char of value) {
      if (
        ctx!.measureText(line + char).width > textWidth - size &&
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
  text(`${report.resultType}-${report.identity}  ${report.title}`, 64, '#f5f6fa', true);
  text(report.identityLabel, 27, '#c9a6f5');
  text(report.summary);
  if (report.boundaryNote) text(report.boundaryNote, 22, '#c9a6f5');
  y += 24;
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
