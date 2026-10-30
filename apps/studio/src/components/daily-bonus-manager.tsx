'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  currentDailyBonusDate,
  newDailyAnniversaryIdentity,
  dailyBonusReferenceRate,
} from '@/lib/daily-bonus-admin-input';

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
interface Event {
  id: string;
  title: string;
  summary: string;
  category: string;
  month: number;
  day: number;
  base_year: number | null;
  work_name: string;
  character_name: string;
  source_url: string;
  source_checked_at: string;
  approved: boolean;
  public: boolean;
  priority: number;
  pinned_date: string | null;
  anniversary_mode: string;
}
interface EventInput {
  id: string;
  title: string;
  summary: string;
  category: string;
  month: number;
  day: number;
  baseYear: number | null;
  workName: string;
  characterName: string;
  sourceUrl: string;
  sourceCheckedAt: string;
  approved: boolean;
  public: boolean;
  priority: number;
  pinnedDate: string | null;
  anniversaryMode: string;
}
const sample: EventInput = {
  id: '',
  title: '',
  summary: '',
  category: 'game',
  month: 1,
  day: 1,
  baseYear: null,
  workName: '',
  characterName: '',
  sourceUrl: 'https://',
  sourceCheckedAt: '',
  approved: false,
  public: false,
  priority: 0,
  pinnedDate: null,
  anniversaryMode: 'annual',
};
export function DailyBonusManager({ guildId }: { guildId: string }) {
  const [today, setToday] = useState('');
  const [data, setData] = useState<{
      announcements: Announcement[];
      anniversaries: Event[];
    } | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [event, setEvent] = useState(sample);
  const endpoint = `/api/guilds/${guildId}/daily-bonus`;
  async function load() {
    const response = await fetch(endpoint, { cache: 'no-store' });
    if (!response.ok)
      throw new Error('履歴を取得できません。権限・DBの準備状況を確認してください。');
    setData(await response.json());
  }
  useEffect(() => {
    let active = true;
    setEvent({ ...sample, ...newDailyAnniversaryIdentity() });
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
        <p>通知・配信履歴と、出典を確認した記念日を管理します。</p>
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
        <h2 className="text-xl">記念日と出典</h2>
        <p>一次資料を確認し、承認・公開の両方を設定した記念日だけ掲載します。</p>
        <ul>
          {data?.anniversaries.map((e) => (
            <li key={e.id}>
              <button
                onClick={() =>
                  setEvent({
                    id: e.id,
                    title: e.title,
                    summary: e.summary,
                    category: e.category,
                    month: e.month,
                    day: e.day,
                    baseYear: e.base_year,
                    workName: e.work_name,
                    characterName: e.character_name,
                    sourceUrl: e.source_url,
                    sourceCheckedAt: e.source_checked_at,
                    approved: e.approved,
                    public: e.public,
                    priority: e.priority,
                    pinnedDate: e.pinned_date,
                    anniversaryMode: e.anniversary_mode,
                  })
                }
              >
                {e.month}/{e.day} {e.title}（{e.approved && e.public ? '公開' : '非公開'}）
              </button>{' '}
              <a href={e.source_url} target="_blank" rel="noreferrer">
                出典を確認
              </a>
            </li>
          ))}
        </ul>
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void mutate({ action: 'save-anniversary', event });
          }}
        >
          {(
            [
              'id',
              'title',
              'summary',
              'workName',
              'characterName',
              'sourceUrl',
              'sourceCheckedAt',
            ] as const
          ).map((key) => (
            <label key={key}>
              {
                {
                  id: '管理ID',
                  title: 'タイトル',
                  summary: '概要',
                  workName: '作品名',
                  characterName: 'キャラクター名',
                  sourceUrl: '出典URL',
                  sourceCheckedAt: '出典確認日時',
                }[key]
              }
              <input
                className={`${field} block w-full`}
                value={event[key]}
                onChange={(e) => setEvent({ ...event, [key]: e.target.value })}
              />
            </label>
          ))}
          <label>
            カテゴリ
            <select
              value={event.category}
              onChange={(e) => setEvent({ ...event, category: e.target.value })}
            >
              {['character', 'game', 'anime', 'manga', 'general', 'community'].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          {(['month', 'day', 'priority'] as const).map((key) => (
            <label key={key}>
              {{ month: '月', day: '日', priority: '優先度' }[key]}
              <input
                className={`${field} block`}
                type="number"
                value={event[key]}
                onChange={(e) => setEvent({ ...event, [key]: Number(e.target.value) })}
              />
            </label>
          ))}
          <label>
            基準年
            <input
              className={field}
              type="number"
              value={event.baseYear ?? ''}
              onChange={(e) =>
                setEvent({ ...event, baseYear: e.target.value ? Number(e.target.value) : null })
              }
            />
          </label>
          <label>
            固定掲載日
            <input
              className={field}
              type="date"
              value={event.pinnedDate ?? ''}
              onChange={(e) => setEvent({ ...event, pinnedDate: e.target.value || null })}
            />
          </label>
          <label>
            周年計算
            <select
              value={event.anniversaryMode}
              onChange={(e) => setEvent({ ...event, anniversaryMode: e.target.value })}
            >
              <option value="annual">毎年の記念日</option>
              <option value="elapsed">基準年からの経過年</option>
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={event.approved}
              onChange={(e) => setEvent({ ...event, approved: e.target.checked })}
            />
            出典を確認し承認
          </label>
          <label>
            <input
              type="checkbox"
              checked={event.public}
              onChange={(e) => setEvent({ ...event, public: e.target.checked })}
            />
            公開可
          </label>
          <button disabled={busy} className={field}>
            保存
          </button>
          <button
            type="button"
            className={field}
            onClick={() => setEvent({ ...sample, ...newDailyAnniversaryIdentity() })}
          >
            新規登録
          </button>
        </form>
        <div className="rounded border border-white/20 p-4">
          <h3>掲載内容プレビュー（ポイント付与なし）</h3>
          <p>
            {event.month}/{event.day} {event.title}
          </p>
          <p>{event.summary}</p>
          <p>{event.sourceUrl}</p>
        </div>
      </section>
    </div>
  );
}
