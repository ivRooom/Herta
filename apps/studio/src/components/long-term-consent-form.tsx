'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

type Props = {
  token: string;
  policyVersion: string;
  initialAccepted: boolean;
  enrollmentEnabled: boolean;
  erasurePending: boolean;
  hasUnrevokedLongTermGrant: boolean;
};

/**
 * Future policy enrollment is an indivisible consent decision.
 * The current 30-day transcription form is intentionally a separate legacy flow
 * until operators publish and approve the new comprehensive privacy policy.
 */
export function LongTermConsentForm(props: Props) {
  const router = useRouter();
  const [accepted, setAccepted] = useState(props.initialAccepted);
  const [pending, setPending] = useState(props.erasurePending);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const active = accepted || props.hasUnrevokedLongTermGrant;
  const canEnroll = props.enrollmentEnabled && !pending;

  async function save(next: boolean) {
    setBusy(true);
    setMessage('');
    try {
      const res = await fetch(`/api/consent/${props.token}/long-term`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accepted: next, policyVersion: props.policyVersion }),
      });
      const data = (await res.json()) as { result?: string; error?: string };
      if (!res.ok) {
        setMessage(data.error ?? '同意の更新に失敗しました。');
      } else if (data.result === 'erasure_requested') {
        setAccepted(false);
        setPending(true);
        setMessage('包括同意を撤回し、データの削除依頼を登録しました。完全消去は検証待ちです。');
        router.refresh();
      } else if (data.result === 'updated') {
        setAccepted(next);
        setMessage(next ? '新しいプライバシーポリシーへの包括同意を記録しました。' : '現在の同意はありません。');
        router.refresh();
      } else {
        setMessage('同意の更新結果を確認できませんでした。');
      }
    } catch {
      setMessage('通信エラーが発生しました。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-10 border border-border bg-surface px-5 py-6">
      <h2 className="text-lg font-semibold">VC Recap新プライバシーポリシーへの包括同意（準備中）</h2>
      <p className="mt-3 text-sm leading-7 text-muted">
        この画面は、現行の30日文字起こし同意とは別の将来機能の案内です。
        新機能が公開されたら、一回の同意で次のすべてを許可します。
      </p>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-muted">
        <li>発言音声の文字起こしと要約の処理</li>
        <li>本文の長期保存：365日まではPostgreSQL、検証後に非公開S3へ移行</li>
        <li>話者別音声の録音と長期保存：収録時点から非公開S3、30日後に低頻度アクセス層へ移行する計画</li>
      </ul>
      <p className="mt-3 text-sm leading-7 text-muted">
        長期保存する本文と音声には通常の自動完全削除期限を設けない計画です。
        閲覧権限はGuildごとに制限され、本人は後から同意を撤回し、保存データの削除を依頼できます。
        一回の撤回で3用途すべての利用を停止します。削除完了は検証後に通知します。
      </p>
      <p className="mt-3 text-sm leading-7 text-muted">
        <Link href="/privacy" className="underline underline-offset-2">
          現在公開されているプライバシーポリシー
        </Link>
        を確認してください。新ポリシーが正式に公開・確認されるまでは同意受付を開始しません。
        旧30日同意、自動同意ロール、管理者設定は新しい包括同意として扱いません。
      </p>
      <p className="mt-3 text-xs leading-6 text-muted">新ポリシー版：{props.policyVersion}</p>
      {!props.enrollmentEnabled ? (
        <p role="status" className="mt-4 text-sm text-muted">
          新ポリシーの公開・安全性確認・運用承認が終わるまで、包括同意の受付を停止しています。
        </p>
      ) : null}
      {pending ? (
        <p role="status" className="mt-3 text-sm text-muted">
          削除依頼を受付済みです。消去完了の検証が終わるまで再同意できません。
        </p>
      ) : null}
      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          disabled={!canEnroll || busy || accepted}
          onClick={() => save(true)}
          className="border border-primary bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-40"
        >
          新ポリシーの3用途すべてに同意する
        </button>
        {active ? (
          <button
            type="button"
            disabled={busy || pending}
            onClick={() => save(false)}
            className="border border-border px-4 py-2 text-sm disabled:opacity-40"
          >
            包括同意を撤回して削除を依頼
          </button>
        ) : null}
      </div>
      {message ? <p role="status" className="mt-4 text-sm">{message}</p> : null}
    </section>
  );
}
