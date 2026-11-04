import sharp from 'sharp';

export interface ValorantPicksChartInput {
  scopeLabel: string;
  draws: number;
  truncated: boolean;
  agents: ReadonlyArray<{ label: string; count: number }>;
  roles: ReadonlyArray<{ label: string; count: number }>;
}

let activeRenders = 0;
const xml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!);
const countLabel = (value: number) => Math.max(0, Math.floor(value)).toLocaleString('ja-JP');
const safeLabel = (value: string) => Array.from(value).slice(0, 20).join('');

function bars(
  items: ValorantPicksChartInput['agents'],
  x: number,
  y: number,
  width: number,
  accent: string,
): string {
  const top = items.filter((item) => Number.isFinite(item.count) && item.count > 0).slice(0, 5);
  if (top.length === 0) {
    return `<text x="${x}" y="${y + 42}" font-size="24" fill="#a9aecb">データがありません</text>`;
  }
  const max = Math.max(...top.map((item) => item.count));
  return top
    .map((item, index) => {
      const lineY = y + index * 86;
      const barWidth = Math.max(3, Math.round((item.count / max) * width));
      return `<text x="${x}" y="${lineY}" font-size="23" fill="#f4efff">${xml(safeLabel(item.label))}</text>
        <text x="${x + width}" y="${lineY}" text-anchor="end" font-size="22" fill="#cac5eb">${countLabel(item.count)} 回</text>
        <rect x="${x}" y="${lineY + 12}" width="${width}" height="19" rx="9" fill="#252c48"/>
        <rect x="${x}" y="${lineY + 12}" width="${barWidth}" height="19" rx="9" fill="${accent}"/>`;
    })
    .join('');
}

/** Ephemeral Discord PNG. No user names, IDs, remote assets, or unbounded image queues. */
export async function renderValorantPicksChart(input: ValorantPicksChartInput): Promise<Buffer> {
  if (activeRenders >= 2) throw new Error('ValorantPicksChartBusy');
  activeRenders++;
  try {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="800">
      <rect width="1080" height="800" fill="#11172a"/>
      <rect x="25" y="25" width="1030" height="750" rx="27" fill="#181f38" stroke="#564b83" stroke-width="2"/>
      <g font-family="Noto Sans CJK JP, Noto Sans JP, Yu Gothic, sans-serif">
        <text x="58" y="91" font-size="28" font-weight="bold" fill="#c8aeff">HERTA / VALORANT PICKS</text>
        <text x="58" y="146" font-size="38" font-weight="bold" fill="#ffffff">エージェント抽選分析</text>
        <text x="60" y="190" font-size="22" fill="#bdb5dd">${xml(safeLabel(input.scopeLabel))} · 対象抽選 ${countLabel(input.draws)} 件</text>
        <rect x="48" y="232" width="476" height="465" rx="20" fill="#1f2744"/>
        <rect x="540" y="232" width="490" height="465" rx="20" fill="#1f2744"/>
        <text x="72" y="278" font-size="26" font-weight="bold" fill="#eee9ff">Agent 選出上位 5</text>
        <text x="563" y="278" font-size="26" font-weight="bold" fill="#eee9ff">Role 別 選出回数</text>
        ${bars(input.agents, 74, 334, 420, '#b49aff')}
        ${bars(input.roles, 563, 334, 439, '#65d5c9')}
        <path d="M58 725 H1022" stroke="#544971" stroke-width="1"/>
        <text x="60" y="756" font-size="20" fill="#bdb5dd">勝率ではなく選出回数です · ${input.truncated ? '最新5,000件のみを集計' : '取得した抽選履歴を集計'}</text>
      </g>
    </svg>`;
    const result = await sharp(Buffer.from(svg)).png().toBuffer();
    if (result.length > 8 * 1024 * 1024) throw new Error('ValorantPicksChartTooLarge');
    return result;
  } finally {
    activeRenders--;
  }
}
