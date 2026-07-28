# Moderation Plugin v1

Moderation Plugin v1は、Message Content Intentを使用せず、Slash Commandによる明示的なモデレーション操作とGuild単位のケース管理を提供します。

## 対応機能

| コマンド | 必要な実行者権限 | Bot権限 | 動作 |
| --- | --- | --- | --- |
| `/mod warn user reason` | Manage Messages または Moderate Members | 不要 | 警告ケースを記録 |
| `/mod timeout user duration reason` | Moderate Members | Moderate Members | 指定分数タイムアウト |
| `/mod kick user reason` | Kick Members | Kick Members | GuildからKick |
| `/mod ban user reason [delete_message_seconds]` | Ban Members | Ban Members | GuildからBAN |
| `/mod case number` | Manage Messages または Moderate Members | 不要 | ケース詳細を表示 |
| `/mod history user [page]` | Manage Messages または Moderate Members | 不要 | ユーザー別履歴を表示 |

Moderation PluginがGuildで有効な場合だけ`/mod`がGuild Commandへ登録されます。

## 安全境界

操作前に次を検証します。

- 実行者のDiscord権限
- `allowedModeratorRoleIds`を設定した場合のロール所属
- Bot自身の必要権限
- 実行者とBotのロールが対象ユーザーより上位であること
- Guild Owner、実行者本人、Herta Bot、Botアカウントを対象にしていないこと
- Discord.jsが公開する`moderatable`、`kickable`、`bannable`状態

Discord API操作に失敗した場合は成功ケースにせず、`failed`状態のケースを記録します。DM通知とログチャンネル送信はベストエフォートであり、失敗しても本体のモデレーション操作は取り消しません。

## Plugin設定

| 設定 | 既定値 | 範囲・用途 |
| --- | --- | --- |
| `requireReason` | `true` | 理由入力を必須化 |
| `dmTarget` | `true` | 対象ユーザーへDM通知 |
| `logChannelId` | `null` | ケース概要を送信するDiscordチャンネルID |
| `defaultResponseEphemeral` | `true` | Slash Command応答を実行者だけに表示 |
| `maxReasonLength` | `500` | 1〜1000文字 |
| `caseRetentionDays` | `365` | 30〜3650日。削除処理から利用可能 |
| `allowedModeratorRoleIds` | `[]` | 空の場合はDiscord権限だけで判定 |

StudioのPlugin ManagerはmanifestのJSON Schemaで未知プロパティ、不正なDiscord ID、範囲外数値を拒否します。

## ケースデータ

`moderation_cases`テーブルへ以下を保存します。

- Guild単位の`case_number`
- `warn` / `timeout` / `kick` / `ban`
- 対象ユーザーID、実行者ID
- 最大長を制限した理由
- `active` / `completed` / `revoked` / `failed`
- 期間、有効期限、安全なDiscord参照ID
- `discord` / `dashboard`
- 作成日時、更新日時

ケース番号の採番はPostgreSQLのTransaction Advisory LockをGuild ID単位で取得してから行うため、同一Guildで同時実行されても重複しません。すべての検索・更新は`guild_id`とケース番号を組み合わせます。

理由は運用上必要なためケース本体に保存しますが、Audit Logとコマンド利用分析へ本文を複製しません。メッセージ本文、チャンネル会話、コマンドオプション全体、スタックトレースは保存しません。

## Studio

Plugin設定画面の「モデレーションケース管理」から以下へ移動できます。

- `/dashboard/guilds/[guildId]/moderation`
  - ケース番号、対象ID、実行者ID、理由の検索
  - action / status / 対象ユーザー / 日付範囲の絞り込み
  - ページング
- `/dashboard/guilds/[guildId]/moderation/[caseNumber]`
  - ケース詳細
  - 理由編集
  - 状態変更

API:

- `GET /api/guilds/[guildId]/moderation/cases`
- `GET /api/guilds/[guildId]/moderation/cases/[caseNumber]`
- `PATCH /api/guilds/[guildId]/moderation/cases/[caseNumber]`

すべてのAPIはAuth.jsセッションを確認し、Discord APIから対象GuildのAdministratorまたはManage Guild権限を再確認します。DB/API障害時は一覧・詳細画面内にエラー状態を表示します。

## Audit Log

- `moderation.warn`
- `moderation.timeout`
- `moderation.kick`
- `moderation.ban`
- `moderation.case.update`

監査情報にはケース番号、種別、対象ID、操作元、状態変更だけを含めます。理由本文は含めません。

## マイグレーション

適用:

```bash
pnpm db:generate
pnpm db:migrate:deploy
```

本番反映前にPostgreSQLバックアップを取得し、マイグレーション適用後に次を確認します。

```sql
SELECT to_regclass('public.moderation_cases');
SELECT indexname FROM pg_indexes WHERE tablename = 'moderation_cases';
```

ロールバックが必要な場合は、アプリケーションを直前のイメージへ戻した後、ケースデータを退避してからテーブルを削除します。

```sql
CREATE TABLE moderation_cases_rollback_backup AS TABLE moderation_cases;
DROP TABLE moderation_cases;
```

## 本番確認

1. Moderation Pluginを対象Guildで有効化する
2. BotへModerate Members / Kick Members / Ban Membersを必要範囲だけ付与する
3. Botロールをモデレーション対象ロールより上へ配置する
4. `/mod warn`でケースを作成する
5. Studioのケース一覧・詳細で同じケースを確認する
6. 理由または状態を更新し、Audit Logへ`moderation.case.update`が記録されることを確認する
7. 権限不足・上位ロール・Guild Ownerへの操作が拒否されることを確認する

## トラブルシューティング

### 「Botに必要なDiscord権限がありません」

Botロールへ対象操作の権限を付与し、DiscordのGuild Installから権限を更新します。

### 「Botより上位のロールを持つユーザーは対象にできません」

Botロールを対象ユーザーの最上位ロールより上へ移動します。Administrator権限だけではロール階層を越えられません。

### ケース画面だけ取得エラーになる

`moderation_cases`マイグレーションの適用状況とDB接続を確認します。画面はエラー状態を表示し、他のGuild管理画面やQuote Pluginへ障害を波及させません。

## v2へ分離する機能

- NGワード自動削除
- スパム・連投・大量メンション検知
- 招待リンク自動検知
- Message Content Intent
- AI判定
- 自動処罰ルールエンジン
- 添付画像やメッセージ本文の保存
