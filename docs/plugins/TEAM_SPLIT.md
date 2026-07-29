# Team Split Plugin v1 Runbook

Team Split Pluginは、Discord上で参加者を集め、randomまたは明示scoreによるbalanced方式でチーム分けを行います。

## 環境変数

```dotenv
TEAM_SPLIT_SECRET=
TEAM_SPLIT_SCAN_INTERVAL_SECONDS=30
```

- `TEAM_SPLIT_SECRET`は32文字以上のランダム値を必須とする
- LFGなど他用途のsecretとは分離する
- Bot・Worker・Studioで同じ値を使用する
- `TEAM_SPLIT_SCAN_INTERVAL_SECONDS`は10〜300秒、既定30秒

生成例:

```bash
openssl rand -base64 32
```

## random / balanced

### random

- Guild ID・Session ID・requested seedから内部seed hashをHMAC生成する
- Discord、Studio、Audit Log、Workerログへrequested seedや内部seed hashを出さない
- 同じ参加者・seed hash・generationでは同じ結果を再現する
- reroll時はgenerationを増加させる

### balanced

- 管理者または参加者が明示したscoreだけを使用する
- 未指定scoreは中立値0
- score降順の蛇行配置を行う
- Discordロール、プロフィール、メッセージ、個人属性から能力値を推測しない

## Migration

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

SELECT session.id, participant.participant_id, COUNT(*) AS duplicate_count
FROM team_split_sessions AS session
CROSS JOIN LATERAL unnest(session.participants) AS participant(participant_id)
GROUP BY session.id, participant.participant_id
HAVING COUNT(*) > 1;
```

### 適用

通常のPrisma migrationを一度だけ適用します。

```bash
pnpm --filter @herta/db exec prisma migrate deploy --schema prisma/schema.prisma
```

この実行で両migrationを順番に適用します。`20260729152100_team_split_expiry_index_concurrently`のSQLを手動で再実行しません。

migrationでは以下を行います。

- `team_split_sessions`を破壊せず拡張
- 時刻を`TIMESTAMPTZ(3)`へ統一
- legacyで過去期限となる`open`・`split`行を`closed`へ移行し、Workerによる再処理を防止
- `team_split_participants`を作成
- legacy `participants`配列と作成者から参加者を補完
- participant countを再集計
- status・mode・message state・人数・期限・participant status・scoreの制約を`NOT VALID`で追加
- 期限走査用部分Indexを`CREATE INDEX CONCURRENTLY`で追加

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

SELECT id, status, expires_at, closed_at
FROM team_split_sessions
WHERE status IN ('open', 'split')
  AND expires_at <= CURRENT_TIMESTAMP;
```

すべての不整合確認SQLが0件であることを確認します。

## CHECK制約のVALIDATE

データ確認後に実行します。

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

- Guild、Channel、SessionごとにPostgreSQL Advisory Lockを取得する
- 参加者追加・辞退後、joined一覧を再取得する
- `participantCount`とlegacy互換`participants`配列は同じjoined一覧から更新する
- `(session_id, user_id)`複合主キーで二重参加を防止する
- message missing更新もTransactionとSession lock内で行う

## Discord表示同期

- 状態変更時に`message_state = pending`
- Session version一致時だけ`active`へ確定
- fresh pending行は作成直後60秒間Worker再投稿対象にしない
- missingメッセージ再投稿はSession ID＋version由来nonceと`enforce_nonce`を使用する
- WorkerはDiscordチャンネルの`guild_id`がSessionのGuild IDと一致することを確認する
- 404・Unknown Messageだけをmissing扱いにし、rate limit・timeout・DBエラーはfailedで再試行する
- Plugin無効GuildはLIMIT前に除外する

## 実Guild QA

1. `/team create`でrandomセッションを作成
2. join / leave Buttonを確認
3. 同時joinで最大人数を超えないことを確認
4. 同一ユーザーが二重登録されないことを確認
5. `/team split`で結果を確認
6. 同じ参加者・seedで結果を再現できることを確認
7. `/team reroll`でgenerationと結果が変わることを確認
8. balancedで明示scoreだけが使用されることを確認
9. `/team add`、`/team remove`、`/team show`、`/team close`を確認
10. 改ざん・期限切れButtonを拒否することを確認
11. split、close、expire後にButtonが無効化されることを確認
12. メッセージ削除後に1件だけ再投稿されることを確認
13. 別GuildのチャンネルIDを指定しても投稿されないことを確認
14. Plugin無効中に期限切れ・同期・復旧が停止し、再有効化後に回収されることを確認

## Studio・Audit・プライバシー

- 各APIでAuth.jsとDiscord Manage Guild権限を再検証する
- 別GuildのSession IDを取得・更新できないことを確認する
- Studio APIレスポンスから`seedHash`を除外する
- requested seed・seed hashを画面、API、Audit Log、Workerログへ出さない
- Discord API response body、Bot token、stack traceを保存しない

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

## Rollback

1. Bot・Worker・Studioを直前imageへ戻す
2. migration前バックアップからPostgreSQLを復元する
3. `.env.production`をバックアップ版へ戻す
4. Production Composeを再起動する
5. Bot health、Worker heartbeat、Studio、既存Pluginを確認する

DB migrationを適用した状態で旧imageだけを長時間稼働させません。
