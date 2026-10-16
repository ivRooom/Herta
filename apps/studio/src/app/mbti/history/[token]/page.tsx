import '../../mbti.css';
import type { Metadata } from 'next';
import type { CSSProperties } from 'react';
import { getMbtiPersonalHistory, getMbtiPersonalResult, resolveMbtiResultAccess } from '@herta/db';
import {
  MBTI_SCORING_VERSION,
  MBTI_TYPES,
  createEmptyMbtiScores,
  type MbtiScores,
} from '@herta/shared/mbti-core';
import { MbtiQuizLayout } from '@/components/mbti-quiz-layout';
import { MbtiResultReport } from '@/components/mbti-result-report';
import { prisma } from '@/lib/db';
import { mbtiHistorySourceLabel } from '@/lib/mbti-history';
import { readMbtiHistoryPercentages } from '@/lib/mbti-history';
import { compareMbtiHistory, HISTORY_AXES, HISTORY_AXIS_LABELS } from '@/lib/mbti-history';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'わたしの診断ノート | Herta',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
const date = (d: Date) =>
  new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d);

export default async function MbtiHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ result?: string; compare?: string; before?: string; view?: string }>;
}) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  const subject = await resolveMbtiResultAccess(prisma, token);
  if (!subject)
    return (
      <MbtiQuizLayout>
        <section className="mbti-history-intro">
          <h2>リンクの有効期限が切れたか、無効になっています</h2>
          <p>Discordで /mbti-result を実行して新しいURLを発行してください。</p>
        </section>
      </MbtiQuizLayout>
    );
  const [latest, requested, rows, total] = await Promise.all([
    getMbtiPersonalResult(prisma, subject),
    query.result ? getMbtiPersonalResult(prisma, subject, query.result) : Promise.resolve(null),
    getMbtiPersonalHistory(prisma, subject, query.before),
    prisma.mbtiPersonalResult.count({ where: subject }),
  ]);
  const selected = query.result ? requested : latest;
  if (!latest || !selected)
    return (
      <MbtiQuizLayout>
        <h2>診断結果が見つかりません</h2>
        <p>Discordで /mbti-result を実行して確認してください。</p>
      </MbtiQuizLayout>
    );
  const previous = query.compare
    ? await getMbtiPersonalResult(prisma, subject, query.compare)
    : await prisma.mbtiPersonalResult.findFirst({
        where: {
          ...subject,
          source: { not: 'correction' },
          scoringVersion: selected.scoringVersion,
          OR: [
            { completedAt: { lt: selected.completedAt } },
            { completedAt: selected.completedAt, id: { lt: selected.id } },
          ],
        },
        orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
      });
  const comparison =
    previous && previous.id !== selected.id ? compareMbtiHistory(selected, previous) : null;
  const strongest = comparison
    ? [...comparison].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0]
    : null;
  const visible = rows.slice(0, 20);
  const link = (result: string, extra?: { before?: string }) => {
    const search = new URLSearchParams({ result, ...extra });
    return `/mbti/history/${token}?${search}`;
  };
  const scores = readScores(selected.scores);
  const estimated =
    selected.source === 'estimate' && selected.scoringVersion === 'historical-estimate-v1'
      ? readMbtiHistoryPercentages(selected.percentages)
      : null;
  return (
    <MbtiQuizLayout>
      <section className="mbti-history-intro">
        <p className="mbti-history-eyebrow">MY PERSONALITY JOURNAL</p>
        <h2>わたしの診断ノート</h2>
        <p>変わる日も、変わらない日も。あなたの傾向を、少しずつ知っていこう。</p>
        <div className="mbti-history-summary">
          <span>
            最新{' '}
            <strong>
              {latest.resultType}-{latest.resultIdentity}
            </strong>
          </span>
          <span>
            記録 <strong>{total}回</strong>
          </span>
          <span>
            最終診断 <strong>{date(latest.completedAt)}</strong>
          </span>
        </div>
        <p className="mbti-report-note">
          本人向けのページです。URLは30分有効で、再発行すると以前のURLは無効になります。履歴URLは共有しないでください。
        </p>
      </section>
      <section className="mbti-history-card" id="history">
        <h2>これまでのわたし</h2>
        <p>診断を選ぶと、その日の詳細レポートと比較を表示します。</p>
        <ol className="mbti-history-list">
          {visible.map((row) => (
            <li key={row.id}>
              <a
                href={link(row.id, query.before ? { before: query.before } : undefined)}
                aria-current={row.id === selected.id ? 'true' : undefined}
              >
                <time dateTime={row.completedAt.toISOString()}>{date(row.completedAt)}</time>
                <strong>
                  {row.resultType}-{row.resultIdentity}
                </strong>
                <span>
                  {row.id === latest.id ? '最新 · ' : ''}
                  {mbtiHistorySourceLabel(row.source, row.questionCount)}
                </span>
              </a>
            </li>
          ))}
        </ol>
        <nav className="mbti-history-nav" aria-label="履歴ページ">
          {query.before ? <a href={link(selected.id)}>新しい履歴へ</a> : null}
          {rows.length > 20 ? (
            <a href={link(selected.id, { before: visible[visible.length - 1]!.id })}>
              さらに前の履歴
            </a>
          ) : null}
        </nav>
      </section>
      <section className="mbti-history-card">
        <h2>あの頃と比べてみる</h2>
        <p>
          選択中：{date(selected.completedAt)} · {selected.resultType}-{selected.resultIdentity}
        </p>
        <form className="mbti-history-form">
          <input type="hidden" name="result" value={selected.id} />
          {query.before ? <input type="hidden" name="before" value={query.before} /> : null}
          <label htmlFor="compare">比較する診断</label>
          <select id="compare" name="compare" defaultValue={query.compare ?? ''}>
            <option value="">前回の診断（同じ採点方式）</option>
            {visible
              .filter((r) => r.id !== selected.id)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {date(r.completedAt)} · {r.resultType}-{r.resultIdentity}
                </option>
              ))}
          </select>
          <button type="submit">比較する</button>
        </form>
        {comparison && previous ? (
          <>
            <p className="mbti-history-insight">
              {previous.resultType}-{previous.resultIdentity} → {selected.resultType}-
              {selected.resultIdentity}。
              {strongest && strongest.delta !== 0
                ? `最も変化したのは${HISTORY_AXIS_LABELS[strongest.axis][strongest.delta > 0 ? 0 : 1]}側への${Math.abs(strongest.delta)}ポイント。`
                : '5つの指標は前回と同じです。'}
            </p>
            <p className="mbti-report-note">
              比較対象：{date(previous.completedAt)}
              。値は各軸の左側の傾向（%）です。薄い線が比較対象、丸印が選択中です。
            </p>
            <div className="mbti-history-axes">
              {comparison.map((item) => (
                <div key={item.axis}>
                  <div className="mbti-history-axis-label">
                    <span>{HISTORY_AXIS_LABELS[item.axis][0]}</span>
                    <strong>
                      {item.delta > 0 ? '+' : ''}
                      {item.delta} pt{item.crossed ? ' · 境界をまたぐ変化' : ''}
                    </strong>
                    <span>{HISTORY_AXIS_LABELS[item.axis][1]}</span>
                  </div>
                  <div
                    className="mbti-history-track"
                    style={
                      {
                        '--current': `${100 - item.current}%`,
                        '--previous': `${100 - item.previous}%`,
                      } as CSSProperties
                    }
                  >
                    <span className="mbti-history-before" />
                    <span className="mbti-history-now" />
                  </div>
                  <p className="mbti-report-note">
                    比較対象 {item.previous}% → 選択中 {item.current}%
                  </p>
                </div>
              ))}
            </div>
            <p className="mbti-report-note">
              変化は成長や優劣の点数ではありません。出題の違い・気分・生活環境も回答に影響します。50%付近では少しの差でタイプが変わります。
            </p>
          </>
        ) : (
          <p>
            {previous
              ? '同じ診断、または採点方式が異なるため数値の差は表示しません。別の診断を選んでください。'
              : '次の診断から、過去の結果と5つの指標を比較できます。'}
          </p>
        )}
      </section>
      <h2 id="report" className="mbti-history-report-heading">
        {date(selected.completedAt)} の詳細レポート
      </h2>
      {selected.source === 'estimate' ? (
        <section className="mbti-history-card">
          <h2>
            {selected.resultType} · {MBTI_TYPES[selected.resultType]?.title}（推定スコア）
          </h2>
          <p>
            本人の依頼により、過去の診断の各指標の強さを保ち、指定されたタイプの方向へ合わせた参考値です。回答から測定した値ではなく、診断精度を保証する推定ではありません。
          </p>
          {estimated ? (
            <dl>
              {HISTORY_AXES.map((axis) => (
                <div key={axis}>
                  <dt>
                    {HISTORY_AXIS_LABELS[axis][0]} ／ {HISTORY_AXIS_LABELS[axis][1]}
                  </dt>
                  <dd>
                    {estimated[axis]}% ／ {100 - estimated[axis]!}%
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p>推定スコアを読み込めません。</p>
          )}
          <p className="mbti-report-note">
            元が50%の指標は、指定タイプ側へ現行採点の最小単位を仮置きしています。A/Tは過去の診断値を保持しています。元の診断・統計は変更せず、この推定値は実測間の数値比較には含めません。
          </p>
          {estimated && scores ? (
            <MbtiResultReport key={selected.id} scores={scores} estimated />
          ) : null}
        </section>
      ) : selected.source === 'correction' ? (
        <section className="mbti-history-card">
          <h2>
            {selected.resultType} · {MBTI_TYPES[selected.resultType]?.title ?? '訂正されたタイプ'}
          </h2>
          <p>
            本人の指定により現在のタイプを訂正した記録です。以前の診断の回答・スコア・統計は変更していません。
          </p>
          <p className="mbti-report-note">
            この記録に診断スコアはなく、数値比較やスコアに基づく詳細レポートの対象にはしません。A/Tは以前の診断値を保持しています。過去の診断を選ぶと、そのときのレポートを確認できます。
          </p>
        </section>
      ) : scores && selected.scoringVersion === MBTI_SCORING_VERSION ? (
        <MbtiResultReport key={selected.id} scores={scores} />
      ) : (
        <p>
          この採点方式の詳細レポートには対応していません。保存時のタイプは {selected.resultType}-
          {selected.resultIdentity} です。
        </p>
      )}
    </MbtiQuizLayout>
  );
}
function readScores(value: unknown): MbtiScores | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const scores = createEmptyMbtiScores();
  for (const axis of HISTORY_AXES) {
    const n = source[axis];
    if (typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > 30) return null;
    scores[axis] = n;
  }
  return scores;
}
