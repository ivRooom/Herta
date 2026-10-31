'use client';

import { useState } from 'react';
import type { VcRecapLongTermChoices } from '@herta/db';

type Props = {
  token: string;
  policyVersion: string;
  initialChoices: VcRecapLongTermChoices;
  enrollmentEnabled: boolean;
  legacyConsent: boolean;
  erasurePending: boolean;
};

// prettier-ignore
export function LongTermConsentForm(props: Props) {
  const [choices, setChoices] = useState(props.initialChoices);
  const [pending, setPending] = useState(props.erasurePending);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const active = Object.values(choices).some(Boolean);
  const canEnroll = props.enrollmentEnabled && props.legacyConsent && !pending;

  async function save(next: VcRecapLongTermChoices) {
    setBusy(true);
    try {
      const res = await fetch(`/api/consent/${props.token}/long-term`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...next, policyVersion: props.policyVersion }),
      });
      const data = (await res.json()) as { result?: string; error?: string };
      if (!res.ok) {
        setMessage(data.error ?? '更新できませんでした');
      } else if (data.result === 'erasure_requested') {
        setChoices({ transcription: false, transcriptLongTerm: false, audioLongTerm: false });
        setPending(true);
        setMessage('同意撤回と削除依頼を登録しました。バックアップを含む完全消去は検証待ちです。');
      } else {
        setChoices(next);
        setMessage('同意設定を更新しました。');
      }
    } catch {
      setMessage('通信エラーが発生しました。');
    } finally {
      setBusy(false);
    }
  }

  const items: Array<{ id: keyof VcRecapLongTermChoices; title: string; detail: string }> = [
    {
      id: 'transcription',
      title: '文字起こし処理',
      detail: '新たな目的別同意。既存の30日保存同意は引き継ぎません。',
    },
    {
      id: 'transcriptLongTerm',
      title: '本文の長期保存',
      detail: '365日間はPostgreSQL、その後はS3に移行する計画。365日は削除期限ではありません。',
    },
    {
      id: 'audioLongTerm',
      title: '話者別音声の録音・長期保存',
      detail: '本人の発言音声をS3に保存する計画。30日後は低頻度アクセス層を検討します。',
    },
  ];
  return (
    <section className="mt-10 border border-border bg-surface px-5 py-6">
      <h2 className="text-lg font-semibold">長期保存・録音への個別同意（準備中）</h2>
      <p className="mt-3 text-sm leading-7 text-muted">
        新機能は未提供です。新たに同意したデータは本人の削除依頼まで保持する計画で、
        VC Recapの閲覧権限を持つGuild管理者が参照する想定です。
        削除済みの文字起こしや過去の録音音声は復元できません。
      </p>
      {!props.enrollmentEnabled ? (
        <p role="status" className="mt-4 text-sm text-muted">
          公式ポリシーの公開・運用審査が終わるまで、同意の受付を停止しています。
        </p>
      ) : null}
      {pending ? (
        <p role="status" className="mt-3 text-sm text-muted">
          削除依頼を受け付けています。消去完了の検証までは新規登録できません。
        </p>
      ) : null}
      <div className="mt-5 space-y-4">
        {items.map((item) => (
          <label key={item.id} className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 accent-primary"
              disabled={!canEnroll || busy}
              checked={choices[item.id]}
              onChange={(event) =>
                setChoices((current) => ({
                  ...current,
                  [item.id]: event.target.checked,
                  ...(item.id === 'transcription' && !event.target.checked
                    ? { transcriptLongTerm: false }
                    : {}),
                }))
              }
            />
            <span>
              <span className="block text-sm font-semibold">{item.title}</span>
              <span className="block text-xs leading-6 text-muted">{item.detail}</span>
            </span>
          </label>
        ))}
      </div>
      {props.enrollmentEnabled && !props.legacyConsent ? (
        <p className="mt-3 text-sm text-muted">先に既存の文字起こし同意を設定してください。</p>
      ) : null}
      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          disabled={!canEnroll || busy || (choices.transcriptLongTerm && !choices.transcription)}
          onClick={() => save(choices)}
          className="border border-primary bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-40"
        >
          選択した3項目を保存
        </button>
        {active && (
          <button
            type="button"
            disabled={busy || pending}
            onClick={() =>
              save({ transcription: false, transcriptLongTerm: false, audioLongTerm: false })
            }
            className="border border-border px-4 py-2 text-sm disabled:opacity-40"
          >
            すべて撤回して削除を依頼
          </button>
        )}
      </div>
      {message && (
        <p role="status" className="mt-4 text-sm">
          {message}
        </p>
      )}
    </section>
  );
}
