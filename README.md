# Herta.

**Discord Community Operating System** — Guild 管理・モデレーション・自動化を統合するモノレポプラットフォーム。

## 構成

```
herta/
├── apps/
│   ├── api          … NestJS REST API (ポート 3001)
│   ├── bot          … discord.js Bot クライアント
│   ├── studio       … Next.js 管理ダッシュボード (ポート 3000)
│   └── worker       … BullMQ バックグラウンドワーカー
├── packages/
│   ├── config       … 共通設定 (ESLint / TS / Tailwind)
│   ├── db           … Prisma スキーマ・クライアント
│   ├── logger       … pino ベース構造化ロガー
│   ├── plugin-sdk   … Plugin 開発 SDK
│   ├── queue        … BullMQ キュー定義
│   ├── rule-engine  … ルール評価エンジン
│   ├── shared       … 型定義・定数・ユーティリティ
│   └── ui           … 共通 UI コンポーネント (shadcn/ui)
├── plugins/
│   ├── auto-response … キーワード自動応答
│   ├── daily-content … 定時配信
│   ├── lfg           … Looking For Group
│   ├── moderation    … モデレーション (NG ワード / スパム)
│   ├── quote         … 名言保存
│   └── team-split    … チーム分け
├── deploy/           … 本番デプロイ設定 (nginx, scripts)
└── docker-compose.yml
```

## 必要なツール

| ツール | バージョン |
|--------|-----------|
| Node.js | >= 22.0.0 |
| pnpm | >= 9.15 |
| Docker / Docker Compose | 最新推奨 |

## クイックスタート

```bash
# 1. リポジトリをクローン
git clone https://github.com/ivRooom/Herta.git
cd Herta

# 2. 環境変数を設定
cp .env.example .env
# .env を編集して Discord Bot Token などを入力

# 3. 依存パッケージをインストール
pnpm install

# 4. PostgreSQL / Redis を起動
docker compose up -d

# 5. Prisma クライアント生成 & マイグレーション
pnpm db:generate
pnpm db:migrate

# 6. ビルド
pnpm build

# 7. 開発サーバーを起動
pnpm dev
```

## 環境変数

`.env.example` を `.env` にコピーし、以下の値を設定してください。

| 変数名 | 必須 | 説明 | デフォルト値 |
|--------|------|------|------------|
| `NODE_ENV` | - | 実行環境 | `development` |
| `DATABASE_URL` | Yes | PostgreSQL 接続 URL | `postgresql://postgres:postgres@localhost:5432/herta` |
| `REDIS_URL` | Yes | Redis 接続 URL | `redis://localhost:6379` |
| `DISCORD_CLIENT_ID` | Yes | Discord Application のクライアント ID | - |
| `DISCORD_CLIENT_SECRET` | Yes | Discord Application のクライアントシークレット | - |
| `DISCORD_BOT_TOKEN` | Yes | Discord Bot トークン | - |
| `DISCORD_PUBLIC_KEY` | - | Discord Interactions 用公開鍵 | - |
| `DISCORD_GUILD_ID_DEV` | - | 開発用 Guild ID | - |
| `DISCORD_CALLBACK_URL` | - | OAuth2 コールバック URL | `http://localhost:3001/api/v1/auth/discord/callback` |
| `API_PORT` | - | API サーバーポート | `3001` |
| `API_URL` | - | API の公開 URL | `http://localhost:3001` |
| `CORS_ORIGINS` | - | CORS 許可オリジン (カンマ区切り) | `http://localhost:3000` |
| `STUDIO_PORT` | - | Studio ポート | `3000` |
| `NEXTAUTH_URL` | - | NextAuth ベース URL | `http://localhost:3000` |
| `NEXTAUTH_SECRET` | Yes* | NextAuth セッション暗号化キー | - |
| `JWT_SECRET` | - | JWT 署名キー | 開発用デフォルト値あり |
| `JWT_REFRESH_SECRET` | - | JWT リフレッシュ用署名キー | 開発用デフォルト値あり |
| `JWT_EXPIRATION` | - | アクセストークン有効期間 | `15m` |
| `JWT_REFRESH_EXPIRATION` | - | リフレッシュトークン有効期間 | `7d` |
| `INTERNAL_JWT_SECRET` | - | Bot ↔ API 内部通信用署名キー | 開発用デフォルト値あり |
| `BOT_LOG_LEVEL` | - | Bot ログレベル | `debug` |
| `WORKER_LOG_LEVEL` | - | Worker ログレベル | `debug` |

> *`NEXTAUTH_SECRET` は Studio のセッション管理で必要です。`openssl rand -base64 32` で生成できます。

## Docker Compose

`docker-compose.yml` で PostgreSQL 16 と Redis 7 を起動します。

```bash
# 起動
docker compose up -d

# 停止
docker compose down

# データを含めて削除
docker compose down -v
```

| サービス | ポート | 用途 |
|---------|--------|------|
| postgres | 5432 | データベース |
| redis | 6379 | キャッシュ / キュー |

## データベース (Prisma)

スキーマは `packages/db/prisma/schema.prisma` にあります。

```bash
# Prisma クライアントを生成
pnpm db:generate

# マイグレーションを実行 (開発)
pnpm db:migrate

# スキーマを直接 DB に反映 (プロトタイプ用)
pnpm db:push

# Prisma Studio (GUI)
pnpm db:studio
```

> `db:*` コマンドはルートの `.env` を `dotenv-cli` 経由で読み込みます。

## 各アプリの起動

### API

```bash
pnpm dev --filter @herta/api
```

- URL: `http://localhost:3001`
- Health: `GET http://localhost:3001/api/v1/health`
- Swagger: `http://localhost:3001/api/docs`

### Studio (管理ダッシュボード)

```bash
pnpm dev --filter @herta/studio
```

- URL: `http://localhost:3000`

### Bot

```bash
pnpm dev --filter @herta/bot
```

- 起動には `DISCORD_BOT_TOKEN` が必須です
- 起動ログ → Discord ログイン成功 → Bot ユーザー名が表示されます
- `SIGINT` / `SIGTERM` で graceful shutdown します

### Worker

```bash
pnpm dev --filter @herta/worker
```

- 起動時に Redis 接続を検証します
- 接続失敗時はエラーメッセージと対処法が表示されます

### 全アプリ一括起動

```bash
pnpm dev
```

## ビルド / チェック

```bash
# ビルド
pnpm build

# 型チェック
pnpm typecheck

# フォーマット
pnpm format
pnpm format:check
```

## Discord Developer Portal の設定

Bot を動作させるには、[Discord Developer Portal](https://discord.com/developers/applications) で以下の設定が必要です。

1. **アプリケーションを作成**
   - [Applications](https://discord.com/developers/applications) → `New Application`

2. **Bot を設定**
   - `Bot` タブ → `Reset Token` でトークンを取得 → `.env` の `DISCORD_BOT_TOKEN` に設定
   - `Privileged Gateway Intents` で以下を有効化:
     - `PRESENCE INTENT`
     - `SERVER MEMBERS INTENT`
     - `MESSAGE CONTENT INTENT`

3. **OAuth2 を設定**
   - `OAuth2` タブ → `Client ID` / `Client Secret` を取得 → `.env` に設定
   - Redirects に `http://localhost:3001/api/v1/auth/discord/callback` を追加

4. **Bot を Guild に招待**
   - `OAuth2` → `URL Generator`:
     - Scopes: `bot`, `applications.commands`
     - Bot Permissions: `Administrator` (開発用) または必要な権限を個別に選択
   - 生成された URL をブラウザで開いて Guild に招待

5. **開発用 Guild ID**
   - Discord クライアントで開発者モードを有効化 → Guild を右クリック → `サーバー ID をコピー`
   - `.env` の `DISCORD_GUILD_ID_DEV` に設定

## よくあるエラー

### `DISCORD_BOT_TOKEN が設定されていません`

`.env` に `DISCORD_BOT_TOKEN` を設定してください。Discord Developer Portal の Bot タブからトークンをコピーできます。

### `prisma: Environment variable not found: DATABASE_URL`

ルートの `.env` ファイルに `DATABASE_URL` が設定されていることを確認してください。`db:*` コマンドは `dotenv-cli` 経由で `.env` を読み込みます。

### `Redis 接続に失敗しました`

Redis が起動しているか確認してください:

```bash
docker compose up -d redis
```

### `class-validator / class-transformer が見つからない`

API の依存関係が不足している場合:

```bash
pnpm --filter @herta/api add class-validator class-transformer
```

### `Port 3000 / 3001 is already in use`

他のプロセスがポートを使用しています:

```bash
lsof -i :3000
lsof -i :3001
```

### Prisma マイグレーションエラー

PostgreSQL が起動しているか確認:

```bash
docker compose up -d postgres
```

## セキュリティ

- `.env` は `.gitignore` に含まれています — 絶対にコミットしないでください
- `.env.example` にはシークレットの実値が含まれていません
- JWT / Bot Token / Client Secret は環境変数経由で注入してください
- 本番環境では全ての `dev-*-change-in-production` デフォルト値を変更してください

## ライセンス

Private — ivRooom
