# LFG Plugin v1

LFG Pluginは、Discord Guild内のゲーム・イベント募集を作成し、Buttonから参加・辞退できる公式Pluginです。募集、参加者、Discordメッセージ状態をPostgreSQLで管理し、期限切れ・表示再同期・削除メッセージ復旧をWorkerが処理します。

## 提供機能

- `/lfg create`
- `/lfg show`
- `/lfg list`
- `/lfg close`
- `/lfg cancel`
- 署名付き参加・辞退Button
- Studio募集作成、検索、status絞り込み、詳細、強制close/cancel
- 自動期限切れ
- Discord表示の再同期
- 削除された募集中メッセージの再投稿
- 終了済み募集の保持期間Soft Delete

## データと競合防止

募集作成はGuild LockとChannel Lock、参加・辞退・終了・表示同期はPost LockをPostgreSQL Transaction Advisory Lockで取得します。

参加処理は同じTransaction内で次の順に行います。

1. Post Lock取得
2. Guild IDを含めて募集を再取得
3. 期限とstatusを確認
4. 同一ユーザーの参加状態を確認
5. `joined`人数を再集計
6. 定員を確認
7. participantと`participant_count`を更新
8. `version`を増加
9. Audit Logを記録

`lfg_participants`の複合主キー`(lfg_id, user_id)`とPost Lockにより、二重参加と定員超過を防ぎます。

## Discord表示同期

DB更新時は`message_state = 'pending'`へ変更します。BotがButton操作やclose/cancelコマンドの応答内で更新できた場合は、その募集versionと一致する場合だけ`active`へ戻します。

Workerも`pending`と再試行可能な`failed`を走査し、DiscordメッセージをPATCHします。更新対象のversionが途中で変化した場合、古い表示結果を`active`扱いにしません。次回走査で新しいversionを再同期します。

Discordメッセージが削除された場合、`message_id`をNULL、`message_state`を`missing`へ変更します。Pluginが有効で募集が`open`または`full`ならWorkerが再投稿します。

## Button改ざん防止

Button custom IDは次の形式です。

```text
lfg:<join|leave>:<post UUID>:<HMAC署名>
```

- HMAC SHA-256
- 署名比較は`timingSafeEqual`
- `LFG_COMPONENT_SECRET`は32文字以上
- BotとWorkerへ同一secretを設定
- action、post ID、署名のいずれかが改ざんされたButtonは拒否

secret生成例:

```bash
openssl rand -base64 32
```

## メンションとログ

- `@everyone`と`@here`は拒否
- ロールメンションは拒否
- ユーザーメンションは既定で拒否
- Discord送信時は`allowed_mentions.parse = []`
- 説明本文はAudit Log、利用分析、Workerログへ複製しない
- Discord API response body、Bot token、stackをログへ保存しない
- WorkerログはGuild ID、募集ID、件数、安全なerror nameだけを出力

参加者のDiscord user IDは、参加管理に必要なため`lfg_participants`へ保存します。

## Audit Logと利用分析

次のAudit eventを記録します。

- `lfg.create`
- `lfg.join`
- `lfg.leave`
- `lfg.close`
- `lfg.cancel`
- `lfg.expire`

説明本文は`changes`へ保存しません。利用状況は既存Audit Logを安全に集計できます。

```sql
SELECT event, COUNT(*)
FROM audit_logs
WHERE guild_id = '<GUILD_ID>'
  AND event LIKE 'lfg.%'
  AND created_at >= NOW() - INTERVAL '30 days'
GROUP BY event
ORDER BY event;
```

Slash Commandの成功・失敗・処理時間は既存Command Analyticsにも記録されます。Buttonのjoin/leaveはAudit eventで集計します。

## Worker設定

```env
DISCORD_BOT_TOKEN=...
LFG_COMPONENT_SECRET=...
LFG_SCAN_INTERVAL_SECONDS=30
```

`LFG_SCAN_INTERVAL_SECONDS`は10〜300秒に制限され、既定は30秒です。

Workerは次を順に処理します。

1. Pluginが有効なGuildの期限切れ募集を`expired`へ変更
2. `pending`または再試行可能な`failed`メッセージを再同期
3. 削除・未投稿の募集中メッセージを再投稿
4. 1時間ごとに保持期間を超えた終了済み募集をSoft Delete

Plugin無効中は期限切れ、表示同期、メッセージ復旧を実行しません。再有効化後の走査で現在時刻を基準に処理します。保持期間Soft Deleteはデータライフサイクル処理としてPluginの有効・無効に関係なく実行します。

## migration

本番適用前にバックアップを取得します。

```bash
pg_dump --format=custom --file=herta-before-lfg-v1.dump "$DATABASE_URL"
pnpm --filter @herta/db migrate:deploy
```

主な変更:

- 既存`lfg_posts`を保持したまま期限、参加人数、message状態、versionを追加
- 既存`lfg_participants`へGuild IDとleave時刻を追加
- 既存募集の作成者を参加者として補完
- 参加人数を既存participantから再集計
- 時刻を`TIMESTAMPTZ(3)`へ統一
- status・人数・期限のCHECK制約を`NOT VALID`で追加
- 期限切れ走査Indexを`CREATE INDEX CONCURRENTLY`で追加

### 既存データ確認

```sql
SELECT id, guild_id, status, max_players, participant_count, created_at, expires_at
FROM lfg_posts
WHERE status NOT IN ('open', 'full', 'closed', 'cancelled', 'expired')
   OR max_players < 2
   OR participant_count < 1
   OR participant_count > max_players
   OR expires_at <= created_at;

SELECT lfg_id, user_id, status
FROM lfg_participants
WHERE status NOT IN ('joined', 'left');
```

不整合を修正した後、低負荷時間帯に制約を検証します。

```sql
ALTER TABLE lfg_posts VALIDATE CONSTRAINT lfg_posts_status_check;
ALTER TABLE lfg_posts VALIDATE CONSTRAINT lfg_posts_message_state_check;
ALTER TABLE lfg_posts VALIDATE CONSTRAINT lfg_posts_player_count_check;
ALTER TABLE lfg_posts VALIDATE CONSTRAINT lfg_posts_expiry_check;
ALTER TABLE lfg_participants VALIDATE CONSTRAINT lfg_participants_status_check;
```

## 実Guild QA

1. `LFG_COMPONENT_SECRET`をBotとWorkerへ同じ値で設定
2. 検証GuildだけでPluginを有効化
3. `/lfg create`で募集を作成
4. 作成者が最初の参加者として表示されることを確認
5. 複数ユーザーで同時に参加し、定員を超えないことを確認
6. 同一ユーザーが二重参加できないことを確認
7. 作成者が辞退できず、cancelへ案内されることを確認
8. 満員後の辞退で`open`へ戻ることを確認
9. 改ざんしたcustom IDが拒否されることを確認
10. close/cancel後にButtonが無効化されることを確認
11. 募集期限後に`expired`となりButtonが無効化されることを確認
12. 募集中メッセージを削除し、Workerが再投稿することを確認
13. Worker停止中にjoinし、再起動後に最新versionへ同期されることを確認
14. Plugin無効中に期限切れ・復旧・同期が止まることを確認
15. Studioの検索、status絞り込み、詳細、強制close/cancelを確認
16. 別Guildの募集IDをAPI・Button・コマンドから操作できないことを確認
17. Audit LogとWorkerログへ説明本文が出ていないことを確認

## rollback

アプリだけを戻す場合は、先にLFG Pluginを全Guildで無効化し、BotとWorkerを旧imageへ戻します。追加列とparticipant情報は旧アプリから参照されないため、緊急時はDBを保持したままrollbackできます。

DBも戻す場合はBotとWorkerを停止し、バックアップを復元します。

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml stop bot worker
dropdb --if-exists herta_restore
createdb herta_restore
pg_restore --clean --if-exists --dbname=herta_restore herta-before-lfg-v1.dump
```

稼働中にLFG列・Index・participantを削除すると、Button操作やWorker同期と競合します。DDLによる部分rollbackではなく、バックアップ復元を基本とします。
