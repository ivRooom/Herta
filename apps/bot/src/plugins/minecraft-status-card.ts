import sharp from 'sharp';

export type MinecraftStatusTone = 'online' | 'offline' | 'attention' | 'unknown';
export type MinecraftServerTone = 'ok' | 'warn' | 'bad' | 'sleep';

export interface MinecraftStatusCardServer {
  name: string;
  stateLabel: string;
  tone: MinecraftServerTone;
}

export interface MinecraftStatusCardModel {
  serverName: string;
  statusText: string;
  statusTone: MinecraftStatusTone;
  connection?: string;
  mode?: string;
  players?: {
    online: number;
    max?: number;
    ratio: number | null;
    namesLine?: string;
  };
  resources?: {
    cpuPercent?: number;
    memoryPercent?: number;
    hostMemoryPercent?: number;
    loadAverage?: string;
  };
  performance?: {
    cpu: MinecraftPerformanceSeries[];
    memory: MinecraftPerformanceSeries[];
  };
  servers?: MinecraftStatusCardServer[];
  uptime?: string;
  version?: string;
  hostLabel?: string;
  backupLabel?: string;
}

export interface MinecraftPerformanceSeries {
  label: string;
  color: string;
  points: (number | null)[];
}

const TONE_COLORS: Record<MinecraftStatusTone, string> = {
  online: '#57f287',
  offline: '#ed4245',
  attention: '#fee75c',
  unknown: '#95a5a6',
};

const SERVER_TONE_COLORS: Record<MinecraftServerTone, string> = {
  ok: '#57f287',
  warn: '#fee75c',
  bad: '#ed4245',
  sleep: '#95a5a6',
};

const TEXT_MAIN = '#e9e7f5';
const TEXT_SUB = '#abb7c9';
const BAR_TRACK = '#2b3245';

function escapeXml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!,
  );
}

function estimateTextWidth(value: string, size: number): number {
  let width = 0;
  for (const char of value) {
    width += char.codePointAt(0)! > 0x2e7f ? size : size * 0.6;
  }
  return width;
}

function barColor(percent: number): string {
  if (percent >= 90) return '#ed4245';
  if (percent >= 75) return '#fee75c';
  return '#57f287';
}

/** Minecraftサーバーの状態カードを PNG で描く（fortune-card と同じ SVG → sharp 方式） */
export async function renderMinecraftStatusCard(model: MinecraftStatusCardModel): Promise<Buffer> {
  const width = 1200;
  const pad = 64;
  const contentWidth = width - pad * 2;
  const parts: string[] = [];
  let y = 0;

  const text = (value: string, x: number, yy: number, size = 28, color = TEXT_MAIN, weight = '') =>
    `<text x="${x}" y="${yy}" font-size="${size}" fill="${color}"${weight ? ` font-weight="${weight}"` : ''}>${escapeXml(value)}</text>`;

  // ヘッダー: 状態ドット + サーバー名 + 状態
  y += 92;
  const statusColor = TONE_COLORS[model.statusTone];
  parts.push(`<circle cx="${pad + 16}" cy="${y - 14}" r="16" fill="${statusColor}"/>`);
  parts.push(text(model.serverName, pad + 52, y, 44, TEXT_MAIN, 'bold'));
  const statusX = pad + 52 + estimateTextWidth(model.serverName, 44) + 30;
  parts.push(text(model.statusText, statusX, y, 34, statusColor, 'bold'));

  // 接続先・モード
  const subParts = [
    model.connection ? `接続先 ${model.connection}` : null,
    model.mode ?? null,
  ].filter((v): v is string => typeof v === 'string' && v.length > 0);
  if (subParts.length > 0) {
    y += 44;
    parts.push(text(subParts.join('  ·  '), pad, y, 26, TEXT_SUB));
  }

  // プレイヤー
  if (model.players) {
    y += 66;
    parts.push(text('プレイヤー', pad, y, 26, TEXT_SUB));
    const maxLabel = typeof model.players.max === 'number' ? ` / ${model.players.max}` : '';
    parts.push(
      text(`${model.players.online}${maxLabel} 人`, pad + 190, y + 8, 46, TEXT_MAIN, 'bold'),
    );
    if (model.players.ratio !== null) {
      y += 30;
      const ratio = Math.min(1, Math.max(0, model.players.ratio));
      const filled = Math.round(ratio * contentWidth);
      parts.push(
        `<rect x="${pad}" y="${y}" width="${contentWidth}" height="24" rx="12" fill="${BAR_TRACK}"/>`,
      );
      if (filled > 0) {
        parts.push(
          `<rect x="${pad}" y="${y}" width="${Math.max(filled, 24)}" height="24" rx="12" fill="#57f287"/>`,
        );
      }
      y += 24;
    }
    if (model.players.namesLine) {
      y += 42;
      parts.push(text(`オンライン: ${model.players.namesLine}`, pad, y, 26, TEXT_SUB));
    }
  }

  // リソース（割合のみ、バーを描画するので桁の多い実数は出さない）
  if (model.resources) {
    const rows: { label: string; percent?: number; suffix?: string }[] = [
      { label: 'CPU', percent: model.resources.cpuPercent },
      { label: 'メモリ', percent: model.resources.memoryPercent },
      { label: 'ホストメモリ', percent: model.resources.hostMemoryPercent },
    ];
    y += 62;
    parts.push(text('リソース', pad, y, 26, TEXT_SUB));
    for (const row of rows) {
      if (typeof row.percent !== 'number') continue;
      y += 52;
      parts.push(text(row.label, pad, y, 28));
      const barX = pad + 210;
      const barWidth = 620;
      const filled = Math.round((Math.min(100, Math.max(0, row.percent)) / 100) * barWidth);
      parts.push(
        `<rect x="${barX}" y="${y - 24}" width="${barWidth}" height="24" rx="12" fill="${BAR_TRACK}"/>`,
      );
      if (filled > 0) {
        parts.push(
          `<rect x="${barX}" y="${y - 24}" width="${Math.max(filled, 24)}" height="24" rx="12" fill="${barColor(row.percent)}"/>`,
        );
      }
      parts.push(
        text(`${Math.round(row.percent)}%`, barX + barWidth + 28, y, 30, TEXT_MAIN, 'bold'),
      );
    }
    if (model.resources.loadAverage) {
      y += 44;
      parts.push(text(`Load ${model.resources.loadAverage}`, pad, y, 24, TEXT_SUB));
    }
  }

  // パフォーマンスグラフ（直近30分の推移、タスクマネージャー風）
  if (
    model.performance &&
    (model.performance.cpu.length > 0 || model.performance.memory.length > 0)
  ) {
    y += 62;
    parts.push(text('パフォーマンス（直近30分）', pad, y, 26, TEXT_SUB));
    const charts: { label: string; series: MinecraftPerformanceSeries[] }[] = [
      { label: 'CPU', series: model.performance.cpu },
      { label: 'メモリ', series: model.performance.memory },
    ];
    for (const chart of charts) {
      if (chart.series.length === 0) continue;
      y += 46;
      parts.push(text(chart.label, pad, y, 28));
      const plotX0 = pad + 52;
      const plotX1 = width - pad;
      const plotTop = y + 12;
      const plotHeight = 92;
      for (const gridValue of [0, 50, 100]) {
        const gridY = plotTop + plotHeight - (gridValue / 100) * plotHeight;
        parts.push(
          `<line x1="${plotX0}" y1="${gridY}" x2="${plotX1}" y2="${gridY}" stroke="${BAR_TRACK}" stroke-width="1"/>`,
        );
        parts.push(text(String(gridValue), pad, gridY + 7, 20, TEXT_SUB));
      }
      for (const series of chart.series) {
        const count = series.points.length;
        if (count < 2) continue;
        let segment: string[] = [];
        const flush = () => {
          if (segment.length > 1) {
            parts.push(
              `<polyline points="${segment.join(' ')}" fill="none" stroke="${series.color}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`,
            );
          }
          segment = [];
        };
        series.points.forEach((value, index) => {
          if (value === null || !Number.isFinite(value)) {
            flush();
            return;
          }
          const px = plotX0 + (index / (count - 1)) * (plotX1 - plotX0);
          const py = plotTop + plotHeight - (Math.min(100, Math.max(0, value)) / 100) * plotHeight;
          segment.push(`${px.toFixed(1)},${py.toFixed(1)}`);
        });
        flush();
      }
      y = plotTop + plotHeight + 8;
    }
    // 凡例（CPU・メモリ両方に現れる系列を重複なく並べる）
    const legend = new Map<string, string>();
    for (const chart of charts) {
      for (const series of chart.series) legend.set(series.label, series.color);
    }
    if (legend.size > 0) {
      y += 30;
      let legendX = pad;
      for (const [label, color] of legend) {
        parts.push(`<circle cx="${legendX + 9}" cy="${y - 8}" r="9" fill="${color}"/>`);
        parts.push(text(label, legendX + 28, y, 24, TEXT_SUB));
        legendX += 28 + estimateTextWidth(label, 24) + 36;
      }
    }
  }

  // サーバー状態
  if (model.servers && model.servers.length > 0) {
    y += 62;
    parts.push(text('サーバー状態', pad, y, 26, TEXT_SUB));
    for (const server of model.servers) {
      y += 50;
      parts.push(
        `<circle cx="${pad + 12}" cy="${y - 10}" r="12" fill="${SERVER_TONE_COLORS[server.tone]}"/>`,
      );
      parts.push(text(server.name, pad + 44, y, 28, TEXT_MAIN, 'bold'));
      parts.push(text(server.stateLabel, pad + 470, y, 28, TEXT_SUB));
    }
  }

  // メタ情報
  const metaLines: string[] = [];
  const meta1 = [
    model.uptime ? `稼働時間 ${model.uptime}` : null,
    model.version ? `バージョン ${model.version}` : null,
  ].filter((v): v is string => v !== null);
  if (meta1.length > 0) metaLines.push(meta1.join('  ·  '));
  if (model.hostLabel) metaLines.push(`ホスト ${model.hostLabel}`);
  if (model.backupLabel) metaLines.push(`最新バックアップ ${model.backupLabel}`);
  for (const line of metaLines) {
    y += 46;
    parts.push(text(line, pad, y, 25, TEXT_SUB));
  }

  const height = y + 56;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="${width}" height="${height}" rx="36" fill="#101620"/>
    <rect x="20" y="20" width="${width - 40}" height="${height - 40}" rx="28" fill="none" stroke="${statusColor}" stroke-width="2"/>
    <g font-family="Noto Sans CJK JP, Noto Sans JP, Yu Gothic, sans-serif">
    ${parts.join('\n    ')}
    </g></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
