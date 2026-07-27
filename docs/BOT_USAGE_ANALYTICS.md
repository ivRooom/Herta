# Bot利用状況ダッシュボード

Herta BotのSlash Command利用状況をPostgreSQLへ記録し、Herta Studioの`/dashboard/analytics`から確認するための運用資料です。

## 取得する情報

`command_execution_events`へ以下の情報だけを保存します。

- Guild ID
- Slash Command名
- 成功または失敗
- 処理時間
- 失敗時のJavaScriptエラー名
- 実行日時

以下は保存しません。

- DiscordユーザーID
- ユーザー名
- チャンネルID
- Slash Commandのオプション値
- メッセージ本文
- 例外メッセージやスタックトレース

エラーの詳細は従来どおりBotログで確認し、ダッシュボードには`Error`や`TypeError`などのエラー名だけを表示します。

## 表示内容

- 本日のコマンド実行数
- 過去7日間の実行数
- 過去7日間の成功率
- Botが現在参加しているGuild数
- 過去7日の日次推移
- コマンド別ランキング上位8件
- 直近10件の失敗

日付の集計基準は`Asia/Tokyo`です。

## データ保持

コマンド実行履歴は90日間保持します。Bot起動時および起動後24時間ごとに、90日より古いデータを削除します。一度の削除が失敗しても、次回の定期実行で再試行します。

履歴の記録や削除に失敗しても、Slash Commandの実行処理、Discordへの応答、Bot起動は継続します。

## 本番反映

PRを`main`へマージすると、`Deploy Production` Workflowが次を自動実行します。

1. 本番Docker imageをBuild
2. GHCRへcommit SHAタグでPush
3. Lightsailの`/app/herta`を`main`へ更新
4. Prisma migratorで`command_execution_events`を作成
5. API、Studio、Bot、Workerを新imageで再作成
6. API、Auth.js、Discord Botのヘルスチェック

通常はLightsailで手動migrationを実行する必要はありません。

## マージ後の確認

### 1. GitHub Actions

GitHubの`Actions > Deploy Production`で、最新Runの次のJobが成功していることを確認します。

- `Build and push production image`
- `SSH Deploy to Lightsail`
- 外部Health check

### 2. 本番commitとコンテナ

```bash
cd /app/herta

git log -1 --oneline

docker compose \
  --env-file .env.production \
  -f docker-compose.prod.yml \
  ps
```

`api`、`studio`、`bot`、`worker`が同じ最新commit SHA imageで起動していることを確認します。

### 3. migration

```bash
cd /app/herta

docker compose \
  --env-file .env.production \
  -f docker-compose.prod.yml \
  ps -a migrator

docker compose \
  --env-file .env.production \
  -f docker-compose.prod.yml \
  logs --tail=100 migrator
```

`migrator`の終了コードが`0`で、`20260727150000_add_command_execution_events`が適用済みであることを確認します。

テーブルの存在確認は、PostgreSQLコンテナ内で環境変数を展開する次のコマンドを使用します。

```bash
cd /app/herta

docker compose \
  --env-file .env.production \
  -f docker-compose.prod.yml \
  exec -T postgres sh -lc \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "\\d command_execution_events"'
```

シェル側へ`POSTGRES_USER`と`POSTGRES_DB`を明示的にexport済みの場合に限り、次の直接実行も使用できます。

```bash
docker compose \
  --env-file .env.production \
  -f docker-compose.prod.yml \
  exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c '\d command_execution_events'
```

### 4. Botヘルス

```bash
curl -fsS http://127.0.0.1:3000/healthz | python3 -m json.tool
```

次を確認します。

- `status`が`operational`
- `guild_count`が0以上
- `discord.status`が`ok`
- `database.status`が`ok`
- `redis.status`が`ok`
- `worker.status`が`ok`

### 5. コマンド記録

Discordで`/ping`などのSlash Commandを1回実行します。

その後、最新履歴を確認します。

```bash
cd /app/herta

docker compose \
  --env-file .env.production \
  -f docker-compose.prod.yml \
  exec -T postgres sh -lc \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "
    SELECT command_name, status, duration_ms, error_name, executed_at
    FROM command_execution_events
    ORDER BY executed_at DESC
    LIMIT 10;
  "'
```

`ping`などの実行したコマンドが`success`として表示されれば記録成功です。

### 6. Studio

ログイン後、次を開きます。

```text
https://herta.ivrm.jp/dashboard/analytics
```

確認項目:

- 本日の実行数が増えている
- 過去7日間のグラフへ件数が表示される
- 成功率が表示される
- Bot参加サーバー数が表示される
- コマンドランキングへ実行したコマンドが表示される

## トラブルシューティング

### 画面が404

本番Studioが古いimageです。`Deploy Production`の完了と、Studioのimage SHAを確認します。

### 「利用状況を取得できませんでした」

次を確認します。

```bash
cd /app/herta

docker compose \
  --env-file .env.production \
  -f docker-compose.prod.yml \
  logs --tail=200 studio migrator postgres
```

主な原因:

- migration未適用
- PostgreSQL停止
- Studioの`DATABASE_URL`不正
- `command_execution_events`が存在しない

### コマンドを実行しても件数が増えない

```bash
cd /app/herta

docker compose \
  --env-file .env.production \
  -f docker-compose.prod.yml \
  logs --tail=200 bot | grep -E 'コマンド利用状況|Slash Command'
```

`コマンド利用状況の記録に失敗しました`がある場合は、migrationとBotのDB接続を確認します。
