import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'プライバシーポリシー | Herta',
  description: 'Discord bot Hertaが収集・保持する個人データの取り扱いについて',
};

const DATA_ROWS: Array<{ type: string; condition: string; content: string; retention: string }> = [
  {
    type: 'VC発言の文字起こし本文',
    condition:
      '/vc-recap start実行時(または進行中)、本人が同意済みの場合のみ(コマンド・ボタン・専用URLのいずれか)',
    content: 'セッション進行中のみ',
    retention: '要約生成完了時に削除(本文は残さない)',
  },
  {
    type: 'VC通話の要約',
    condition: '上記に基づき/vc-recapセッションが完了した場合',
    content: '要約文・トピック一覧・参加者一覧',
    retention: '無期限(本人からの削除依頼まで)',
  },
  {
    type: 'メッセージ本文(編集前・削除時)',
    condition: 'guild管理者がactivity-logプラグインを有効化している場合',
    content: '編集前・削除時のスナップショットのみ',
    retention: '180日',
  },
];

export default function PrivacyPolicyPage() {
  return (
    <main className="min-h-screen bg-background">
      <div className="border-b border-border px-4 py-4 sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">Herta</p>
      </div>

      <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6 sm:py-14">
        <Link
          href="/"
          className="text-sm text-muted underline underline-offset-2 hover:text-foreground"
        >
          トップへ戻る
        </Link>

        <h1 className="mt-6 text-xl font-semibold tracking-tight sm:text-2xl">
          プライバシーポリシー
        </h1>
        <p className="mt-3 max-w-prose text-sm leading-7 text-muted">
          Discord bot
          Hertaが収集・保持するメンバーの個人データについて、何を・なぜ・どれだけ保持するかを記載します。
        </p>

        <Section title="収集するデータと保持期間">
          <div className="divide-y divide-border border-y border-border">
            {DATA_ROWS.map((row) => (
              <div key={row.type} className="py-4 first:pt-0 last:pb-0">
                <p className="font-medium">{row.type}</p>
                <dl className="mt-2 space-y-1 text-sm leading-6 text-muted">
                  <Row label="収集条件" value={row.condition} />
                  <Row label="保持内容" value={row.content} />
                  <Row label="保持期間" value={row.retention} />
                </dl>
              </div>
            ))}
          </div>
        </Section>

        <Section title="同意の仕組み">
          <ul className="list-disc space-y-3 pl-5 text-sm leading-7 text-muted">
            <li>
              VC発言の文字起こしは、
              <strong className="font-semibold text-foreground">
                本人が明示的に同意したメンバーの発言のみ
              </strong>
              を対象とします。同意していないメンバーの音声は録音・文字起こしの対象になりません。
            </li>
            <li>
              同意は次のいずれの方法でも行えます。
              <ul className="mt-2 list-disc space-y-1.5 pl-5">
                <li>
                  <code className="text-foreground">/herta-privacy voice-consent true</code>
                  コマンド
                </li>
                <li>
                  <code className="text-foreground">/vc-recap start</code>
                  実行時に未同意メンバーへ送られる同意促しメッセージの「同意する」ボタン
                </li>
                <li>
                  同メッセージの「Webで同意する」ボタン、または
                  <code className="text-foreground">/herta-privacy web-link</code>
                  で発行される専用URL(30分有効)
                </li>
              </ul>
            </li>
            <li>
              発言開始のたびに最新の同意状態を都度確認します。Discordコマンド・ボタンでの取り消しは進行中の発言も即座に打ち切って対象外にしますが、専用URL(Web)での取り消しはBotプロセスへ即時通知できないため、取り消し後に新たに話し始めた時点から対象外になります(取り消し操作の瞬間に発言中だった分は、その発言が終わるまで記録される場合があります)。
            </li>
            <li>
              <code className="text-foreground">/vc-recap start</code>
              実行時、Hertaは必ずそのVCへ「この通話の要約を記録します。同意していない方の発言は記録されません」という趣旨のアナウンスを投稿します。無言での録音は行いません。
            </li>
            <li>
              生の音声データ(録音ファイル)はディスク・データベースのいずれにも保存しません。文字起こし処理中のメモリ上バッファのみで、テキスト化され次第破棄します。
            </li>
          </ul>
        </Section>

        <Section title="データ主体の権利">
          <p className="text-sm leading-7 text-muted">
            以下のコマンドをHertaを導入しているサーバー内で実行できます(Slash
            Commandはサーバーごとに登録されるため、現時点ではDMからは実行できません)。
          </p>
          <ul className="mt-3 list-disc space-y-2.5 pl-5 text-sm leading-7 text-muted">
            <li>
              <code className="text-foreground">
                /herta-privacy voice-consent &lt;true|false&gt;
              </code>
              : VC文字起こしへの同意を切り替えます。
            </li>
            <li>
              <code className="text-foreground">/herta-privacy delete-voice-data</code>:
              自分が参加したVC要約・文字起こしデータの削除を依頼します。本人単独のセッションは記録ごと削除し、他の参加者もいるセッションは本人の参加記録を除去した上で要約自体も削除します。
            </li>
            <li>
              <code className="text-foreground">/herta-privacy export</code>:
              Hertaが保持しているあなたのデータをJSONでエクスポートします。
            </li>
          </ul>
        </Section>

        <p className="mt-10 border-t border-border pt-6 text-xs leading-6 text-muted">
          本ページは<code className="text-foreground">docs/PRIVACY_POLICY.md</code>
          の内容を要約したものです。chat発言本文等を広く収集するRAG機能は本ページ作成時点では未実装です。
        </p>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="inline font-medium text-foreground">{label}: </dt>
      <dd className="inline">{value}</dd>
    </div>
  );
}
