'use client';

import { useState } from 'react';
import { Download, Link as LinkIcon } from 'lucide-react';
import type { MbtiScores } from '@herta/shared/mbti-core';
import { createMbtiReport, mbtiShareSearch } from '@herta/shared/mbti-report';

export function MbtiResultReport({
  scores,
  roleNote,
  shared = false,
}: {
  scores: MbtiScores;
  roleNote?: string | null;
  shared?: boolean;
}) {
  const report = createMbtiReport(scores);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [shareUrl, setShareUrl] = useState('');

  async function saveImage() {
    if (saving) return;
    setSaving(true);
    setMessage('レポート画像を作成しています…');
    try {
      const { createMbtiReportImage } = await import('@/lib/mbti-report-image');
      const blob = await createMbtiReportImage(scores);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `herta-${report.resultType}-${report.identity}.png`;
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
    url.search = mbtiShareSearch(scores);
    setShareUrl(url.toString());
    try {
      await navigator.clipboard.writeText(url.toString());
      setMessage('共有リンクをコピーしました');
    } catch {
      setMessage('下の共有リンクを選択してコピーしてください');
    }
  }

  return (
    <article className="mbti-report">
      <div className="mbti-report-intro">
        <h2>{shared ? '共有された診断レポート' : 'あなたの診断レポート'}</h2>
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
          </div>
        ))}
      </section>
      {report.sections.map((section) => (
        <section className="mbti-report-section" key={section.title}>
          <h3>{section.title}</h3>
          <ul>
            {section.items.map((item) => (
              <li key={item.axis}>{item.text}</li>
            ))}
          </ul>
        </section>
      ))}
      {roleNote ? <p className="mbti-report-note">{roleNote}</p> : null}
      <p className="mbti-report-disclaimer">{report.disclaimer}</p>
    </article>
  );
}
