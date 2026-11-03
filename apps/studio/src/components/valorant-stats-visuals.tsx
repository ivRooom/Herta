import Link from 'next/link';
import type { DrawSample } from '@/lib/valorant-stats';

type FrequencyItem = { name: string; count: number };
const ROLE_LABELS: Record<string, string> = {
  DUELIST: 'デュエリスト',
  CONTROLLER: 'コントローラー',
  INITIATOR: 'イニシエーター',
  SENTINEL: 'センチネル',
  UNKNOWN: '未分類（カスタム/旧Agent）',
};

export function ValorantFrequencyBars({
  title,
  items,
}: {
  title: string;
  items: readonly FrequencyItem[];
}) {
  const top = items.slice(0, 15);
  const maximum = Math.max(1, ...top.map((item) => item.count));
  return (
    <section className="rounded-xl border border-border p-4">
      <h2 className="mb-3 font-semibold">{title}</h2>
      {top.length === 0 ? (
        <p className="text-sm text-muted">集計対象の記録がありません。</p>
      ) : (
        <ol className="space-y-3" aria-label={title + 'の件数グラフ'}>
          {top.map(({ name, count }) => (
            <li key={name} className="space-y-1">
              <div className="flex justify-between gap-3 text-xs">
                <span className="break-all">{ROLE_LABELS[name] ?? name}</span>
                <span className="shrink-0 tabular-nums">{count}回</span>
              </div>
              <div className="h-2 overflow-hidden rounded bg-muted/20">
                <div
                  className="h-full rounded bg-primary/80"
                  style={{ width: ((count / maximum) * 100).toFixed(2) + '%' }}
                />
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function agentIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): string[] =>
    typeof item === 'object' &&
    item !== null &&
    !Array.isArray(item) &&
    typeof item.agentId === 'string'
      ? [item.agentId]
      : [],
  );
}

export function ValorantPickHistory({
  rows,
  page,
  displayNames,
}: {
  rows: readonly DrawSample[];
  page: number;
  displayNames: ReadonlyMap<string, string>;
}) {
  const pages = Math.max(1, Math.ceil(rows.length / 25));
  const current = Number.isInteger(page) ? Math.max(1, Math.min(page, pages)) : 1;
  const visible = rows.slice((current - 1) * 25, current * 25);
  return (
    <section className="rounded-xl border border-border p-4">
      <h2 className="font-semibold">過去の抽選構成（テーブルビュー）</h2>
      <p className="mt-2 text-xs text-muted">
        Guild内完了済み抽選の最新5,000件まで（UTC）。抽選結果と実際の対戦使用Agentは別記録です。
        メンバー識別子は一覧に表示しません。再抽選ごとの過去バージョンは対象外です。
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[620px] text-left text-sm">
          <thead>
            <tr>
              <th scope="col" className="p-2">
                抽選日時（UTC）
              </th>
              <th scope="col" className="p-2">
                モード
              </th>
              <th scope="col" className="p-2">
                マップ
              </th>
              <th scope="col" className="p-2">
                抽選構成
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((item) => (
              <tr key={item.id} className="border-t border-border">
                <td className="whitespace-nowrap p-2">
                  {item.completedAt
                    ? item.completedAt.toISOString().slice(0, 16).replace('T', ' ')
                    : '日時不明'}
                </td>
                <td className="p-2">
                  {item.mode === 'RANDOM'
                    ? '完全ランダム'
                    : item.mode === 'TACTICAL'
                      ? '実戦向け'
                      : 'その他'}
                </td>
                <td className="p-2">{item.mapId ?? '指定なし'}</td>
                <td className="p-2">
                  {agentIds(item.result)
                    .map((id) => displayNames.get(id) ?? id)
                    .join(' / ') || '記録なし'}
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={4} className="p-3 text-muted">
                  履歴がありません。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <nav aria-label="抽選履歴のページ切替" className="mt-4 flex items-center gap-4 text-sm">
        {current > 1 && (
          <Link className="underline" href={'?page=' + (current - 1)}>
            前へ
          </Link>
        )}
        <span className="tabular-nums">
          {current} / {pages} ページ
        </span>
        {current < pages && (
          <Link className="underline" href={'?page=' + (current + 1)}>
            次へ
          </Link>
        )}
      </nav>
    </section>
  );
}
