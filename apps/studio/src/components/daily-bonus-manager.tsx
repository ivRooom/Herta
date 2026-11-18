'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { currentDailyBonusDate, dailyBonusReferenceRate } from '@/lib/daily-bonus-admin-input';

interface Announcement {
  target_date: string;
  status: string;
  message_id: string | null;
  error_code: string | null;
  claims: number;
  eligible_count: number | null;
  eligible_captured_at: string | null;
  confirmed: number;
}
export function DailyBonusManager({ guildId }: { guildId: string }) {
  const [today, setToday] = useState('');
  const [data, setData] = useState<{
      announcements: Announcement[];
    } | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const endpoint = `/api/guilds/${guildId}/daily-bonus`;
  async function load() {
    const response = await fetch(endpoint, { cache: 'no-store' });
    if (!response.ok)
      throw new Error('履歴を取得できません。権限・DBの準備状況を確認してください。');
    setData(await response.json());
  }
  useEffect(() => {
    let active = true;
    setToday(currentDailyBonusDate());
    const timer = window.setInterval(() => setToday(currentDailyBonusDate()), 30000);
    void fetch(endpoint, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('履歴を取得できません。');
        const value = await response.json();
        if (active) setData(value);
      })
      .catch(() => {
        if (active) setError('履歴を取得できません。権限・DBの準備状況を確認してください。');
      });
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [endpoint]);
  async function mutate(body: unknown) {
    setBusy(true);
    setError('');
    try {
      const result = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!result.ok) throw new Error('入力・権限・安全な再試行条件を確認してください。');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作に失敗しました。');
    } finally {
      setBusy(false);
    }
  }
  const field = 'rounded border border-white/20 bg-transparent px-3 py-2';
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">デイリーボーナス</h1>
        <p>通知・配信履歴を管理します。</p>
        <Link className="underline" href={`/dashboard/guilds/${guildId}/plugins/daily-bonus`}>
          配信チャンネル・ロール・通知設定を開く
        </Link>
      </header>
      {error && <p role="alert">{error}</p>}
      <section className="space-y-3">
        <h2 className="text-xl">配信履歴</h2>
        <p>
          参考受取率は配信直前の対象ロール保有者（Bot以外）に対する、Discordで確認できた確定受取件数です。ポータルのみの受取は未反映の場合があります。ロール変更等により100%を超える場合があります。対象人数が取得不可・0人の場合は率を表示しません。
        </p>
        {!data ? (
          <p>読み込み中…</p>
        ) : data.announcements.length === 0 ? (
          <p>配信履歴はありません。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr>
                  <th>日付</th>
                  <th>状態</th>
                  <th>配信時対象人数</th>
                  <th>Discordで確認できた受取件数 / 処理件数</th>
                  <th>参考受取率</th>
                  <th>エラー・操作</th>
                </tr>
              </thead>
              <tbody>
                {data.announcements.map((a) => (
                  <tr key={a.target_date}>
                    <td>{a.target_date}</td>
                    <td>{a.status}</td>
                    <td title={a.eligible_captured_at ?? undefined}>
                      {a.eligible_count ?? '取得不可'}
                    </td>
                    <td>
                      {a.confirmed} / {a.claims}
                    </td>
                    <td>{dailyBonusReferenceRate(a.confirmed, a.eligible_count)}</td>
                    <td>
                      {a.error_code}
                      {a.status === 'failed' && !a.message_id && (
                        <button
                          disabled={busy || a.target_date !== today}
                          onClick={() => void mutate({ action: 'retry', date: a.target_date })}
                        >
                          安全に再試行
                        </button>
                      )}
                      {a.status === 'uncertain' && (
                        <button
                          disabled={busy || a.target_date !== today}
                          onClick={() => void mutate({ action: 'reconcile', date: a.target_date })}
                        >
                          Discordメッセージと照合
                        </button>
                      )}
                      {a.status === 'uncertain' && (
                        <p>
                          送信結果未確定。Discord上の実メッセージを照合します。自動再送しません。
                        </p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="space-y-3">
        <h2 className="text-xl">記念日（今日は何の日）</h2>
        <p>
          記念日の登録・審査・公開は Web の管理画面（Today-in-History）へ一本化されました。Studio
          からの登録・編集はできません。
        </p>
        <a
          className="underline"
          href="https://admin.ivrm.jp/today-history"
          target="_blank"
          rel="noreferrer"
        >
          Web 管理画面で記念日を管理する
        </a>
      </section>
    </div>
  );
}
