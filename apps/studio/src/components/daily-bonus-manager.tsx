'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  currentDailyBonusDate,
  dailyBonusReferenceRate,
  findConflictingSpecialDayRule,
  resolveSpecialDayOverride,
  validDailyBonusDate,
  validMonthDay,
  type SpecialDayRuleInput,
  type SpecialDayRuleView,
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
interface DailyBonusData {
  announcements: Announcement[];
  specialDayRules?: SpecialDayRuleView[];
  specialDayRulesAvailable?: boolean;
}
const emptyRuleForm = {
  id: '',
  kind: 'annual' as 'date' | 'annual',
  exactDate: '',
  monthDay: '',
  title: '',
  intro: '',
  enabled: true,
};
export function DailyBonusManager({ guildId }: { guildId: string }) {
  const [today, setToday] = useState('');
  const [data, setData] = useState<DailyBonusData | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [ruleForm, setRuleForm] = useState(emptyRuleForm);
  const [previewDate, setPreviewDate] = useState('');
  const endpoint = `/api/guilds/${guildId}/daily-bonus`;
  async function load() {
    const response = await fetch(endpoint, { cache: 'no-store' });
    if (!response.ok)
      throw new Error('履歴を取得できません。権限・DBの準備状況を確認してください。');
    setData(await response.json());
  }
  useEffect(() => {
    let active = true;
    const initialToday = currentDailyBonusDate();
    setToday(initialToday);
    setPreviewDate(initialToday);
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
  async function mutate(body: unknown): Promise<boolean> {
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
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作に失敗しました。');
      return false;
    } finally {
      setBusy(false);
    }
  }
  const rules = data?.specialDayRules ?? [];
  const formInput: SpecialDayRuleInput = {
    id: ruleForm.id || undefined,
    kind: ruleForm.kind,
    exactDate: ruleForm.kind === 'date' ? ruleForm.exactDate : null,
    monthDay: ruleForm.kind === 'annual' ? ruleForm.monthDay : null,
    title: ruleForm.title.trim() || null,
    intro: ruleForm.intro.trim() || null,
    enabled: ruleForm.enabled,
  };
  const conflict = findConflictingSpecialDayRule(rules, formInput);
  const formValid =
    (formInput.title !== null || formInput.intro !== null) &&
    (ruleForm.kind === 'date'
      ? validDailyBonusDate(ruleForm.exactDate)
      : validMonthDay(ruleForm.monthDay)) &&
    ruleForm.title.trim().length <= 256 &&
    ruleForm.intro.trim().length <= 1000;
  const preview = previewDate ? resolveSpecialDayOverride(rules, previewDate) : null;
  async function saveRule() {
    const ok = await mutate({
      action: 'save-special-day-rule',
      rule: { ...formInput, id: conflict ? conflict.id : formInput.id },
    });
    if (ok) setRuleForm(emptyRuleForm);
  }
  async function deleteRule(rule: SpecialDayRuleView) {
    const target = rule.kind === 'date' ? rule.exact_date : `毎年 ${rule.month_day}`;
    if (!window.confirm(`特別日ルール（${target}）を削除しますか？`)) return;
    const ok = await mutate({ action: 'delete-special-day-rule', ruleId: rule.id });
    // 編集中のルール自体を削除したら、フォームに残った内容で再作成されないようクリアする。
    if (ok && ruleForm.id === rule.id) setRuleForm(emptyRuleForm);
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
        <h2 className="text-xl">特別日ルール</h2>
        <p>
          09:00のログインボーナス通知のタイトルと冒頭文を、特定の日（個別日）または毎年の日付（年次）で差し替えます。個別日が年次より優先されます。タイトルのリンク先は常に固定です。配信画像とテーマは
          Web のデイリーカレンダー（バンドル）側で管理します。
        </p>
        {data && data.specialDayRulesAvailable === false && (
          <p role="alert">特別日ルールを取得できませんでした。DBの準備状況を確認してください。</p>
        )}
        {!data ? (
          <p>読み込み中…</p>
        ) : rules.length === 0 ? (
          <p>特別日ルールはありません。</p>
        ) : (
          <ul className="space-y-2">
            {rules.map((rule) => (
              <li key={rule.id} className="rounded border border-white/20 p-3">
                <p>
                  {rule.kind === 'date' ? `個別日 ${rule.exact_date}` : `毎年 ${rule.month_day}`}
                  {' ／ '}
                  {rule.enabled ? '有効' : '無効'}
                </p>
                {rule.title && <p>タイトル: {rule.title}</p>}
                {rule.intro && <p>冒頭文: {rule.intro}</p>}
                <div className="space-x-3">
                  <button
                    disabled={busy}
                    onClick={() =>
                      setRuleForm({
                        id: rule.id,
                        kind: rule.kind,
                        exactDate: rule.exact_date ?? '',
                        monthDay: rule.month_day ?? '',
                        title: rule.title ?? '',
                        intro: rule.intro ?? '',
                        enabled: rule.enabled,
                      })
                    }
                  >
                    編集
                  </button>
                  <button disabled={busy} onClick={() => void deleteRule(rule)}>
                    削除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="space-y-2 rounded border border-white/20 p-3">
          <h3>{ruleForm.id ? 'ルールを編集' : 'ルールを追加'}</h3>
          <label className="block">
            種別
            <select
              className={field}
              disabled={busy}
              value={ruleForm.kind}
              onChange={(e) =>
                setRuleForm({ ...ruleForm, kind: e.target.value as 'date' | 'annual' })
              }
            >
              <option value="annual">年次（毎年）</option>
              <option value="date">個別日（1回だけ）</option>
            </select>
          </label>
          {ruleForm.kind === 'date' ? (
            <label className="block">
              日付
              <input
                className={field}
                disabled={busy}
                type="date"
                value={ruleForm.exactDate}
                onChange={(e) => setRuleForm({ ...ruleForm, exactDate: e.target.value })}
              />
            </label>
          ) : (
            <label className="block">
              月日（MM-DD）
              <input
                className={field}
                disabled={busy}
                placeholder="12-25"
                value={ruleForm.monthDay}
                onChange={(e) => setRuleForm({ ...ruleForm, monthDay: e.target.value })}
              />
            </label>
          )}
          <label className="block">
            タイトル（空欄なら通常タイトル）
            <input
              className={field}
              disabled={busy}
              value={ruleForm.title}
              onChange={(e) => setRuleForm({ ...ruleForm, title: e.target.value })}
            />
          </label>
          <label className="block">
            冒頭文（空欄なら通常の冒頭文）
            <textarea
              className={field}
              disabled={busy}
              value={ruleForm.intro}
              onChange={(e) => setRuleForm({ ...ruleForm, intro: e.target.value })}
            />
          </label>
          <label className="block">
            <input
              type="checkbox"
              disabled={busy}
              checked={ruleForm.enabled}
              onChange={(e) => setRuleForm({ ...ruleForm, enabled: e.target.checked })}
            />
            有効
          </label>
          {conflict && (
            <p role="alert">
              同じ対象のルールが既にあります。保存すると、その既存ルールを更新します。
            </p>
          )}
          <div className="space-x-3">
            <button disabled={busy || !formValid} onClick={() => void saveRule()}>
              保存
            </button>
            <button disabled={busy} onClick={() => setRuleForm(emptyRuleForm)}>
              新規入力に戻す
            </button>
          </div>
        </div>
        <div className="space-y-2 rounded border border-white/20 p-3">
          <h3>プレビュー（送信しません）</h3>
          <label className="block">
            日付
            <input
              className={field}
              type="date"
              value={previewDate}
              onChange={(e) => setPreviewDate(e.target.value)}
            />
          </label>
          <p>
            タイトル: {preview?.title ?? `🎁 ${previewDate} 本日のログインボーナス`}
            （Webのマイページへリンクします）
          </p>
          <p>冒頭文: {preview?.intro ?? '（通常の冒頭文が使われます）'}</p>
          <p>
            適用ルール:{' '}
            {preview
              ? preview.source === 'date'
                ? '個別日ルール'
                : '年次ルール'
              : 'なし（通常表示）'}
          </p>
        </div>
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
