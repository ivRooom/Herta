# Quote Plugin

Quote Pluginは、Discord Guildごとに名言・印象的な発言を登録し、Slash CommandとHerta Studioの両方から管理する公式Pluginです。

## 有効化

1. Herta StudioへDiscord OAuthでログインします。
2. 対象Guildの`Plugin Manager`を開きます。
3. `Quote`を有効化し、必要に応じて設定を変更します。
4. Bot RuntimeがRedis Pub/Sub通知を受け取り、対象Guildの`/quote`を再同期します。

Pluginが無効なGuildには`/quote`は登録されません。

## Slash Command

| Command | 説明 |
| --- | --- |
| `/quote random [tag]` | 公開Quoteからランダムに1件表示します |
| `/quote show <number>` | Quote番号を指定して表示します |
| `/quote add <text> [author] [tags]` | Quoteを登録します。タグはカンマ区切りです |
| `/quote delete <number>` | Quoteを削除します |
| `/quote list [page] [tag]` | 公開Quoteを5件ずつ一覧表示します |

`add`と`delete`はPlugin設定とDiscord権限を組み合わせて制御します。管理者として扱うDiscord権限は次のいずれかです。

- Manage Guild
- Manage Messages

## Plugin設定

| 設定 | 型 | 既定値 | 説明 |
| --- | --- | --- | --- |
| `allowMemberRegistration` | boolean | `true` | 一般メンバーによる登録を許可します |
| `allowMemberDeletion` | boolean | `false` | 一般メンバーによる削除を許可します |
| `maxQuoteLength` | integer | `1000` | 本文の最大文字数。上限は1800です |
| `randomResponseEphemeral` | boolean | `false` | random応答を実行者だけに表示します |
| `allowedChannelIds` | string[] | `[]` | 利用可能チャンネル。空配列は全チャンネルです |

設定はJSON Schemaで検証されます。未知のプロパティ、不正な型、不正なChannel IDは保存時に拒否されます。

## Studio管理画面

Guild詳細から次の順で開きます。

`Plugin Manager` → `Quote` → `Quote管理`

管理画面では次の操作ができます。

- 番号・本文・作者による検索
- タグ、status、NSFWによる絞り込み
- Quoteの新規登録
- 本文、作者、タグ、status、NSFWの編集
- 削除確認を伴う削除
- ページング

APIは次のルートを使用します。

- `GET /api/guilds/[guildId]/quotes`
- `POST /api/guilds/[guildId]/quotes`
- `GET /api/guilds/[guildId]/quotes/[quoteNumber]`
- `PATCH /api/guilds/[guildId]/quotes/[quoteNumber]`
- `DELETE /api/guilds/[guildId]/quotes/[quoteNumber]`

すべてのAPIでAuth.jsセッションを確認し、Discord APIからAdministratorまたはManage Guild権限を再検証します。

## データ分離

Quote Serviceの全操作は`guildId`を必須とします。番号指定の参照・更新・削除でも、`guildId`と`quoteNumber`を同時に条件へ含めるため、他Guildのデータへアクセスできません。

`quoteNumber`はGuild単位で採番します。同時登録時の競合はSerializable transactionとPrismaの競合コードを使って再試行します。

## Audit Log

次の操作を`audit_logs`へ記録します。

- `quote.create`
- `quote.update`
- `quote.delete`

記録内容にはGuild、実行者、Quote番号、変更前後、操作経路（`discord`または`dashboard`）を含みます。

## 安全性

- DB内の値をコードやmodule pathとして評価しません。
- Quote実装はBotの静的Plugin Registryからのみ解決します。
- Discord応答ではメンション展開を無効化します。
- 本文、作者、タグ件数、タグ長、status、ページサイズを検証します。
- Plugin障害はGuild Plugin Loaderで分離され、Core Commandの`/ping`へ波及しません。

## テスト

```bash
pnpm --filter @herta/plugin-quote test
pnpm --filter @herta/bot test
pnpm --filter @herta/studio typecheck
```

主な回帰テスト:

- Guildごとのデータ分離
- GuildごとのQuote番号
- 他Guildからの参照・更新・削除拒否
- 採番競合時の再試行
- 設定の既定値と入力検証
- タグ指定ランダム取得
