import type { ValorantDailyOutcome } from '@/lib/valorant-stats';

type Point = { x: number; y: number };

export function ValorantWinRateTrend({ days }: { days: readonly ValorantDailyOutcome[] }) {
  // The last 14 days with registrations; days without registered outcomes are
  // unknown, not 0% wins. Draw-only days also have no win-rate denominator.
  const visible = days.slice(-14);
  const points: Array<Point | null> = visible.map((day, index) =>
    day.winRate === null
      ? null
      : {
          x: 36 + (visible.length === 1 ? 264 : (index / (visible.length - 1)) * 528),
          y: 164 - day.winRate * 128,
        },
  );
  const segments: Point[][] = [];
  let segment: Point[] = [];
  for (const point of points) {
    if (point) {
      segment.push(point);
    } else if (segment.length) {
      segments.push(segment);
      segment = [];
    }
  }
  if (segment.length) segments.push(segment);

  return (
    <section className="rounded-xl border border-border p-4" aria-labelledby="valorant-winrate-title">
      <h2 id="valorant-winrate-title" className="font-semibold">
        登録日別の勝率推移
      </h2>
      <p className="mt-2 text-xs text-muted">
        登録済み試合の最新14登録日（UTC）。試合日ではなく登録日です。
        勝率＝勝利÷（勝利＋敗北）、引分は勝率の分母から除外します。
        登録のない日は補完せず、引分だけの日は算出不可です。
      </p>
      {visible.length === 0 ? (
        <p className="mt-4 text-sm text-muted">登録済みの試合結果がないため、グラフはありません。</p>
      ) : (
        <>
          <svg
            className="mt-4 h-44 w-full text-primary"
            viewBox="0 0 600 192"
            role="img"
            aria-label="登録日別の勝率推移。正確な日付と件数は下の一覧に表示"
          >
            {[36, 100, 164].map((y) => (
              <line
                key={y}
                x1="36"
                y1={y}
                x2="564"
                y2={y}
                stroke="currentColor"
                strokeOpacity="0.2"
              />
            ))}
            {segments.map((line, index) => (
              <polyline
                key={index}
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinejoin="round"
                strokeLinecap="round"
                points={line.map((point) => point.x + ',' + point.y).join(' ')}
              />
            ))}
            {points.map(
              (point, index) =>
                point && <circle key={index} cx={point.x} cy={point.y} r="5" fill="currentColor" />,
            )}
          </svg>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[400px] text-left text-xs">
              <caption className="pb-2 text-left text-muted">
                登録日の内訳（UTC、最新14登録日）
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="p-2">登録日</th>
                  <th scope="col" className="p-2">勝・敗・分</th>
                  <th scope="col" className="p-2">勝率</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((day) => (
                  <tr key={day.date} className="border-t border-border">
                    <td className="whitespace-nowrap p-2">{day.date}</td>
                    <td className="p-2 tabular-nums">
                      {day.win}勝 / {day.loss}敗 / {day.draw}分
                    </td>
                    <td className="p-2 tabular-nums">
                      {day.winRate === null ? '算出不可' : (day.winRate * 100).toFixed(1) + '%'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
