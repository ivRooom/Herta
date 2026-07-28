# Auto Response Plugin v1

Auto Response Plugin v1は、Guild内のメッセージをキーワードまたは安全な正規表現で評価し、テキストまたはEmbedを自動送信します。

## 対応機能

| 項目     | 内容                                             |
| -------- | ------------------------------------------------ |
| 一致方式 | 完全一致、部分一致、前方一致、正規表現           |
| 応答形式 | テキスト、制限付きEmbed JSON                     |
| 対象範囲 | チャンネルID、ロールID                           |
| Cooldown | Guild全体、Rule単位                              |
| 除外     | Bot、Webhook、System Message、DM                 |
| 管理     | Herta Studioから作成・編集・有効化・無効化・削除 |
| 集計     | 成功、失敗、Cooldown除外、平均処理時間           |

Studioの管理ルートは次のとおりです。

```text
/dashboard/guilds/{guildId}/auto-response
```

## Discord Gateway Intent

メッセージ本文の取得にはDiscordのPrivileged Gateway Intentが必要です。

1. Discord Developer PortalのBot設定を開く
2. `MESSAGE CONTENT INTENT`を有効化する
3. 本番環境変数を設定する

```dotenv
DISCORD_ENABLE_MESSAGE_CONTENT_INTENT=true
```

環境変数が`false`の場合、Botは`Guilds` Intentだけで起動し、Auto Responseの`messageCreate`処理を実行しません。IntentをDeveloper Portalで有効化する前に環境変数だけを`true`へ変更しないでください。

Botには対象チャンネルで次の権限が必要です。

- View Channel
- Send Messages
- Embed Links（Embed応答を利用する場合）

Runtimeは送信前にView ChannelとSend Messagesを確認し、Embed応答ではEmbed Linksも確認します。権限不足はルール本文を含めず失敗メトリクスへ記録します。

## Plugin設定

| 設定                         | 既定値  | 範囲・用途                |
| ---------------------------- | ------- | ------------------------- |
| `maxRules`                   | `100`   | Guildあたり1〜200件       |
| `maxRulesPerMessage`         | `1`     | 1メッセージあたり1〜5応答 |
| `guildCooldownSeconds`       | `1`     | Guild全体の送信間隔       |
| `defaultRuleCooldownSeconds` | `5`     | 新規ルールの既定値        |
| `maxTriggerLength`           | `100`   | 通常トリガー最大文字数    |
| `maxResponseLength`          | `1800`  | テキスト応答最大文字数    |
| `maxMessageLength`           | `2000`  | 評価対象本文の最大文字数  |
| `regexEnabled`               | `true`  | 正規表現ルールを許可      |
| `regexMaxLength`             | `100`   | 正規表現最大文字数        |
| `regexExecutionBudgetMs`     | `10`    | VM評価の強制タイムアウト  |
| `allowUserMentions`          | `false` | ユーザーへの通知を許可    |

`@everyone`、`@here`、ロールメンションは設定にかかわらず保存時に拒否します。

## 正規表現の安全境界

v1ではJavaScript正規表現のすべてを許可せず、安全なサブセットだけを受け付けます。

次のパターンは拒否します。

- 後方参照
- 先読み・後読み・atomic group
- 量指定子を含むgroupへの再量指定
- alternationを含むgroupへの量指定
- 複数の`.*`または`.+`を組み合わせるパターン
- 設定上限を超えるパターン
- 構文エラー

評価対象メッセージにも長さ上限を設定します。実行時は`node:vm`の分離Contextで評価し、`regexExecutionBudgetMs`を超えた処理を強制停止します。タイムアウトは失敗メトリクスとして記録されるため、Studioで処理時間と失敗数を監視してください。

## Embed JSON

v1で利用できるフィールドは次のとおりです。

```json
{
  "title": "お知らせ",
  "description": "本文",
  "color": 5793266,
  "footer": { "text": "Herta" },
  "fields": [{ "name": "項目", "value": "内容", "inline": true }]
}
```

画像、サムネイル、外部URL、任意のDiscord Embedプロパティはv1では扱いません。

## データとプライバシー

保存するルール情報:

- ルール名
- トリガー
- 応答内容
- 一致方式、応答形式
- チャンネル・ロールスコープ
- Cooldown、優先度、有効状態
- 成功数、失敗数、最終実行日時

実行メトリクスに保存する情報:

- Guild ID
- Rule ID
- 成功・失敗・Cooldown除外
- 処理時間
- エラー名
- 実行日時

保存しない情報:

- Discordメッセージ本文
- メッセージID
- 投稿ユーザーID
- 添付ファイル
- 応答本文の実行履歴への複製
- スタックトレース

Audit LogにはルールID、操作種別、一致方式、応答形式、対象範囲件数等だけを保存し、トリガーと応答本文を表示しません。

## Cooldownと競合防止

Rule CooldownとGuild Cooldownは、PostgreSQL Transaction Advisory LockをGuild単位で取得し、Guild内で最後に送信権を予約した`lastTriggeredAt`を参照して判定します。複数メッセージが同時に到着しても、同じGuildで送信権を同時取得しない設計です。

送信直前にRuleの`lastTriggeredAt`を更新します。Discord API送信が失敗した場合も短時間の連続再試行を防ぐためCooldownは維持し、失敗メトリクスを記録します。Studioで変更したルールはRuntimeの最大10秒キャッシュ後に反映されます。

## 本番反映

````bash
docker compose \
  --env-file .env.production \
  -f docker-compose.prod.yml \
  run --rm migrator

既存`auto_responses`への複合Indexは単一statementの`CREATE INDEX CONCURRENTLY` migrationで作成します。CHECK制約は本番反映時の全件scanを避けるため`NOT VALID`で追加し、低負荷時間帯に次を実行して検証状態へ移行します。

```sql
ALTER TABLE "auto_responses" VALIDATE CONSTRAINT "auto_responses_match_mode_check";
ALTER TABLE "auto_responses" VALIDATE CONSTRAINT "auto_responses_response_type_check";
ALTER TABLE "auto_responses" VALIDATE CONSTRAINT "auto_responses_cooldown_seconds_check";
ALTER TABLE "auto_responses" VALIDATE CONSTRAINT "auto_responses_priority_check";
````

docker compose \
--env-file .env.production \
-f docker-compose.prod.yml \
up -d bot studio

````

確認項目:

1. `auto_responses`へ追加列が作成されている
2. `auto_response_execution_events`が作成されている
3. Developer PortalのMessage Content Intentが有効
4. `DISCORD_ENABLE_MESSAGE_CONTENT_INTENT=true`
5. Bot起動ログにIntent有効化が表示される
6. Pluginを有効化したGuildだけで応答する
7. Bot・Webhook投稿へ応答しない
8. Cooldown中に連続送信しない
9. Studioで成功・失敗・処理時間を確認できる
10. Audit Logに本文が表示されない

## ロールバック

### 機能停止

最初にStudioからAuto Response Pluginを無効化します。緊急時は次も実施します。

```dotenv
DISCORD_ENABLE_MESSAGE_CONTENT_INTENT=false
````

環境変数変更後にBotを再起動します。ルールデータを残したままイベント処理だけ停止できます。

### Application rollback

旧imageへ戻す前にPluginを無効化します。旧Prisma Clientは追加列を無視できますが、新規テーブルを参照するRuntimeは旧imageに存在しないため、先にBotとStudioを旧imageへ戻します。

### Database rollback

データを保持する場合は削除前に退避します。

```sql
CREATE TABLE auto_responses_backup_20260728 AS
SELECT * FROM auto_responses;

CREATE TABLE auto_response_execution_events_backup_20260728 AS
SELECT * FROM auto_response_execution_events;
```

その後、必要な場合だけ次を実施します。

```sql
DROP TABLE IF EXISTS auto_response_execution_events;
DROP INDEX IF EXISTS auto_responses_guild_id_priority_created_at_idx;

ALTER TABLE auto_responses
  DROP CONSTRAINT IF EXISTS auto_responses_match_mode_check,
  DROP CONSTRAINT IF EXISTS auto_responses_response_type_check,
  DROP CONSTRAINT IF EXISTS auto_responses_cooldown_seconds_check,
  DROP CONSTRAINT IF EXISTS auto_responses_priority_check,
  DROP COLUMN IF EXISTS priority,
  DROP COLUMN IF EXISTS case_sensitive,
  DROP COLUMN IF EXISTS response_count,
  DROP COLUMN IF EXISTS failure_count,
  DROP COLUMN IF EXISTS last_triggered_at;
```

## トラブルシューティング

### Pluginを有効化しても反応しない

- `DISCORD_ENABLE_MESSAGE_CONTENT_INTENT`を確認
- Developer PortalのMessage Content Intentを確認
- Botを再起動
- 対象チャンネル・ロールIDを確認
- View Channel / Send Messages権限を確認
- RuleとGuildのCooldownを確認

### 正規表現を保存できない

安全なサブセット外のパターンです。完全一致、部分一致、前方一致を優先し、正規表現は単純なアンカー・文字クラス・単一の量指定子へ簡略化します。

### 失敗数が増える

Botのチャンネル権限、Embed JSON、Discord APIエラーをBotログで確認します。ログには本文を出さないため、Rule IDをStudioの対象ルールと照合します。
