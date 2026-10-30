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
      '/vc-recap start実行中、同意済みのメンバー(本人の同意、または本人が拒否していない場合の自動同意ロール・管理者設定)',
    content: '発言者・発言時刻・本文',
    retention:
      '本文の保存に同意した本人の分はセッション終了から30日(経過後に自動削除)。それ以外は要約生成完了時に削除',
  },
  {
    type: 'VC通話の要約',
    condition: '上記に基づき/vc-recapセッションが完了した場合',
    content: '要約文・トピック一覧・参加者一覧(同意していない参加者のDiscordユーザーIDを含む)',
    retention: '無期限(本人からの削除依頼まで)',
  },
  {
    type: 'メッセージ本文(編集前・削除時)',
    condition: 'guild管理者がactivity-logプラグインを有効化している場合',
    content: '編集前・削除時のスナップショットのみ',
    retention: '本文は180日で消去',
  },
  {
    type: 'AI機能の利用記録',
    condition: 'AI機能が有効なサーバーでHertaへメンション・返信した場合',
    content: 'モデル・トークン数・推定費用などのメタデータのみ(本文・利用者IDは保存しない)',
    retention: '90日',
  },
  {
    type: 'MBTIの個人履歴',
    condition: '本人が診断を完了した場合',
    content: '診断日時・タイプ・各軸の結果(個別回答・ユーザー名は保存しない)',
    retention: '本人からの削除依頼まで',
  },
  {
    type: '活動統計・XP・実績・順位',
    condition: '各プラグインが有効なサーバー',
    content: 'メッセージ数・VC時間・オンライン時間・プレイ中のゲーム名・レベル・実績・順位など',
    retention: '期間を定めていない',
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
              VC発言の文字起こしの対象は、本人が同意したメンバー、またはまだ同意・拒否を選んでいないメンバーのうち管理者が設定した自動同意ロールを持つ人・管理画面で同意済みにされた人です。管理者による同意済みの設定はサーバーごとではなくDiscordアカウント単位で、Hertaの文字起こしが有効な他のサーバーでも同意済みとして扱われます。サーバーへの参加や利用規約への同意だけでは対象になりません。
              <strong className="font-semibold text-foreground">
                本人が拒否・取り消しを選んだ場合は、ロールや管理者の設定に関係なく対象外になります。
              </strong>
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
              発言開始のたびに最新の同意状態を都度確認します。Discordコマンド・ボタンでの取り消しは進行中の発言も即座に打ち切って対象外にしますが、専用URL(Web)や管理画面での取り消しはBotプロセスへ即時通知できないため、取り消し後に新たに話し始めた時点から対象外になります(取り消し操作の瞬間に発言中だった分は、その発言が終わるまで記録される場合があります)。
            </li>
            <li>
              文字起こし本文は、
              <strong className="font-semibold text-foreground">
                本文の保存(30日)を説明した上で本人が同意した場合のみ
              </strong>
              、セッション終了から30日間保存し、そのサーバーのStudioダッシュボード(VC
              Recapの閲覧権限を持つ管理者)で閲覧できるようにします。30日を過ぎた本文は自動で削除します。本文の保存を説明する前に同意したメンバーや、自動同意ロール・管理者の設定で対象になったメンバーの本文は、要約生成完了時に削除します。以前に同意したメンバーが本文の保存にも同意する場合は、改めて
              <code className="text-foreground">/herta-privacy voice-consent true</code>
              を実行してください。
            </li>
            <li>
              同意を取り消すと本文の保存への同意も取り消され、保存済みのあなたの文字起こし本文は即座に削除します。
            </li>
            <li>
              <code className="text-foreground">/vc-recap start</code>
              実行時、Hertaは必ずそのVCへ「この通話の要約を記録します。同意していない方の発言は記録されません」という趣旨のアナウンスを投稿します。無言での録音は行いません。
            </li>
            <li>
              生の音声データ(録音ファイル)はディスク・データベースのいずれにも保存しません。音声はメモリ上でAWS
              Transcribeへ送り、テキスト化され次第破棄します。
            </li>
            <li>
              文字起こし・要約は自動処理のため、聞き取りや要約の誤りが含まれることがあります。
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
              VC関連のデータ(同意状態・要約・保存中の文字起こし本文)とMBTIの個人履歴をJSONでエクスポートします。活動統計などその他のデータは含まれません。
            </li>
          </ul>
        </Section>

        <Section title="外部サービスへの送信">
          <ul className="list-disc space-y-2.5 pl-5 text-sm leading-7 text-muted">
            <li>
              AI機能:メンション・返信の本文と会話の文脈をOpenAIへ送り、回答や生成物を作ります。
            </li>
            <li>VC文字起こし:同意した本人の発言音声をAWS Transcribeへ送ります。</li>
            <li>
              将来OpenAI音声認識を有効化する場合は、従来の文字起こし同意とは別に
              <code className="text-foreground">/herta-privacy openai-audio-consent</code>
              で本人が明示同意した発言音声だけをOpenAI APIへ送信します。自動同意ロールや管理者設定でこの同意は代替できません。現在はAWSを既定とし、OpenAI音声送信は無効です。
            </li>
            <li>
              VC要約:文字起こし本文と発言者のDiscordユーザーIDをOpenAIへ送り、要約を作ります。
            </li>
            <li>
              送信先での保存や学習への利用の有無は、各事業者の規約と運営の契約・設定によります。個人情報・認証情報・秘密の情報はAIへ入力しないでください。
            </li>
          </ul>
          <p className="mt-3 text-sm leading-7 text-muted">
            上記以外のデータの開示・削除は、公式サイトのお問い合わせフォームまたはDiscordのチケットで依頼してください。
          </p>
        </Section>

        <p className="mt-10 border-t border-border pt-6 text-xs leading-6 text-muted">
          本ページはHertaに関する取り扱いの要約です。いゔる。ーむ全体の取り扱いは
          <a
            href="https://ivrm.jp/privacy"
            className="underline underline-offset-2 hover:text-foreground"
          >
            公式サイトのプライバシーポリシー
          </a>
          を正本とします。chat発言本文等を広く収集するRAG機能は本ページ作成時点では提供していません。
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
