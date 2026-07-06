# 本番デプロイガイド (AWS Lightsail)

Herta. を AWS Lightsail 上で **Docker Compose** により本番稼働させ、
**GitHub Actions** で CI/CD を回すための手順書です。

- 本番ドメイン: `herta.ivrm.jp`
- デプロイ先: AWS Lightsail (単一インスタンス)
- ランタイム: Docker Compose (`docker-compose.prod.yml`)
- デプロイ方式: GitHub Actions から SSH 接続して `git pull` → `docker compose build` → `up -d`

---

## 1. 全体像

```
                 ┌──────────────────────────────────────┐
   git push main │            GitHub Actions             │
  ──────────────▶│  ci.yml (PR/CI) / deploy-production   │
                 └───────────────┬──────────────────────┘
                                 │ SSH (appleboy/ssh-action)
                                 ▼
                 ┌──────────────────────────────────────┐
                 │        AWS Lightsail インスタンス        │
                 │  /app/herta (git リポジトリ)            │
                 │                                        │
                 │  docker compose -f docker-compose.prod │
                 │   ├─ caddy   (:80/:443) → nginx(:80)    │
                 │   │             ↓                        │
                 │   │       herta.ivrm.jp                 │
                 │   ├─ nginx   (:80, 内部) → studio/api   │
                 │   ├─ studio  (:3000) Next.js           │
                 │   ├─ api     (:3001) NestJS            │
                 │   ├─ bot            discord.js         │
                 │   ├─ worker         BullMQ             │
                 │   ├─ postgres (:5432)                  │
                 │   └─ redis    (:6379)                  │
                 └──────────────────────────────────────┘
```

- **PR 時**: `ci.yml` が Lint / Typecheck / Build を実行 (デプロイなし)。
- **main への push / 手動実行時**: `deploy-production.yml` が Lightsail へ SSH し本番反映。

---

## 2. Lightsail 上のディレクトリ構成

アプリはリポジトリを丸ごと `/app/herta` に配置します
(`LIGHTSAIL_APP_DIR` で変更可能)。

```
/app/herta/                     … git クローン先 (= リポジトリルート)
├── docker-compose.prod.yml     … 本番 compose 定義
├── Dockerfile                  … 全アプリ共通イメージ
├── .env.production             … 本番環境変数 (コミットしない / 手動作成)
├── .env.production.example     … テンプレート
├── deploy/
│   ├── docker/caddy/Caddyfile   … Caddy TLS / リバースプロキシ設定
│   ├── docker/nginx/default.conf … nginx リバースプロキシ設定
│   └── scripts/                  … 運用スクリプト (setup/deploy/start/stop/…)
├── certs/
│   ├── origin.pem                … Cloudflare Origin 証明書
│   └── origin-key.pem            … Cloudflare Origin 秘密鍵
└── (apps / packages / plugins …)

Docker 管理ボリューム (ホスト上ではなく Docker が管理):
├── postgres_data               … PostgreSQL データ
└── redis_data                  … Redis データ
```

---

## 3. 前提条件

Lightsail インスタンス側に以下が必要です。

- Ubuntu 22.04 以降 (推奨)
- Docker Engine + Docker Compose v2
- Git
- 22 番 (SSH) / 80 番 (HTTP) / 443 番 (HTTPS) / 443 番 UDP (HTTP/3) の開放

Docker 未導入の場合の例:

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"   # 再ログインで反映
```

---

## 4. GitHub Secrets

本番シークレットは **リポジトリに直接書かず**、GitHub Secrets を使用します。
`Settings > Secrets and variables > Actions` で以下を登録してください。

| Secret 名           | 説明                              | 例                                     |
| ------------------- | --------------------------------- | -------------------------------------- |
| `LIGHTSAIL_HOST`    | Lightsail の固定 IP または DNS 名 | `13.230.xx.xx`                         |
| `LIGHTSAIL_USER`    | SSH ユーザー                      | `ubuntu`                               |
| `LIGHTSAIL_SSH_KEY` | SSH 秘密鍵 (PEM 全文)             | `-----BEGIN OPENSSH PRIVATE KEY-----…` |
| `LIGHTSAIL_APP_DIR` | アプリ配置ディレクトリ            | `/app/herta`                           |

> `LIGHTSAIL_SSH_KEY` は Lightsail のインスタンス作成時に発行される鍵、
> もしくは `ssh-keygen` で作成し公開鍵を `~/.ssh/authorized_keys` に登録した鍵の
> **秘密鍵全文** を貼り付けます。

アプリ自身の本番シークレット (Discord トークン等) は GitHub Secrets ではなく、
Lightsail 上の `/app/herta/.env.production` に配置します (下記 5-2)。

---

## 5. 初期セットアップ (Lightsail 上で 1 回)

### 5-1. リポジトリ配置

```bash
# 方法 A: 付属スクリプトを使う
curl -fsSL https://raw.githubusercontent.com/ivRooom/Herta/main/deploy/scripts/setup.sh | bash

# 方法 B: 手動
sudo mkdir -p /app && sudo chown "$USER":"$USER" /app
git clone https://github.com/ivRooom/Herta.git /app/herta
cd /app/herta
```

### 5-2. 本番環境変数の作成

```bash
cd /app/herta
cp .env.production.example .env.production
vi .env.production
```

最低限、以下は必ず設定・変更してください。

- `POSTGRES_PASSWORD` と `DATABASE_URL` のパスワード (両者を一致させる)
- `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` / `DISCORD_BOT_TOKEN`
- `NEXTAUTH_SECRET` (`openssl rand -base64 32`)
- `JWT_SECRET` / `JWT_REFRESH_SECRET` / `INTERNAL_JWT_SECRET`

> `.env.production` は `.gitignore` 済みです。**絶対にコミットしないでください。**

### 5-3. Cloudflare Origin 証明書の配置

Cloudflare ダッシュボードの `SSL/TLS` → `Origin Server` → `Create Certificate`
から Origin 証明書を発行し、以下の名前で保存します。

- `certs/origin.pem` : 証明書 PEM
- `certs/origin-key.pem` : 秘密鍵 PEM

`certs/` は Caddy に読み取り専用でマウントされます。実ファイルは
**絶対にコミットしないでください**。

### 5-4. 初回起動

```bash
cd /app/herta
./deploy/scripts/start.sh
```

`start.sh` は build → `up -d` → health check まで実行します。
`migrator` サービスが起動時に `prisma migrate deploy` を実行し、DB を最新化します。

---

## 6. デプロイ

### 6-1. 自動デプロイ (推奨)

`main` ブランチへ push すると `deploy-production.yml` が起動し、
Lightsail 上で以下を実行します。

```bash
cd /app/herta
git fetch origin
git checkout main
git pull origin main
docker compose -f docker-compose.prod.yml pull || true
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml ps
# up -d で api 等が recreate されると nginx upstream が古い IP を掴んだままになり
# Caddy → nginx → api の経路で 502 になることがあるため、プロキシを再起動する
docker compose -f docker-compose.prod.yml restart nginx caddy
```

その後 API の health check (`/api/v1/health`) が成功すれば完了です
(最大 120 秒待機し、失敗時は api / nginx / caddy のログを出力します)。

### 6-2. 手動デプロイ (workflow_dispatch)

GitHub の `Actions > Deploy Production > Run workflow` から手動実行できます。
`ref` にブランチ / タグを指定するとその内容をデプロイします (既定 `main`)。

### 6-3. サーバー上での手動デプロイ

SSH で入り、スクリプトを直接実行することも可能です。

```bash
cd /app/herta
./deploy/scripts/deploy.sh          # main をデプロイ
./deploy/scripts/deploy.sh <tag>    # 特定タグをデプロイ
```

---

## 7. Health check

```bash
# コンテナ状態 + API 疎通をまとめて確認
./deploy/scripts/health-check.sh

# API (ローカル・コンテナ内ネットワーク)
curl -f http://localhost:3001/api/v1/health

# 外部 (ドメイン経由 / nginx 通過)
curl -f https://herta.ivrm.jp/api/v1/health
```

正常時のレスポンス例:

```json
{ "status": "ok", "service": "herta-api", "timestamp": "2026-07-05T00:00:00.000Z" }
```

各サービスのログ:

```bash
docker compose -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.prod.yml logs -f studio bot worker
```

---

## 8. ロールバック方針

デプロイは Git リビジョン単位で行うため、**直前の正常なコミット / タグへ
切り戻す** ことでロールバックします。

```bash
cd /app/herta
./deploy/scripts/rollback.sh            # 1 つ前のコミット (HEAD~1) へ
./deploy/scripts/rollback.sh <commit>   # 指定コミット / タグへ
```

`rollback.sh` は対象リビジョンを checkout し、再ビルド → `up -d` →
health check を実行します。復帰後に `main` へ戻す場合:

```bash
git checkout main && ./deploy/scripts/deploy.sh
```

### DB マイグレーションに関する注意

`prisma migrate deploy` は **前方向のみ** で、コードを戻しても
スキーマは自動では戻りません。スキーマ変更を伴うリリースを切り戻す場合は:

1. リリース前に必ず DB バックアップを取得しておく
   ```bash
   docker compose -f docker-compose.prod.yml exec -T postgres \
     pg_dump -U postgres herta > backup_$(date +%Y%m%d_%H%M%S).sql
   ```
2. 破壊的変更 (カラム削除等) を含む場合は、バックアップからのリストアを検討する
   ```bash
   cat backup_YYYYMMDD_HHMMSS.sql | \
     docker compose -f docker-compose.prod.yml exec -T postgres psql -U postgres -d herta
   ```

> 破壊的なスキーマ変更は極力避け、後方互換を保つマイグレーションを推奨します。

---

## 9. Cloudflare Full (strict) + Caddy

- `herta.ivrm.jp` の A レコードを Lightsail の固定 IP に向けます。
- Cloudflare の `SSL/TLS` 設定で暗号化モードを `Full (strict)` にします。
- `SSL/TLS` → `Origin Server` で発行した Origin 証明書を
  Lightsail 上の `/app/herta/certs/origin.pem` と
  `/app/herta/certs/origin-key.pem` に配置します。
- Cloudflare の `Network` 設定で `HTTP/3` を有効にします。
- Caddy が TLS 終端を担当し、HTTP→HTTPS リダイレクト / HTTP/2 / HTTP/3 /
  WebSocket を処理します。
- nginx は内部専用で、Caddy から HTTP で受けます。

---

## 10. トラブルシューティング

| 症状                       | 確認 / 対処                                                             |
| -------------------------- | ----------------------------------------------------------------------- |
| health check が失敗する    | `docker compose -f docker-compose.prod.yml logs caddy nginx api` を確認 |
| デプロイ直後に 502 が返る  | nginx/caddy の再起動で回復する可能性あり (下記参照)                     |
| TLS handshake / 526 エラー | Origin 証明書の配置と Cloudflare `Full (strict)` を確認                 |
| DB に接続できない          | `POSTGRES_PASSWORD` と `DATABASE_URL` のパスワード一致を確認            |
| bot がすぐ落ちる           | `DISCORD_BOT_TOKEN` が正しく設定されているか確認                        |
| migrator が失敗する        | `DATABASE_URL` と postgres の起動状態を確認                             |
| ビルドが遅い/失敗する      | ディスク空き容量、`docker system prune` で不要イメージ削除              |
| SSH デプロイが失敗する     | GitHub Secrets の `LIGHTSAIL_*` を確認                                  |

### デプロイ直後の 502 (nginx upstream の張り直し)

`docker compose up -d` で `api` などが recreate されると新しいコンテナ IP が
割り当てられますが、`nginx` / `caddy` は既存コンテナのまま running のため、
nginx が **古い api コンテナ IP を掴んだまま** になり、
Caddy → nginx → api の経路で一時的に 502 が返ることがあります。

デプロイスクリプト / GitHub Actions では `up -d` 後に nginx/caddy を自動再起動して
upstream を張り直しますが、手動で 502 に遭遇した場合は以下で回復します。

```bash
cd /app/herta
docker compose -f docker-compose.prod.yml restart nginx caddy
sleep 5
curl -f https://herta.ivrm.jp/api/v1/health
```

> `bot` / `worker` は本番シークレット (Discord トークン等) と今後の機能実装が
> 揃うことで常駐します。現段階のスキャフォールドでは、トークン未設定時は
> 起動に失敗する点に注意してください。
