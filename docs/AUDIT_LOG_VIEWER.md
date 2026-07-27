# Guild監査ログビューア

Herta Studioから、Guild単位の管理操作履歴を確認するための運用資料です。

## 対象画面

```text
/dashboard/guilds/{guildId}/audit-logs
```

Guild詳細画面の「監査ログ」カードから開けます。

## 表示対象

現在は、既存の`audit_logs`へ記録されている主に以下のイベントを表示します。

- `plugin.enable`
- `plugin.disable`
- `plugin.config_update`
- `quote.create`
- `quote.update`
- `quote.delete`
- 将来追加されるその他イベント

各ログでは次を確認できます。

- 操作種別
- 重要度
- 実行日時
- 実行者名
- 実行者ID
- 対象種別と対象ID
- DiscordまたはHerta Studioの実行元
- 監査ログID

## セキュリティとプライバシー

監査ログDBにはイベントごとに`changes`や`metadata`が保存されていますが、画面とAPIでは生のJSONを返しません。

表示しない情報:

- Plugin設定値
- Token、Secret、Password、Webhook URLなどの設定内容
- Quote本文
- 削除前のQuote本文
- Discordメッセージ本文
- スタックトレース
- セッション情報
- IPアドレス

画面にはイベントコードから生成した定型要約だけを表示します。未知イベントについても、`changes`と`metadata`を展開せず、イベントコードと対象情報だけを表示します。

## 権限

監査ログ画面とAPIは、次の両方を満たす場合だけ利用できます。

1. Herta StudioへDiscord OAuthでログイン済み
2. Discord上で対象GuildのOwner、Administrator、またはManage Guild権限を保持

権限は画面表示時とAPIアクセス時にDiscord APIで再確認します。URLのGuild IDを書き換えても、管理権限がないGuildのログは取得できません。

## 検索条件

次の条件を組み合わせられます。

- イベントコード・実行者ID・対象IDの部分一致
- Plugin、Quote、その他のカテゴリ
- 情報、注意、エラー、重大の重要度
- 日本時間の開始日と終了日
- ページング

1ページは既定25件、最大50件です。日付は`Asia/Tokyo`基準で、終了日は指定日の23:59:59までを対象にします。

## API

```http
GET /api/guilds/{guildId}/audit-logs
```

Query parameter:

- `search`
- `category=all|plugin|quote|other`
- `severity=all|info|warning|error|critical`
- `from=YYYY-MM-DD`
- `to=YYYY-MM-DD`
- `page`
- `pageSize`

レスポンスには安全な表示用DTOだけを含め、Prismaの`changes`と`metadata`は含めません。

## 本番反映

この変更にはPrisma migrationと新しい環境変数はありません。

`main`へマージすると、既存の`Deploy Production`が次を自動実行します。

1. 本番Docker imageをBuild
2. GHCRへcommit SHAタグでPush
3. Lightsailの`main`を更新
4. 既存migrationの適用確認
5. Studioを含むアプリコンテナを再作成
6. API、Auth.js、Discord Botのヘルスチェック

## マージ後の確認

### 1. GitHub Actions

GitHubの`Actions > Deploy Production`で、最新Runが成功していることを確認します。

主な確認対象:

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

`studio`が最新commit SHAのimageで起動していることを確認します。

```bash
docker compose \
  --env-file .env.production \
  -f docker-compose.prod.yml \
  images studio
```

### 3. Studioログ

```bash
cd /app/herta

docker compose \
  --env-file .env.production \
  -f docker-compose.prod.yml \
  logs --tail=200 studio
```

次のエラーがないことを確認します。

- `Audit log dashboard request failed`
- `Audit log API request failed`
- Prisma接続エラー
- Auth.jsセッションエラー

### 4. 既存ログの確認

監査ログの最新20件をPostgreSQLで確認します。

```bash
cd /app/herta

docker compose \
  --env-file .env.production \
  -f docker-compose.prod.yml \
  exec -T postgres sh -lc \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "
    SELECT event, severity, created_at
    FROM audit_logs
    ORDER BY created_at DESC
    LIMIT 20;
  "'
```

`plugin.*`または`quote.*`が存在する場合は、画面にも同じイベントが表示されます。

### 5. 画面確認

1. Herta Studioへログイン
2. 管理可能なサーバーを開く
3. 「監査ログ」を開く
4. イベント一覧が表示されることを確認
5. カテゴリ、重要度、期間、検索を確認
6. 「調査用IDを表示」を開く
7. Plugin設定値やQuote本文が表示されていないことを確認

URL例:

```text
https://herta.ivrm.jp/dashboard/guilds/{guildId}/audit-logs
```

### 6. 新しいログの確認

StudioでPluginを有効化または無効化します。

その後、監査ログ画面で次を確認します。

- `Pluginを有効化`または`Pluginを無効化`
- 対象Plugin ID
- 操作したユーザー
- 実行日時
- 重要度「情報」

Quote Pluginが有効な場合は、Quoteの登録・更新・削除でも確認できます。

### 7. 権限確認

管理権限がない別Guild IDへURLを書き換え、ログを閲覧できないことを確認します。

APIも同様に確認します。

```bash
curl -i 'https://herta.ivrm.jp/api/guilds/管理権限のないGuildID/audit-logs'
```

未認証の場合は`401`、認証済みで権限がない場合は`403`となります。ブラウザ画面は管理対象外Guildを404として扱います。

## トラブルシューティング

### 画面が404

主な原因:

- Studioが古いimage
- 対象Guildの管理権限がない
- Discord OAuth Tokenが期限切れ
- URLのGuild IDが誤っている

`Deploy Production`の完了、Studio image SHA、Discord再ログインを確認します。

### 「監査ログを取得できませんでした」

```bash
cd /app/herta

docker compose \
  --env-file .env.production \
  -f docker-compose.prod.yml \
  logs --tail=200 studio postgres
```

主な原因:

- PostgreSQL停止
- Studioの`DATABASE_URL`不正
- Prisma Client初期化失敗
- `audit_logs`テーブルが存在しない

### ログが0件

監査ログ機能の導入前から`audit_logs`テーブルは存在しますが、実際にログを書き込む操作を行っていないGuildでは0件です。

Pluginの有効化・無効化、Plugin設定変更、Quoteの作成・更新・削除を行ってから再確認します。

### 実行者名が「Discordユーザー」になる

`users`テーブルに対応するユーザー情報がない場合は、推測した名前を表示せず「Discordユーザー」と表示します。調査用IDからDiscord User IDを確認できます。
