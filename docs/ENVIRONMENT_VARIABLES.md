# 環境変数リファレンス

Herta で使用する環境変数の一覧です。開発は `.env` (`.env.example` をコピー)、
本番は `/app/herta/.env.production` (`.env.production.example` をコピー) を使用します。

> シークレットは絶対にリポジトリへコミットしないでください。
> `.env` / `.env.production` は `.gitignore` 済みです。

## 共通

| 変数名     | 必須 | 説明     | 開発デフォルト |
| ---------- | ---- | -------- | -------------- |
| `NODE_ENV` | -    | 実行環境 | `development`  |

## データストア

| 変数名         | 必須 | 説明                | 開発デフォルト                                        |
| -------------- | ---- | ------------------- | ----------------------------------------------------- |
| `DATABASE_URL` | Yes  | PostgreSQL 接続 URL | `postgresql://postgres:postgres@localhost:5432/herta` |
| `REDIS_URL`    | Yes  | Redis 接続 URL      | `redis://localhost:6379`                              |

本番の compose 用に `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` も使用します。
`POSTGRES_PASSWORD` と `DATABASE_URL` のパスワードは必ず一致させてください。

## Discord

| 変数名                                  | 必須 | 説明                                          | 用途                     |
| --------------------------------------- | ---- | --------------------------------------------- | ------------------------ |
| `DISCORD_CLIENT_ID`                     | Yes  | Application のクライアント ID                 | Dashboard ログイン / API |
| `DISCORD_CLIENT_SECRET`                 | Yes  | Application のクライアントシークレット        | Dashboard ログイン / API |
| `DISCORD_BOT_TOKEN`                     | Yes  | Bot トークン                                  | Bot                      |
| `DISCORD_ENABLE_MESSAGE_CONTENT_INTENT` | -    | Auto Response用Message Content Intentを有効化 | Bot（既定: `false`）     |
| `DISCORD_BOT_PERMISSIONS`               | -    | Guild Installで要求するBot権限bitfield        | Studio                   |
| `DISCORD_PUBLIC_KEY`                    | -    | Interactions 用公開鍵                         | Bot                      |
| `DISCORD_GUILD_ID_DEV`                  | -    | 開発用 Guild ID (Slash Command の即時登録)    | Bot                      |
| `DISCORD_CALLBACK_URL`                  | -    | **API 側 (NestJS)** の OAuth コールバック URL | API                      |

> **Dashboard ログインのコールバック URL は環境変数ではありません。**
> NextAuth が `{NEXTAUTH_URL}/api/auth/callback/discord` を自動的に使用します。
> Discord Developer Portal の Redirects にこの URL を登録してください。
> OAuth2 スコープは `identify` `email` `guilds` が必要です。詳細は [AUTH.md](./AUTH.md)。
>
> Auto Responseを利用する場合はDiscord Developer PortalでMessage Content Intentを有効化した後、
> `DISCORD_ENABLE_MESSAGE_CONTENT_INTENT=true`へ変更してください。通常運用では`false`のままです。
>
> `DISCORD_BOT_PERMISSIONS`の既定値は`274877926400`です。View Channel、Send Messages、
> Embed Links、Send Messages in Threadsを含みます。既存導入Guildで権限が不足する場合は
> Studioから再認可してください。

## API (NestJS)

| 変数名         | 必須 | 説明                             | 開発デフォルト          |
| -------------- | ---- | -------------------------------- | ----------------------- |
| `API_PORT`     | -    | API サーバーポート               | `3001`                  |
| `API_URL`      | -    | API の公開 URL                   | `http://localhost:3001` |
| `CORS_ORIGINS` | -    | CORS 許可オリジン (カンマ区切り) | `http://localhost:3000` |

## Studio (Next.js Dashboard)

| 変数名            | 必須 | 説明                                                       | 開発デフォルト          |
| ----------------- | ---- | ---------------------------------------------------------- | ----------------------- |
| `STUDIO_PORT`     | -    | Studio ポート                                              | `3000`                  |
| `NEXTAUTH_URL`    | Yes  | Dashboard の公開 URL (Discord Redirect URI のベース)       | `http://localhost:3000` |
| `NEXTAUTH_SECRET` | Yes  | セッション JWT の署名鍵 (`openssl rand -base64 32` で生成) | -                       |

### Command Palette Semantic Search

Semantic Searchは明示的なopt-inです。既定の`disabled`では外部providerを呼び出さず、
Command Paletteは既存のlexical / intent rankingだけで動作します。

| 変数名                            | 必須                        | 説明                                      | 既定値                   |
| --------------------------------- | --------------------------- | ----------------------------------------- | ------------------------ |
| `STUDIO_SEMANTIC_SEARCH_PROVIDER` | -                           | `disabled` または `openai`                | `disabled`               |
| `HERTA_RUNTIME_SECRET_KEY`        | provider=`openai` の場合Yes | Runtime Secret Store master key           | -                        |
| `OPENAI_API_KEY`                  | migration fallbackのみ      | Console未登録時のOpenAI API key           | -                        |
| `OPENAI_EMBEDDING_MODEL`          | -                           | Semantic rankingに利用するembedding model | `text-embedding-3-small` |

OpenAI credentialはStudio Settingsの `AI Provider Credentials` から登録する
console-managed secretを優先します。`HERTA_RUNTIME_SECRET_KEY`はOpenAI API keyそのものではなく、
Runtime Secret StoreのAES-256-GCM暗号化・復号に使うbootstrap master keyです。32-byte base64または
64桁hexを設定します。

`STUDIO_SEMANTIC_SEARCH_PROVIDER=openai`の場合、保存済みcredentialがまだ無い場合でもRuntime Secret
Storeを安全に確認するため、`HERTA_RUNTIME_SECRET_KEY`を必ず設定してください。

本番では`HERTA_RUNTIME_SECRET_KEY`を`.env.production`へ手入力せず、`Deploy Production` workflowが
SSM SecureString `/ivrm/runtime/herta/runtime-secret-key`から取得して注入します。`studio`起動時に
値が未設定だと、`AI Provider Credential Settings`からのOpenAI API key保存は
`Secret暗号化設定がまだ準備されていません` (HTTP 503) になります。手順は
[RUNTIME_SECRETS.md](./RUNTIME_SECRETS.md)を参照してください。

`OPENAI_API_KEY`は移行期間だけのfallbackです。Runtime Secret Storeのreadが正常に完了し、master keyが
有効で、`openai.api_key`が未登録の場合にだけ利用されます。DB unavailable、master key未設定・不正、
decrypt failure、その他secret-store read failureでは **fail closed** し、`OPENAI_API_KEY`へ切り替えません。
その場合Semantic Searchはlexical searchへfallbackします。

`HERTA_RUNTIME_SECRET_KEY`と`OPENAI_API_KEY`は`NEXT_PUBLIC_`変数へ移さず、ブラウザへ公開しないでください。
master keyの生成・保管・rollout手順とcredential運用の詳細は [RUNTIME_SECRETS.md](./RUNTIME_SECRETS.md)
を参照してください。

Providerへ送信するCommand corpusはlabel / keywords / intents / group / sanitized routeに限定し、
Discord本文、Moderation本文、Guild名・実Guild ID、Secret、ユーザー生成コンテンツは含めません。
Provider失敗・timeout時はlexical searchへfallbackします。

## JWT / 内部通信

| 変数名                   | 必須 | 説明                         | 備考             |
| ------------------------ | ---- | ---------------------------- | ---------------- |
| `JWT_SECRET`             | -    | JWT 署名キー                 | 本番では必ず変更 |
| `JWT_REFRESH_SECRET`     | -    | JWT リフレッシュ用署名キー   | 本番では必ず変更 |
| `JWT_EXPIRATION`         | -    | アクセストークン有効期間     | `15m`            |
| `JWT_REFRESH_EXPIRATION` | -    | リフレッシュトークン有効期間 | `7d`             |
| `INTERNAL_JWT_SECRET`    | -    | Bot ↔ API 内部通信用署名キー | 本番では必ず変更 |

## ロギング

| 変数名             | 必須 | 説明              | 開発デフォルト |
| ------------------ | ---- | ----------------- | -------------- |
| `BOT_LOG_LEVEL`    | -    | Bot ログレベル    | `debug`        |
| `WORKER_LOG_LEVEL` | -    | Worker ログレベル | `debug`        |

## 本番で変更が必須の値

`.env.production.example` のうち、以下は必ず安全な値へ変更してください。

- `POSTGRES_PASSWORD` / `DATABASE_URL` のパスワード
- `NEXTAUTH_SECRET`
- `JWT_SECRET` / `JWT_REFRESH_SECRET` / `INTERNAL_JWT_SECRET`
- `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` / `DISCORD_BOT_TOKEN`
- `STUDIO_SEMANTIC_SEARCH_PROVIDER=openai`を有効化する場合は`HERTA_RUNTIME_SECRET_KEY`
