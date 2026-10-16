'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  Download,
  Link as LinkIcon,
  Sprout,
  Compass,
  MessagesSquare,
  Sparkles,
} from 'lucide-react';
import { getMbtiArtwork, MBTI_ARTWORK_URL } from '@/lib/mbti-artwork';

import type { MbtiScores } from '@herta/shared/mbti-core';
import { createMbtiReport, mbtiShareSearch } from '@herta/shared/mbti-report';

const SECTION_ICONS = [Sprout, Compass, MessagesSquare, Sparkles];

export function MbtiResultReport({
  scores,
  roleNote,
  shared = false,
  estimated = false,
}: {
  scores: MbtiScores;
  roleNote?: string | null;
  shared?: boolean;
  estimated?: boolean;
}) {
  const reportRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const root = reportRef.current;
    if (!root || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('mbti-in-view');
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.08 },
    );
    root.querySelectorAll('.mbti-report-section').forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);
  const report = createMbtiReport(scores);
  const artwork = getMbtiArtwork(report.resultType);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [shareUrl, setShareUrl] = useState('');

  async function saveImage() {
    if (saving) return;
    setSaving(true);
    setMessage('レポート画像を作成しています…');
    try {
      const { createMbtiReportImage } = await import('@/lib/mbti-report-image');
      const blob = await createMbtiReportImage(scores, estimated);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `herta-${report.resultType}-${report.identity}${estimated ? '-estimated' : ''}.png`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setMessage('画像を作成しました。保存先はブラウザのダウンロードを確認してください。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '画像を保存できませんでした');
    } finally {
      setSaving(false);
    }
  }

  async function copyLink() {
    const url = new URL('/mbti/result', window.location.origin);
    url.search = mbtiShareSearch(scores, estimated);
    setShareUrl(url.toString());
    try {
      await navigator.clipboard.writeText(url.toString());
      setMessage('共有リンクをコピーしました');
    } catch {
      setMessage('下の共有リンクを選択してコピーしてください');
    }
  }

  return (
    <article
      ref={reportRef}
      className="mbti-report"
      style={artwork ? ({ '--mbti-art-accent': artwork.accent } as CSSProperties) : undefined}
    >
      <div className="mbti-report-hero">
        <div className="mbti-report-intro">
          <h2>
            {estimated
              ? '推定スコアの詳細レポート'
              : shared
                ? '共有された診断レポート'
                : 'あなたの診断レポート'}
          </h2>
          {estimated ? (
            <p className="mbti-boundary-note">
              過去結果からの推定です。今回の回答から測定した値ではありません。以下の説明は参考としてご覧ください。
            </p>
          ) : null}
          <p className="mbti-report-type">
            {report.resultType}
            <span>-{report.identity}</span>
          </p>
          <p className="mbti-report-title">
            {report.title} · {report.identityLabel}
          </p>
          <p>{report.summary}</p>
          {report.boundaryNote ? <p className="mbti-boundary-note">{report.boundaryNote}</p> : null}
        </div>
        {artwork ? (
          <div className="mbti-art-stage">
            <span className="mbti-art-spark mbti-art-spark-one" aria-hidden="true">
              ✧
            </span>
            <span className="mbti-art-spark mbti-art-spark-two" aria-hidden="true">
              ♡
            </span>
            <span className="mbti-art-spark mbti-art-spark-three" aria-hidden="true">
              ✦
            </span>
            <div
              className="mbti-type-artwork"
              role="img"
              aria-label={`${report.title}のイメージ：${artwork.description}`}
              data-type={report.resultType}
              style={{
                backgroundImage: `url("${MBTI_ARTWORK_URL}")`,
                backgroundPosition: artwork.position,
              }}
            />
          </div>
        ) : null}
      </div>
      <div className="mbti-report-actions">
        <button type="button" onClick={() => void saveImage()} disabled={saving}>
          <Download aria-hidden="true" />
          {saving ? '画像を作成中…' : '画像で保存'}
        </button>
        <button type="button" onClick={() => void copyLink()}>
          <LinkIcon aria-hidden="true" />
          共有リンクをコピー
        </button>
      </div>
      <p className="mbti-report-message" role="status">
        {message}
      </p>
      {shareUrl ? (
        <label className="mbti-share-field">
          共有リンク
          <input readOnly value={shareUrl} onFocus={(e) => e.currentTarget.select()} />
        </label>
      ) : null}
      <p className="mbti-report-note">
        共有されるのは5軸の結果だけです。名前・Discord情報・個別の回答は含みません。
      </p>
      {!shared ? (
        <p className="mbti-report-note">
          Discordの /mbti-result から保存済みの最新結果・履歴・比較ページを開けます。
        </p>
      ) : null}
      {shared ? (
        <p className="mbti-report-note">
          共有用の結果スナップショットです。診断の完了を証明するものではありません。
        </p>
      ) : null}
      <section className="mbti-report-section">
        <h3>5つの軸から見る、あなたらしさ</h3>
        <p className="mbti-report-note">割合は回答傾向の目安です。左右は優劣を表しません。</p>
        {report.axes.map((axis) => (
          <div className="mbti-report-axis" key={axis.axis}>
            <div className="mbti-axis-heading">
              <h4>{axis.name}</h4>
              <span>{axis.tendency}</span>
            </div>
            <div className="mbti-axis-labels">
              <span>
                {axis.labels[0]} {axis.percent}%
              </span>
              <span>
                {axis.labels[1]} {100 - axis.percent}%
              </span>
            </div>
            <div className="mbti-axis-track" aria-hidden="true">
              <span style={{ width: `${axis.percent}%` }} />
            </div>
            <p>{axis.description}</p>
            <p className="mbti-report-note">
              {axis.sensitive
                ? '1問の答え方が大きく変わると、タイプの境界をまたぐ可能性がある軸です。'
                : '1問分の最大変化だけでは、タイプの境界をまたがない軸です。'}
            </p>
          </div>
        ))}
      </section>
      <section className="mbti-report-section">
        <h3>
          <Compass aria-hidden="true" />
          近いタイプも探してみよう
        </h3>
        <p>
          {report.nearbyTypes.length
            ? report.nearbyTypes.map((type) => `${type.type}（${type.title}）`).join('・')
            : '今回は、1問分の最大変化で4文字のタイプが変わる軸はありませんでした。'}
        </p>
        <p className="mbti-report-note">{report.sensitivityNote}</p>
        <p>
          最近の「友人との時間」「仕事・学び」「一人の時間」を一つずつ思い出し、違う面が出る場面を比べてみましょう。
        </p>
      </section>
      {report.sections.map((section, index) => {
        const Icon = SECTION_ICONS[index] ?? Sparkles;
        return (
          <section className="mbti-report-section" key={section.title}>
            <h3>
              <Icon aria-hidden="true" />
              {section.title}
            </h3>
            <ul>
              {section.items.map((item) => (
                <li key={item.axis}>{item.text}</li>
              ))}
            </ul>
          </section>
        );
      })}
      {roleNote ? <p className="mbti-report-note">{roleNote}</p> : null}
      <p className="mbti-report-disclaimer">{report.disclaimer}</p>
    </article>
  );
}
