# Herta. セキュリティ運用

## 基本方針

- Secret、Token、秘密鍵をGitへコミットしない
- 本番APIは必要最小限の経路・権限だけを公開する
- Discord Guildの管理権限は操作ごとにDiscord APIで再確認する
- Plugin設定やDB値をJavaScript / TypeScriptとして評価しない
- 1つのPlugin障害をBot全体へ波及させない

## Secretローテーション

Secretがチャット、ログ、Issue、画面共有などへ露出した可能性がある場合は、削除だけでなく必ず再発行する。

優先してローテーションするもの:

1. Cloudflare Origin Certificateと秘密鍵
2. Discord Bot Token
3. Discord OAuth Client Secret
4. `NEXTAUTH_SECRET` / `AUTH_SECRET`
5. PostgreSQLパスワードと`DATABASE_URL`
6. `JWT_SECRET` / `JWT_REFRESH_SECRET` / `INTERNAL_JWT_SECRET`
7. Lightsail SSH鍵

ローテーション後は、旧Credentialが無効であることと、Botログイン・OAuth・DB接続・Health checkが成功することを確認する。

## CloudflareとOrigin保護

`Full (strict)`とCloudflare Origin Certificateは、CloudflareからOriginまでのTLSを検証するための構成であり、Originへの直接アクセスを自動的に禁止するものではない。

本番では次のいずれか、または両方を実施する。

- Cloudflare Authenticated Origin Pullsを有効化し、CaddyでCloudflareのクライアント証明書を検証する
- Lightsail / OS FirewallでCloudflareの公開IPレンジだけを80/443へ許可する

Origin制限が完了するまでは、`CF-Connecting-IP`やそれを転送した`X-Real-IP`を認証・認可・厳密なレート制限の根拠にしない。Originへ直接到達できる攻撃者がヘッダーを偽装できるためである。

Cloudflare側では以下も確認する。

- SSL/TLS mode: `Full (strict)`
- Always Use HTTPS
- Minimum TLS Version
- Managed WAF Rules
- Bot / Rate Limiting Rules
- DNSレコードがProxy有効になっていること
- Origin IPが不要な場所へ公開されていないこと

## API

- 本番CORSは`CORS_ORIGINS`へ明示したOriginだけを許可する
- Credentials付きCORSで`*`を使用しない
- Swaggerは本番でデフォルト無効。調査時だけ`ENABLE_SWAGGER=true`にし、終了後に戻す
- 入力値はDTO / Zod / JSON Schema等で検証する
- 内部例外・Stack Trace・Tokenを利用者向けレスポンスへ含めない
- Graceful shutdown時にDB・Redis・Queueを安全に閉じる

## Studio / Discord OAuth

- Discord access tokenとrefresh tokenはクライアントSessionへ含めない
- Guild管理APIはログイン確認だけでなく、対象GuildのAdministrator / Manage Guild権限を毎回再確認する
- 権限確認レスポンスを共有Cacheへ保存しない
- OAuth Redirect URIは開発・本番で明示的に登録する
- 本番CookieはSecure / HttpOnly / SameSite設定を維持する

## Discord Bot

- 現在のSlash Command Runtimeでは`Guilds` Intentだけを要求する
- Guild Members、Message Content等のPrivileged Intentは、必要なPluginを実装し、用途・保持データ・権限をレビューした後に限定して追加する
- Plugin CommandはGuild単位の有効化状態を確認する
- Plugin無効化時はCommand同期とRuntime lifecycleを更新する
- Bot Tokenをログへ出さない

## Docker / Lightsail

実装済み:

- builder / runtimeのmulti-stage構成
- API、Studio、Bot、Workerをbuild時にcompile
- Bot / Workerは本番で`tsx`を使わずcompiled JavaScriptを実行
- アプリコンテナはnode公式imageの非rootユーザーで実行
- `no-new-privileges`と`cap_drop: ALL`をアプリコンテナへ適用
- `/tmp`だけをtmpfsとして提供
- API / Studio / Bot / Worker / Migratorへ必要な環境変数だけを注入
- Compose実行時に`.env.production`を明示し、必須値不足をbuild前に検出
- PostgreSQL / Redisはホストへポート公開しない

運用上の注意:

- `.env.production`はLightsail上だけに置き、権限を管理ユーザーのみに制限する
- Composeを手動実行する場合も`--env-file .env.production`を必ず付ける
- アプリが永続書込みを必要とする場合、root化せず専用volumeと所有権を追加する
- Caddy / nginx / PostgreSQL / Redisの権限削減は各公式imageの要件を確認して別途行う

残課題:

- Runtime imageから開発依存と不要なsourceを除外する
- read-only root filesystemの適用可否をサービスごとに検証する
- base imageのdigest pinning、SBOM生成、image vulnerability scan
- 定期バックアップと復元訓練

## CI / Supply chain

CIで以下を必須とする。

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
docker compose --env-file .env.production.example -f docker-compose.prod.yml config --quiet
docker build --tag herta-app:ci .
```

CIはさらに、Runtime UIDが0ではないことと、API / Bot / Workerのbuild成果物がimage内に存在することを確認する。

DependabotでnpmとGitHub Actionsを定期更新し、PRごとに変更内容・Breaking Change・Security Advisoryを確認する。メジャー更新は他のメジャー更新と混在させず、個別に移行・検証する。

GitHub Actionsの`permissions`はジョブに必要な最小権限だけを明示する。

## インシデント時の初動

1. 影響範囲を特定する
2. 露出したSecretを失効・再発行する
3. 不審なログイン、OAuth、DB操作、Discord操作を確認する
4. 必要に応じてBot / APIを一時停止する
5. Audit LogとCloudflare / Caddy / nginx / Appログを保全する
6. 原因を修正して再デプロイする
7. Health checkと主要操作を再確認する
8. 再発防止Issueを作成する
