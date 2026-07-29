# Team Split Plugin v1 Runbook

## 概要

Team Split PluginはDiscord上で参加者を受け付け、`random`または`balanced`方式でチームを編成します。

- `random`: HMAC由来の決定論的順序をround-robinで配置
- `balanced`: 管理者または参加者が明示したscoreだけを使用し、score降順の蛇行配置
- 未指定scoreは中立値`0`
- ロール、メッセージ、プロフィール等から能力値を推測しない
- 入力seedと内部`seed_hash`はDiscord・Audit Log・Workerログへ出さない

## コマンド

```text
/team create
/team add
/team remove
/team split
/team reroll
/team show
/team close
```

受付中メッセージには参加・辞退Buttonを表示します。分割・終了・期限切れ後はButtonを無効化します。

## 環境変数

Bot・Worker・Studioへ同じ値を設定します。

```env
TEAM_SPLIT_SECRET=<32文字以上のランダム値>
TEAM_SPLIT_SCAN_INTERVAL_SECONDS=30
```

生成例:

```bash
openssl rand -base64 48
```

`TEAM_SPLIT_SECRET`は次に使用します。

- Button custom IDのHMAC署名
- requested seedを非公開の`seed_hash`へ変換

既存セッションが残っている状態で鍵を変更すると、既存Buttonは無効になります。ローテーション時は受付中セッションを終了するか、移行期間を設計してください。

## Database migration

対象migration:

```text
20260729152000_team_split_plugin_v1
20260729152100_team_split_expiry_index_concurrently
```

### 適用前

1. PostgreSQLバックアップを取得する
2. `team_split_sessions`の件数とstatus別件数を保存する
3. 既存`participants`配列の空値・重複・作成者欠落を確認する
4. 復元コマンドを実行可能な状態にする

確認例:

```sql
SELECT status, COUNT(*) FROM team_split_sessions GROUP BY status ORDER BY status;

SELECT id, guild_id, creator_id, participants
FROM team_split_sessions
WHERE creator_id <> ALL(participants)
   OR array_position(participants, NULL) IS NOT NULL;
```

### 通常migration

通常のPrisma migrationを適用します。

```bash
pnpm --filter @herta/db exec prisma migrate deploy --schema prisma/schema.prisma
```

通常migrationでは以下を行います。

- `team_split_sessions`を破壊せず拡張
- 時刻を`TIMESTAMPTZ(3)`へ統一
- `team_split_participants`を作成
- legacy `participants`配列と作成者から参加者を補完
- participant countを再集計
- status・mode・message state・人数・期限・participant scoreの制約を`NOT VALID`で追加

### Concurrent index

`CREATE INDEX CONCURRENTLY`はtransaction外で実行します。

```bash
psql "$DATABASE_URL" \
  -v ON_ERROR_STOP=1 \
  -f packages/db/prisma/migrations/20260729152100_team_split_expiry_index_concurrently/migration.sql
```

### 適用後確認

```sql
SELECT COUNT(*) FROM team_split_sessions;
SELECT COUNT(*) FROM team_split_participants;

SELECT session.id, session.participant_count, COUNT(participant.*) AS joined_count
FROM team_split_sessions AS session
LEFT JOIN team_split_participants AS participant
  ON participant.session_id = session.id
 AND participant.status = 'joined'
GROUP BY session.id, session.participant_count
HAVING session.participant_count <> COUNT(participant.*);

SELECT participant.session_id, participant.guild_id, session.guild_id
FROM team_split_participants AS participant
JOIN team_split_sessions AS session ON session.id = participant.session_id
WHERE participant.guild_id <> session.guild_id;
```

上記不整合SQLは0件であることを確認します。

### CHECK制約のVALIDATE

既存データ確認後に実行します。

```sql
ALTER TABLE team_split_sessions VALIDATE CONSTRAINT team_split_sessions_status_check;
ALTER TABLE team_split_sessions VALIDATE CONSTRAINT team_split_sessions_mode_check;
ALTER TABLE team_split_sessions VALIDATE CONSTRAINT team_split_sessions_message_state_check;
ALTER TABLE team_split_sessions VALIDATE CONSTRAINT team_split_sessions_counts_check;
ALTER TABLE team_split_sessions VALIDATE CONSTRAINT team_split_sessions_expiry_check;
ALTER TABLE team_split_participants VALIDATE CONSTRAINT team_split_participants_status_check;
ALTER TABLE team_split_participants VALIDATE CONSTRAINT team_split_participants_score_check;
```

## 競合防止

- Guild lock: 作成上限
- Channel lock: チャンネル上限とCooldown
- Session lock: join、leave、split、reroll、close、message同期
- `(session_id, user_id)`複合主キー: 二重参加防止
- Transaction内でjoined件数と参加者一覧を再取得
- `version`一致時だけDiscord表示を`active`へ変更

複数ユーザーが同時に最後の枠へ参加しても、Session advisory lockにより定員を超えません。

## Discord表示同期

状態変更時は`message_state = pending`となります。

Workerは以下を行います。

1. `pending`または再試行可能な`failed`をPATCH
2. `missing`またはmessage ID未設定の進行中セッションをPOST
3. 作成時はセッションID＋version由来の25文字nonceと`enforce_nonce: true`を使用
4. DB link時にversionが変わっていた場合、古い新規投稿を削除
5. PATCH 404は`missing`へ戻して再投稿

短時間のDiscord nonce保証を利用するため、長期間後の手動再試行を含む絶対的Exactly-onceではありません。DBのmessage IDとDiscordチャンネルを併せて確認してください。

## Plugin無効化

GuildでPluginを無効にすると、次が停止します。

- Slash Command・Button処理
- Workerの期限切れ
- Discord表示同期
- 削除メッセージ復旧

再有効化後、Workerの次回走査で期限切れ・pending・missing状態を回収します。

## 保持期間

Workerは1時間ごとにGuild設定を確認し、`retentionDays`を超えた`closed`・`expired`セッションをSoft Deleteします。

- 既定90日
- participant rowはsession FKのため、物理削除しない限り保持
- Studio通常一覧は`deleted_at IS NULL`のみ表示

## 実Discord Guild QA

### 基本操作

1. `/team create`でrandomセッションを作成
2. 作成者が最初の参加者として表示される
3. Buttonで参加・辞退
4. 同一ユーザーの二重参加を拒否
5. 作成者の辞退を拒否
6. 満員時に参加Buttonが無効になる
7. `/team split`でチーム結果を表示
8. split後に参加・辞退Buttonが無効になる
9. `/team reroll`でgenerationが増え、結果が再計算される
10. `/team close`で終了する

### balanced

1. 明示scoreを設定して参加者を追加
2. 未指定scoreが0として表示される
3. チームごとの合計scoreを確認する
4. Audit LogやWorkerログに個別score一覧やseedが不要に複製されていないことを確認する

### 競合・復旧

1. 定員残り1で複数アカウントから同時join
2. joined件数が最大人数を超えないことを確認
3. 募集メッセージを削除
4. Workerが再投稿することを確認
5. Workerを停止した状態でjoinし、再起動後に表示が同期されることを確認
6. 同期中に追加joinし、古いversionがactive扱いされないことを確認
7. Plugin無効中に期限を迎え、処理が停止することを確認
8. 再有効化後に期限切れへ回収されることを確認

## Studio QA

URL:

```text
/dashboard/guilds/<guildId>/team-split
```

確認項目:

- セッション作成
- タイトル・ID検索
- status絞り込み
- 詳細・参加者・score・結果表示
- 参加者追加・削除
- split・reroll・強制終了
- Plugin無効表示
- message missing/failed警告
- 他Guildのsession IDをAPIへ指定しても取得・更新できない

## Audit・プライバシー

Audit event:

```text
team_split.create
team_split.join
team_split.score_update
team_split.leave
team_split.split
team_split.reroll
team_split.close
team_split.expire
```

保存しないもの:

- requested seed
- seed hash
- Discord API response body
- Bot token
- stack trace
- チーム結果全体の不要な複製

ログはGuild ID、session ID、件数、安全なerror nameを中心に記録します。

## ロールバック

アプリだけを戻す場合でも、新しいmigrationを適用済みなら旧アプリが拡張列を無視できることを確認します。

安全な順序:

1. Bot・Worker・Studioを停止
2. migration前バックアップからDBを復元
3. 旧imageへ切り替え
4. Composeを起動
5. Health・Guild同期・既存Pluginを確認

拡張列と`team_split_participants`を手動DROPして巻き戻す方法は、既存データを失うため推奨しません。
