import type { PluginManifest } from '@herta/shared';

const pluginSetupNotes: Record<string, string[]> = {
  'auto-response': [
    '最初は対象チャンネルを限定して、想定外の自動応答が起きないか確認してください。',
    'Cooldownを設定すると同じトリガーの連続反応を抑えられます。',
  ],
  'birthday-role': [
    'Birthday Roleを使う場合は、Herta BotのRoleを付与対象Roleより上に配置してください。',
    'お祝い投稿を使う場合は通知チャンネルを選択してください。生年は保存されません。',
  ],
  'channel-policy': [
    'Message Content Intentを有効にした環境で利用してください。',
    '新しいルールはlog_onlyから始め、誤検知がないことを確認してからdelete系へ切り替えるのがおすすめです。',
  ],
  'daily-content': [
    '配信先・時刻・Timezoneを最初に設定すると、定期配信の事故を防ぎやすくなります。',
    'ForumやThreadを配信先にする場合は、Discord側の投稿権限も確認してください。',
  ],
  lfg: [
    '募集を投稿するチャンネルと募集の有効期限を先に決めておくと運用しやすくなります。',
  ],
  onboarding: [
    'Welcome / Goodbyeを利用するにはServer Members Intentを有効にしてください。',
    'Auto Roleを使う場合は、Herta BotのRoleを対象Roleより上に配置してください。',
  ],
  quote: ['登録・編集したQuoteはQuote管理画面から確認できます。'],
  'role-manager': [
    'Self Role対象はHerta Botより下のRoleだけを設定してください。',
    'singleグループは排他的、multipleグループは複数選択として動作します。',
  ],
  'team-split': [
    'balancedを使う場合は参加者scoreの入力ルールをサーバー内で統一すると結果が安定します。',
  ],
  reminder: [
    'ReminderはDBへ保存されるため、Bot再起動後も未配信分が維持されます。',
    'DM通知を使う場合、ユーザー側のDM受信設定によっては配信に失敗する場合があります。',
  ],
};

export function PluginSetupOverview({
  manifest,
  enabled,
  config,
}: {
  manifest: PluginManifest;
  enabled: boolean;
  config: Record<string, unknown>;
}) {
  const schema = manifest.configSchema as {
    properties?: Record<string, { title?: string; description?: string; default?: unknown }>;
    required?: string[];
  };
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const commandLabels = manifest.commands.flatMap((command) => {
    const subcommands = command.subcommands ?? [];
    return subcommands.length > 0
      ? subcommands.map((subcommand) => `/${command.name} ${subcommand.name}`)
      : [`/${command.name}`];
  });
  const configuredCount = Object.keys(properties).filter((key) => {
    const value = config[key];
    if (value === null || value === undefined || value === '') return false;
    if (Array.isArray(value)) return value.length > 0;
    return true;
  }).length;
  const notes = pluginSetupNotes[manifest.id] ?? [
    '設定を変更したら保存してからDiscord上で動作を確認してください。',
  ];

  return (
    <section className="mb-6 space-y-4 rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
              設定ガイド
            </span>
            <span
              className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                enabled
                  ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
                  : 'border-border bg-background text-muted'
              }`}
            >
              {enabled ? 'Plugin有効' : 'Plugin無効'}
            </span>
          </div>
          <h2 className="mt-3 text-lg font-semibold">最初に確認すること</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">
            このPluginで使える機能、設定項目、必要な準備をまとめています。下のConfig
            Studioで値を変更できます。
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard
          label="コマンド"
          value={`${commandLabels.length}個`}
          detail="Discordから利用"
        />
        <SummaryCard
          label="設定項目"
          value={`${Object.keys(properties).length}個`}
          detail={`現在 ${configuredCount} 項目に値あり`}
        />
        <SummaryCard
          label="必須設定"
          value={`${required.size}個`}
          detail={required.size > 0 ? 'Schema上のrequired' : '必須項目なし'}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-xl border border-border bg-background/60 p-4">
          <h3 className="text-sm font-semibold">利用できるコマンド</h3>
          {commandLabels.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {commandLabels.map((label) => (
                <code
                  key={label}
                  className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-foreground"
                >
                  {label}
                </code>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted">Slash Commandはありません。</p>
          )}
        </div>

        <div className="rounded-xl border border-border bg-background/60 p-4">
          <h3 className="text-sm font-semibold">権限・準備</h3>
          {manifest.permissions.length > 0 ? (
            <div className="mt-3 space-y-2">
              {manifest.permissions.map((permission) => (
                <div key={permission.id} className="rounded-lg border border-border/70 p-3">
                  <p className="text-sm font-medium">{permission.name}</p>
                  <p className="mt-1 text-xs leading-5 text-muted">
                    {permission.description}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted">追加のPlugin権限定義はありません。</p>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-4">
        <h3 className="text-sm font-semibold text-amber-100">セットアップの注意点</h3>
        <ul className="mt-2 space-y-2 text-sm leading-6 text-muted">
          {notes.map((note) => (
            <li key={note} className="flex gap-2">
              <span aria-hidden="true" className="text-amber-300">
                •
              </span>
              <span>{note}</span>
            </li>
          ))}
        </ul>
      </div>

      {Object.keys(properties).length > 0 ? (
        <details className="rounded-xl border border-border bg-background/40 p-4">
          <summary className="cursor-pointer text-sm font-semibold">
            設定項目の一覧を見る
          </summary>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {Object.entries(properties).map(([key, property]) => (
              <div
                key={key}
                className="rounded-lg border border-border/70 bg-surface/50 p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium">{property.title ?? humanizeKey(key)}</p>
                  {required.has(key) ? (
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                      必須
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 break-all font-mono text-[11px] text-muted">{key}</p>
                {property.description ? (
                  <p className="mt-2 text-xs leading-5 text-muted">{property.description}</p>
                ) : null}
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}

function SummaryCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-background/60 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
      <p className="mt-1 text-xs text-muted">{detail}</p>
    </div>
  );
}

function humanizeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, (character) => character.toUpperCase());
}
