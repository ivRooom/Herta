# 開発環境構築ガイド

Herta. のローカル開発環境をセットアップする手順です。

## 前提条件

- **Node.js** >= 22.0.0
- **pnpm** >= 9.15
- **Docker** および **Docker Compose**
- **Git**

### Node.js のインストール

[nvm](https://github.com/nvm-sh/nvm) の使用を推奨します。

```bash
nvm install 22
nvm use 22
```

### pnpm のインストール

```bash
corepack enable
corepack prepare pnpm@9.15.4 --activate
```

## 環境変数の設定

```bash
cp .env.example .env
```

`.env` を開き、Discord 関連の値を入力してください。

```dotenv
DISCORD_CLIENT_ID=<Discord Application の Client ID>
DISCORD_CLIENT_SECRET=<Discord Application の Client Secret>
DISCORD_BOT_TOKEN=<Discord Bot Token>
NEXTAUTH_SECRET=<openssl rand -base64 32 で生成>
```

その他の変数はデフォルト値で開発環境として動作します。

> 各変数の詳細は [README の環境変数セクション](../README.md#環境変数) を参照してください。

## インフラの起動

Docker Compose で PostgreSQL と Redis を起動します。

```bash
docker compose up -d
```

起動確認:

```bash
docker compose ps
# postgres と redis が Running であること
```

## 依存パッケージのインストール

```bash
pnpm install
```

## データベースの初期化

### Prisma クライアント生成

```bash
pnpm db:generate
```

### マイグレーション実行

```bash
pnpm db:migrate
```

初回は `init` マイグレーションが適用され、全テーブルが作成されます。

### 確認

```bash
docker exec herta-postgres-1 psql -U postgres -d herta -c "\dt"
```

23 のテーブルが表示されれば成功です。

## ビルド

```bash
pnpm build
```

全 18 パッケージが正常にビルドされることを確認してください。

## 型チェック

```bash
pnpm typecheck
```

## 各アプリの起動

### 一括起動

```bash
pnpm dev
```

API / Bot / Studio / Worker が同時に起動します。

### 個別起動

```bash
# API のみ
pnpm dev --filter @herta/api

# Bot のみ
pnpm dev --filter @herta/bot

# Studio のみ
pnpm dev --filter @herta/studio

# Worker のみ
pnpm dev --filter @herta/worker
```

## API の動作確認

API が起動したら、以下のエンドポイントにアクセスしてください。

```bash
curl http://localhost:3001/api/v1/health
# => {"status":"ok","service":"herta-api","timestamp":"..."}
```

Swagger ドキュメント: http://localhost:3001/api/docs

## Studio の動作確認

ブラウザで http://localhost:3000 を開いてください。

「Herta Studio」のページが表示されれば成功です。

## Bot の動作確認

Bot を起動すると、以下のログが表示されます。

```
INFO (herta-bot): Herta Bot を起動しています...
INFO (herta-bot): Herta Bot がログインしました
    username: "YourBot#1234"
    guilds: 1
```

`DISCORD_BOT_TOKEN` が未設定の場合:

```
FATAL (herta-bot): Bot の起動に失敗しました
    err.message: "DISCORD_BOT_TOKEN が設定されていません"
```

## Worker の動作確認

Worker を起動すると、Redis 接続を検証します。

```
INFO (herta-worker): Herta Worker を起動しています...
INFO (herta-worker): Redis 接続成功
INFO (herta-worker): Herta Worker を起動しました
```

Redis が起動していない場合:

```
ERROR (herta-worker): Redis 接続に失敗しました。REDIS_URL を確認してください。docker compose up -d で Redis を起動できます
```

## Discord Developer Portal の設定

Bot / OAuth2 の設定は [README の Discord Developer Portal セクション](../README.md#discord-developer-portal-の設定) を参照してください。

## トラブルシューティング

詳細は [README のよくあるエラーセクション](../README.md#よくあるエラー) を参照してください。
