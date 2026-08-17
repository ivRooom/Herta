interface RuleExecutionHistoryEntry {
  id: string;
  ruleId: string;
  ruleName: string;
  triggerType: string;
  triggerExecutionId: string | null;
  conditionsMet: boolean;
  actionsResult: unknown;
  error: string | null;
  durationMs: number | null;
  executedAt: string;
}

export function RuleExecutionHistory({ entries }: { entries: RuleExecutionHistoryEntry[] }) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Rule Engine</p>
        <h2 className="mt-1 text-xl font-semibold">実行履歴</h2>
        <p className="mt-1 text-sm leading-6 text-muted">
          production Ruleの条件判定、cooldown・authorizationによるskip、Role Lifecycle
          Actionの結果を確認できます。
        </p>
      </div>

      {entries.length === 0 ? (
        <div className="mt-5 rounded-xl border border-dashed border-border bg-background px-4 py-8 text-center text-sm text-muted">
          Ruleの実行履歴はまだありません。
        </div>
      ) : (
        <div className="mt-5 overflow-x-auto rounded-xl border border-border">
          <table className="min-w-full divide-y divide-border text-left text-sm">
            <thead className="bg-background text-xs text-muted">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Rule
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Trigger
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  結果
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  実行日時
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {entries.map((entry) => {
                const result = summarizeExecution(entry);
                return (
                  <tr key={entry.id} className="align-top">
                    <td className="px-4 py-3">
                      <span className="block font-semibold">{entry.ruleName}</span>
                      <code className="mt-1 block text-[10px] text-muted">{entry.ruleId}</code>
                    </td>
                    <td className="px-4 py-3">
                      <code className="text-xs">{entry.triggerType}</code>
                      {entry.triggerExecutionId ? (
                        <code
                          className="mt-1 block max-w-64 truncate text-[10px] text-muted"
                          title={entry.triggerExecutionId}
                        >
                          {entry.triggerExecutionId}
                        </code>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${result.className}`}
                      >
                        {result.label}
                      </span>
                      {result.detail ? (
                        <p className="mt-1 max-w-md text-xs leading-5 text-muted">
                          {result.detail}
                        </p>
                      ) : null}
                      {entry.durationMs !== null ? (
                        <p className="mt-1 text-[10px] text-muted">{entry.durationMs} ms</p>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-muted">
                      <time dateTime={entry.executedAt}>{formatDateTime(entry.executedAt)}</time>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function summarizeExecution(entry: RuleExecutionHistoryEntry): {
  label: string;
  detail: string | null;
  className: string;
} {
  if (entry.error) {
    return {
      label: 'Error',
      detail: entry.error,
      className: 'border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-300',
    };
  }

  const actions = asRecord(entry.actionsResult);
  if (actions?.['reservation'] === true) {
    return {
      label: 'Reserved',
      detail:
        'Action実行前の予約記録です。Bot停止などで最終結果が確定しなかった可能性があるため、自動再実行はしません。',
      className: 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300',
    };
  }

  if (!entry.conditionsMet) {
    return {
      label: 'Condition false',
      detail: 'Triggerは一致しましたがConditionを満たしませんでした。',
      className: 'border-slate-500/30 bg-slate-500/5 text-muted',
    };
  }

  const skipReason =
    typeof actions?.['actionSkipReason'] === 'string' ? actions['actionSkipReason'] : null;
  if (skipReason) {
    return {
      label: 'Skipped',
      detail: formatSkipReason(skipReason),
      className: 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300',
    };
  }

  const actionResults = Array.isArray(actions?.['results']) ? actions['results'] : [];
  const failed = actionResults.find((result) => asRecord(result)?.['success'] === false);
  if (failed) {
    const error = asRecord(failed)?.['error'];
    return {
      label: 'Action failed',
      detail: typeof error === 'string' ? error : 'Actionの実行に失敗しました。',
      className: 'border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-300',
    };
  }

  return {
    label: 'Success',
    detail: 'Role Lifecycle Operationを安全に受け付けました。',
    className: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300',
  };
}

function formatSkipReason(reason: string): string {
  switch (reason) {
    case 'duplicate-event':
      return '同一trigger executionの再配送として重複実行を抑止しました。';
    case 'cooldown':
      return 'Ruleのcooldown期間中のためActionを実行しませんでした。';
    case 'max-executions':
      return 'Ruleの最大実行回数へ到達しています。';
    case 'authorization-denied':
      return 'Rule作成者が現在のOWNER root権限を満たさないため拒否しました。';
    case 'rule-disabled':
      return '評価中にRuleが無効化されたためActionを実行しませんでした。';
    default:
      return reason;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: 'Asia/Tokyo',
  }).format(date);
}
