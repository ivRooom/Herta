import type { DrawSample } from '@/lib/valorant-stats';

type FrequencyItem = { name: string; count: number };

const ROLE_NAMES: Record<string, string> = {
  DUELIST: 'デュエリスト',
  CONTROLLER: 'コントローラー',
  INITIATOR: 'イニシエーター',
  SENTINEL: 'センチネル',
  UNKNOWN: '未分類',
};

const ROLE_COLORS: Record<string, string> = {
  DUELIST: '#ed89d0',
  INITIATOR: '#36cdb9',
  CONTROLLER: '#80a4ff',
  SENTINEL: '#a889fa',
  UNKNOWN: '#9ca3af',
};

export function ValorantCompactBars({
  title,
  description,
  items,
  limit = 5,
}: {
  title: string;
  description: string;
  items: readonly FrequencyItem[];
  limit?: number;
}) {
  const top = items.slice(0, limit);
  const max = Math.max(1, ...top.map((item) => item.count));
  return (
    <section className="valorant-panel rounded-2xl p-4 sm:p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="mt-1 text-xs text-muted">{description}</p>
      {top.length === 0 ? (
        <p className="mt-5 text-sm text-muted">対象の記録がありません。</p>
      ) : (
        <ol className="mt-4 space-y-3" aria-label={title}>
          {top.map((item, index) => (
            <li key={item.name}>
              <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
                <span className="min-w-0 truncate">
                  <span className="mr-2 text-violet-300">{index + 1}</span>
                  {item.name}
                </span>
                <span className="shrink-0 tabular-nums text-violet-200">{item.count}回</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-violet-100/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-violet-600 via-violet-400 to-fuchsia-400"
                  style={{ width: ((item.count / max) * 100).toFixed(2) + '%' }}
                />
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function ValorantRoleDonut({ items }: { items: readonly FrequencyItem[] }) {
  const total = items.reduce((sum, item) => sum + item.count, 0);
  const circumference = 2 * Math.PI * 48;
  let position = 0;
  const segments = items.map((item) => {
    const length = total ? (item.count / total) * circumference : 0;
    const segment = { ...item, length, position };
    position += length;
    return segment;
  });
  return (
    <section className="valorant-panel rounded-2xl p-4 sm:p-5">
      <h2 className="text-sm font-semibold">ロールの選出分布</h2>
      <p className="mt-1 text-xs text-muted">選ばれたAgent人数の割合（抽選回数ではありません）</p>
      {total === 0 ? (
        <p className="mt-5 text-sm text-muted">対象の記録がありません。</p>
      ) : (
        <div className="mt-4 flex flex-col items-center gap-3 sm:flex-row">
          <svg
            viewBox="0 0 128 128"
            className="h-32 w-32 shrink-0"
            role="img"
            aria-label="ロールの選出割合。正確な数値は隣の一覧に表示"
          >
            <circle cx="64" cy="64" r="48" fill="none" stroke="#293251" strokeWidth="17" />
            {segments.map((item) => (
              <circle
                key={item.name}
                cx="64"
                cy="64"
                r="48"
                fill="none"
                stroke={ROLE_COLORS[item.name] ?? ROLE_COLORS.UNKNOWN}
                strokeWidth="17"
                strokeDasharray={item.length + ' ' + (circumference - item.length)}
                strokeDashoffset={-item.position}
                transform="rotate(-90 64 64)"
              />
            ))}
            <text x="64" y="56" textAnchor="middle" fill="#a4acc8" fontSize="10">
              選出合計
            </text>
            <text x="64" y="81" textAnchor="middle" fill="#fff" fontSize="24" fontWeight="bold">
              {total}
            </text>
          </svg>
          <ul className="w-full min-w-0 flex-1 space-y-2 text-xs">
            {items.map((item) => (
              <li key={item.name} className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: ROLE_COLORS[item.name] ?? ROLE_COLORS.UNKNOWN }}
                    aria-hidden="true"
                  />
                  <span className="truncate">{ROLE_NAMES[item.name] ?? item.name}</span>
                </span>
                <span className="shrink-0 tabular-nums text-muted">
                  {((item.count / total) * 100).toFixed(1)}% · {item.count}回
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function selectedAgents(value: unknown, labels: ReadonlyMap<string, string>) {
  if (!Array.isArray(value)) return '記録なし';
  const names = value.flatMap((item): string[] =>
    item &&
    typeof item === 'object' &&
    !Array.isArray(item) &&
    typeof item.agentId === 'string'
      ? [labels.get(item.agentId) ?? item.agentId]
      : [],
  );
  return names.join(' / ') || '記録なし';
}

export function ValorantHistoryPreview({
  rows,
  labels,
}: {
  rows: readonly DrawSample[];
  labels: ReadonlyMap<string, string>;
}) {
  return (
    <section className="valorant-panel rounded-2xl p-4 sm:p-5" id="valorant-history">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">最近の抽選構成</h2>
        <span className="text-xs text-muted">最新6件 · UTC</span>
      </div>
      <p className="mt-1 text-xs text-muted">
        抽選時の組合せです。試合で実際に使った構成とは異なる場合があります。
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-xs">
          <thead className="text-muted">
            <tr>
              <th scope="col" className="px-2 py-2">日時</th>
              <th scope="col" className="px-2 py-2">マップ</th>
              <th scope="col" className="px-2 py-2">抽選構成</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 6).map((item) => (
              <tr key={item.id} className="border-t border-border/60">
                <td className="whitespace-nowrap px-2 py-2.5 tabular-nums text-muted">
                  {item.completedAt
                    ? item.completedAt.toISOString().slice(5, 16).replace('T', ' ')
                    : '日時不明'}
                </td>
                <td className="whitespace-nowrap px-2 py-2.5">{item.mapId ?? '未指定'}</td>
                <td className="px-2 py-2.5">{selectedAgents(item.result, labels)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={3} className="px-2 py-4 text-muted">履歴がありません。</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
