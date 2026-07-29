# Daily Content Plugin v1

Daily Content Pluginは、Guildごとに登録したテキストコンテンツを指定したIANA timezoneの時刻に毎日配信します。配信予約、BullMQ enqueue、Discord送信、履歴更新を分離し、Worker停止や一時的なDiscord API障害から復旧できる構成です。

## 構成

1. Studioまたは`/daily publish`がスケジュール・手動配信をDBへ登録する
2. Workerが`next_run_at <= now()`のスケジュールを走査する
3. `daily_content_deliveries`へ配信予約を作成する
4. Redisへ本文ではなく`deliveryId`、`scheduleId`、idempotency key、予定日時だけをenqueueする
5. Workerが配信直前にDBから本文と最新のPlugin状態を取得する
6. Discord APIへ送信し、成功・失敗・再試行状態をDBへ記録する

本文はBullMQジョブ、Audit Log、Workerログへ保存しません。

## timezoneとDST

- timezoneは`Asia/Tokyo`などのIANA timezoneで指定します。
- 配信時刻はtimezone内の壁時計時刻として毎日計算します。
- DST開始日に指定時刻が存在しない場合、その日は配信せず次に存在する日の同時刻へ送ります。
- DST終了日に同じ壁時計時刻が2回発生する場合、前回予定時刻より後に到来する最初の時刻を採用します。
- 既存レコードの`next_run_at`はmigration時にNULLのまま保持し、Worker起動後に未来の次回時刻へ初期化します。migration直後の一斉誤配信は行いません。

## 重複防止

定時配信のidempotency keyは次の形式です。

```text
<scheduleId>:<scheduledFor ISO-8601>
```

手動配信は次の形式です。

```text
<scheduleId>:manual:<requestId>
```

次の三層で重複を抑止します。

1. `daily_content_deliveries.idempotency_key`のUnique制約
2. BullMQの`jobId = deliveryId`
3. idempotency keyから生成した25文字のDiscord nonceと`enforce_nonce: true`

Discord送信が成功した直後にDB更新だけが失敗した場合も、短時間の再試行では同じnonceを使用します。長時間経過後の手動再実行まで完全なExactly Onceを保証するものではないため、履歴のmessage IDとDiscordチャンネルを確認してから再実行してください。

## Worker全体設定

Workerのdue走査間隔はGuild設定ではなく環境変数`DAILY_CONTENT_SCAN_INTERVAL_SECONDS`で指定します。既定30秒、最小10秒、最大300秒です。Redis接続は段階的な再接続delayを使用し、最大30秒で再試行します。

## 再試行とstale recovery

- HTTP 429、5xx、通信エラー、timeoutは指数バックオフで再試行します。
- 既定の最大試行回数は5回です。
- `processing`のままGuild設定の`staleAfterMinutes`を超えた配信は`retrying`へ戻します。
- BullMQに同じ`jobId`の`failed`・`completed` Jobが残っている場合は削除して再投入します。
- `active`・`waiting`・`delayed`のJobは既存処理へ任せ、二重enqueueしません。
- Pluginまたは個別スケジュールが無効の場合、送信せず`skipped`として記録します。
- Studioでは`failed`または`skipped`の履歴だけを再実行できます。

## Discord権限

対象チャンネルでBotに次の権限が必要です。

- View Channel
- Send Messages
- Threadへ配信する場合はSend Messages in Threads

Workerは送信前にBot自身のユーザーID、Guild Role、Bot Member Role、チャンネルのpermission overwriteを取得し、Discordの権限上書き順序で実効権限を計算します。Role・Member情報はGuild単位で30秒キャッシュします。Threadでは親チャンネルのpermission overwriteを使い、アーカイブ済みThreadは送信前に拒否します。

権限不足、存在しないチャンネル、テキスト非対応チャンネルは失敗履歴へ安全なエラー名だけを保存します。Discord APIのresponse body、投稿本文、token、stackはログへ保存しません。

## メンション安全性

- `@everyone`と`@here`は常に拒否します。
- ロールメンションは常に拒否します。
- ユーザーメンションは既定で拒否します。
- `allowUserMentions`を有効化した場合も、Discordへ`allowed_mentions.parse = ['users']`を明示します。
- 本文は最大2000文字です。

## migration

適用前に本番DBのバックアップを取得してください。

```bash
pg_dump --format=custom --file=herta-before-daily-content-v1.dump "$DATABASE_URL"
pnpm --filter @herta/db migrate:deploy
```

主な変更は次のとおりです。

- `daily_contents`へ`next_run_at`、`last_scheduled_at`、`deleted_at`、作成・更新ユーザーを追加
- `last_sent_at`を`TIMESTAMPTZ(3)`へ変換
- `daily_content_deliveries`を追加
- 配信履歴を保持するため、スケジュールとの外部キーを`ON DELETE RESTRICT`に設定
- due判定用Indexを単独`CREATE INDEX CONCURRENTLY` migrationで追加
- 既存`daily_contents`の時刻CHECK制約を`NOT VALID`で追加

既存データの時刻を確認した後、低負荷時間帯に制約を検証します。

```sql
SELECT id, guild_id, schedule_time
FROM daily_contents
WHERE schedule_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$';

ALTER TABLE daily_contents
  VALIDATE CONSTRAINT daily_contents_schedule_time_check;
```

## 本番確認

1. Pluginを1つの検証Guildだけで有効化する
2. 5分後の時刻でテストスケジュールを登録する
3. `next_run_at`が期待するUTC時刻であることを確認する
4. Workerログに本文が出ていないことを確認する
5. Discordへ1件だけ投稿されることを確認する
6. `daily_content_deliveries.status = 'sent'`とmessage IDを確認する
7. 同じdeliveryを再enqueueしてDiscord投稿が重複しないことを確認する
8. Bot権限を外し、失敗・retry・Studio再実行を確認する
9. 通常チャンネルとThreadで事前権限判定を確認する
10. Workerを配信中に停止し、stale recoveryを確認する
11. Plugin無効化後に予約済みジョブが`skipped`になることを確認する
12. スケジュール削除後も配信履歴とmessage IDが残ることを確認する

## rollback

アプリだけを戻す場合、先にDaily Content Pluginを全Guildで無効化し、Workerを旧imageへ戻します。DB列・履歴テーブルは旧アプリから参照されないため、緊急時は保持したままアプリをrollbackできます。

DBも戻す必要がある場合は、配信Workerを停止してからバックアップを復元してください。稼働中に`daily_content_deliveries`をDROPすると、処理中ジョブの状態が失われます。

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml stop worker
dropdb --if-exists herta_restore
createdb herta_restore
pg_restore --clean --if-exists --dbname=herta_restore herta-before-daily-content-v1.dump
```

復元先・接続先の切り替えは本番のDB運用手順に従ってください。

## Studioとコマンド

- Studio: `/dashboard/guilds/[guildId]/daily-content`
- `/daily preview schedule_id:<ID>`: 本人だけに本文をプレビュー
- `/daily publish schedule_id:<ID>`: 手動配信を予約

Studioではスケジュール作成・編集・停止・削除、次回配信、直近履歴、手動配信、失敗再実行を管理できます。削除はSoft Deleteとして扱い、過去の配信履歴とmessage IDを保持します。v1はテキスト配信のみで、Embed・添付ファイル・外部URL取得を行わないためSSRFの入力面を持ちません。
