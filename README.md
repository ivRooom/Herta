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
├── deploy/           … 本番デプロイ設定 (caddy / nginx / scripts)
├── certs/            … Cloudflare Origin Certificate 配置先
└── docker-compose.yml
```

## Plugin Manager

Studio の Guild 詳細画面にある **Plugin Manager** から、Guild ごとに公式 Plugin
（Moderation、Auto Response、Daily Content、LFG、Quote、Team Split）を有効化し、
JSON Schema に基づく設定を管理できます。設定変更はバージョン履歴と監査ログへ記録されます。

Plugin の manifest は `@herta/plugin-catalog` に集約され、Bot Plugin Loader は
`getEnabledPlugins(prisma, guildId)` で有効な Plugin と設定を取得します。詳細は
[docs/PLUGIN_MANAGER.md](docs/PLUGIN_MANAGER.md) を参照してください。

## Plugin Runtime

Plugin Manager で Guild ごとに有効化された Plugin は、Bot の静的 Runtime Registry と
Guild Plugin Runtime Loader により Command / Event provider へ安全に接続されます。DB 障害や
個別 Plugin の障害は Core Command の動作を妨げず、設定変更時は Guild 単位で再同期できます。
詳細は [docs/PLUGIN_RUNTIME.md](docs/PLUGIN_RUNTIME.md) を参照してください。

## 必要なツール

| ツール                  | バージョン |
| ----------------------- | ---------- |
| Node.js                 | >= 22.0.0  |
| pnpm                    | >= 9.15    |
| Docker / Docker Compose | 最新推奨   |

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

| 変数名                   | 必須 | 説明                                           | デフォルト値                                          |
| ------------------------ | ---- | ---------------------------------------------- | ----------------------------------------------------- |
| `NODE_ENV`               | -    | 実行環境                                       | `development`                                         |
| `DATABASE_URL`           | Yes  | PostgreSQL 接続 URL                            | `postgresql://postgres:postgres@localhost:5432/herta` |
| `REDIS_URL`              | Yes  | Redis 接続 URL                                 | `redis://localhost:6379`                              |
| `DISCORD_CLIENT_ID`      | Yes  | Discord Application のクライアント ID          | -                                                     |
| `DISCORD_CLIENT_SECRET`  | Yes  | Discord Application のクライアントシークレット | -                                                     |
| `DISCORD_BOT_TOKEN`      | Yes  | Discord Bot トークン                           | -                                                     |
| `DISCORD_PUBLIC_KEY`     | -    | Discord Interactions 用公開鍵                  | -                                                     |
| `DISCORD_GUILD_ID_DEV`   | -    | 開発用 Guild ID                                | -                                                     |
| `DISCORD_CALLBACK_URL`   | -    | OAuth2 コールバック URL                        | `http://localhost:3001/api/v1/auth/discord/callback`  |
| `API_PORT`               | -    | API サーバーポート                             | `3001`                                                |
| `API_URL`                | -    | API の公開 URL                                 | `http://localhost:3001`                               |
| `CORS_ORIGINS`           | -    | CORS 許可オリジン (カンマ区切り)               | `http://localhost:3000`                               |
| `ENABLE_SWAGGER`         | -    | 本番で Swagger を一時的に公開する              | `false`                                               |
| `STUDIO_PORT`            | -    | Studio ポート                                  | `3000`                                                |
| `NEXTAUTH_URL`           | -    | NextAuth ベース URL                            | `http://localhost:3000`                               |
| `NEXTAUTH_SECRET`        | Yes* | NextAuth セッション暗号化キー                  | -                                                     |
| `JWT_SECRET`             | -    | JWT 署名キー                                   | 開発用デフォルト値あり                                |
| `JWT_REFRESH_SECRET`     | -    | JWT リフレッシュ用署名キー                     | 開発用デフォルト値あり                                |
| `JWT_EXPIRATION`         | -    | アクセストークン有効期間                       | `15m`                                                 |
| `JWT_REFRESH_EXPIRATION` | -    | JWT リフレッシュトークン有効期間               | `7d`                                                  |
| `INTERNAL_JWT_SECRET`    | -    | Bot ↔ API 内部通信用署名キー                   | 開発用デフォルト値あり                                |
| `BOT_LOG_LEVEL`          | -    | Bot ログレベル                                 | `debug`                                               |
| `WORKER_LOG_LEVEL`       | -    | Worker ログレベル                              | `debug`                                               |

> *`NEXTAUTH_SECRET` は Studio のセッション管理で必要です。`openssl rand -base64 32` で生成できます。
>
> `DISCORD_CALLBACK_URL` は API (NestJS) 側の OAuth コールバックです。Dashboard のログインは NextAuth が `{NEXTAUTH_URL}/api/auth/callback/discord` を自動的に使用します。

> 全変数の詳細は [docs/ENVIRONMENT_VARIABLES.md](docs/ENVIRONMENT_VARIABLES.md) を参照してください。

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

| サービス | ポート | 用途                |
| -------- | ------ | ------------------- |
| postgres | 5432   | データベース        |
| redis    | 6379   | キャッシュ / キュー |

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

> `db:*` コマンドはルートの `.env` ファイルを `dotenv-cli` 経由で読み込みます。

## 各アプリの起動

### API

```bash
pnpm dev --filter @herta/api
```

- URL: `http://localhost:3001`
- Health: `GET http://localhost:3001/api/v1/health`
- Swagger: `http://localhost:3001/api/docs`
  - 開発環境では利用可能
  - 本番ではデフォルト非公開。調査時のみ `ENABLE_SWAGGER=true` を一時設定

### Studio (管理ダッシュボード)

```bash
pnpm dev --filter @herta/studio
```

- URL: `http://localhost:3000`
- Discord OAuth ログイン: `http://localhost:3000/login`
  - ログイン後、あなたが「管理者」または「サーバー管理」権限を持つ Guild のみが `/dashboard/guilds` に表示されます
  - 必要な環境変数: `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` / `NEXTAUTH_URL` / `NEXTAUTH_SECRET`
  - 詳細: [docs/AUTH.md](docs/AUTH.md)

### Bot

```bash
pnpm dev --filter @herta/bot
```

- 起動には `DISCORD_BOT_TOKEN` が必須です
- 起動ログ → Discord ログイン成功 → Bot ユーザー名が表示されます
- 開発環境では `DISCORD_GUILD_ID_DEV` があればその Guild を優先同期します
- 本番環境では Bot が参加している全 Guild を起動時に同期します
- 現在の Slash Command Runtime が要求する Gateway Intent は `Guilds` のみです
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
# フォーマット
pnpm format
pnpm format:check

# Lint
pnpm lint

# 型チェック
pnpm typecheck

# テスト
pnpm test

# ビルド
pnpm build
```

## Discord Developer Portal の設定

Bot を動作させるには、[Discord Developer Portal](https://discord.com/developers/applications) で以下の設定が必要です。

1. **アプリケーションを作成**
   - [Applications](https://discord.com/developers/applications) → `New Application`

2. **Bot を設定**
   - `Bot` タブ → `Reset Token` でトークンを取得 → `.env` の `DISCORD_BOT_TOKEN` に設定
   - 現在の Slash Command Runtimeでは Privileged Gateway Intent は不要です
   - 将来 Message Content / Guild Members 等を使う Plugin を追加する場合だけ、用途をレビューして必要な Intent を個別に有効化してください

3. **OAuth2 を設定**
   - `OAuth2` タブ → `Client ID` / `Client Secret` を取得 → `.env` に設定
   - Redirects に以下を追加:
     - Dashboard ログイン (NextAuth): `http://localhost:3000/api/auth/callback/discord`
       - 本番: `https://herta.ivrm.jp/api/auth/callback/discord`
     - API 側 (任意): `http://localhost:3001/api/v1/auth/discord/callback`
   - OAuth2 スコープ: `identify` `email` `guilds`

   > Dashboard ログインの詳細は [docs/AUTH.md](docs/AUTH.md) を参照してください。

4. **Bot を Guild に招待**
   - `OAuth2` → `URL Generator`:
     - Scopes: `bot`, `applications.commands`
     - Bot Permissions: `Administrator` (開発用) または必要な権限を個別に選択
   - 生成された URL をブラウザで開いて Guild に招待

5. **開発用 Guild ID**
   - Discord クライアントで開発者モードを有効化 → Guild を右クリック → `サーバー ID をコピー`
   - 開発用 `.env` の `DISCORD_GUILD_ID_DEV` に設定
   - `NODE_ENV=production` では全参加 Guild を同期するため、この値で同期先を制限しません

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

## 本番デプロイ / CI/CD

本番は **AWS Lightsail** 上で **Docker Compose** により稼働し、**GitHub Actions** で CI/CD を回します。

- **CI** (`.github/workflows/ci.yml`): PR / push 時に Format・Lint・Typecheck・Test・Build を実行 (デプロイなし)
- **Deploy** (`.github/workflows/deploy-production.yml`): `main` への push または手動実行 (`workflow_dispatch`) で、Lightsail へ SSH 接続し `git pull` → 共有アプリイメージを1回build → `up -d` → Origin / Cloudflare外部 health check を実行
- 本番 compose 定義: `docker-compose.prod.yml` / 共通イメージ: `Dockerfile`
- 運用スクリプト: `deploy/scripts/` (`setup` / `start` / `stop` / `deploy` / `health-check` / `rollback`)
- 本番経路: Cloudflare → Caddy (TLS 終端, Origin 証明書) → nginx → studio / api
- 本番ドメイン: `herta.ivrm.jp`
- Caddy 設定: `deploy/docker/caddy/Caddyfile`
- 証明書配置: `certs/origin.pem` / `certs/origin-key.pem`
- 公開ポート: 80/TCP, 443/TCP, 443/UDP (HTTP/3)
- Cloudflare SSL/TLS: `Full (strict)`
- 対応機能: HTTP→HTTPS リダイレクト / HTTP/2 / HTTP/3 / WebSocket
- API health: `GET https://herta.ivrm.jp/api/v1/health`

詳細な手順は [docs/DEPLOYMENT_LIGHTSAIL.md](docs/DEPLOYMENT_LIGHTSAIL.md) を参照してください。

### GitHub Secrets

本番シークレットは GitHub に直接書かず、`Settings > Secrets and variables > Actions` に登録します。

| Secret 名           | 説明                              | 例                                     |
| ------------------- | --------------------------------- | -------------------------------------- |
| `LIGHTSAIL_HOST`    | Lightsail の固定 IP または DNS 名 | `13.230.xx.xx`                         |
| `LIGHTSAIL_USER`    | SSH ユーザー                      | `ubuntu`                               |
| `LIGHTSAIL_SSH_KEY` | SSH 秘密鍵 (PEM 全文)             | `-----BEGIN OPENSSH PRIVATE KEY-----…` |
| `LIGHTSAIL_APP_DIR` | アプリ配置ディレクトリ            | `/app/herta`                           |

アプリ自身の本番環境変数 (Discord トークン等) は GitHub Secrets ではなく、Lightsail 上の `/app/herta/.env.production` に配置します (テンプレート: `.env.production.example`)。

## セキュリティ

- `.env` は `.gitignore` に含まれています — 絶対にコミットしないでください
- `.env.example` にはシークレットの実値が含まれていません
- JWT / Bot Token / Client Secret は環境変数経由で注入してください
- 本番環境では全ての `dev-*-change-in-production` デフォルト値を変更してください
- `Full (strict)`だけではOrigin直アクセスを禁止できないため、Authenticated Origin PullsまたはCloudflare IP allowlistを追加してください
- Secretローテーション、Origin保護、OAuth、Dockerの詳細は [docs/SECURITY.md](docs/SECURITY.md) を参照してください
