# 認証 (Discord OAuth) と Guild 選択

Herta Studio (管理ダッシュボード) は **Discord OAuth2** でログインし、
ログインユーザーが**管理権限を持つ Guild のみ**を表示・選択できます。

- 実装: [NextAuth (Auth.js) v5](https://authjs.dev/) + Discord Provider
- 対象アプリ: `apps/studio` (Next.js App Router, ポート 3000)
- セッション方式: JWT (Cookie ベース、DB セッションは未使用)

## 全体フロー

```
[/login] --(Discord でログイン)--> Discord OAuth2 認可画面
   --> {NEXTAUTH_URL}/api/auth/callback/discord (NextAuth コールバック)
   --> JWT セッション発行 + users テーブルへ upsert
   --> /dashboard へリダイレクト
```

1. `/login` で「Discord でログイン」を押すと Discord の認可画面に遷移します。
2. スコープ `identify email guilds` を要求します。
3. コールバック後、NextAuth が JWT セッションを発行し、Cookie に保存します。
4. `jwt` コールバックで Discord のアクセストークン / リフレッシュトークンを
   JWT 内に保持し、`users` テーブルへユーザーを upsert します。
5. アクセストークンが失効した場合はリフレッシュトークンで自動更新します。

## 必要な環境変数

| 変数名                  | 説明                                                       |
| ----------------------- | ---------------------------------------------------------- |
| `DISCORD_CLIENT_ID`     | Discord Application のクライアント ID                      |
| `DISCORD_CLIENT_SECRET` | Discord Application のクライアントシークレット             |
| `NEXTAUTH_URL`          | Dashboard の公開 URL (Discord Redirect URI のベース)       |
| `NEXTAUTH_SECRET`       | セッション JWT の署名鍵 (`openssl rand -base64 32` で生成) |

## Discord Developer Portal の設定

[Discord Developer Portal](https://discord.com/developers/applications) →
対象アプリ → **OAuth2** で以下を設定します。

- **Redirects** に Dashboard のコールバック URL を登録:
  - 開発: `http://localhost:3000/api/auth/callback/discord`
  - 本番: `https://herta.ivrm.jp/api/auth/callback/discord`
- **スコープ**: `identify` `email` `guilds`

> `DISCORD_CALLBACK_URL`（`.env`）は API (NestJS) 側の別フロー用です。
> Dashboard の NextAuth コールバックは `{NEXTAUTH_URL}/api/auth/callback/discord` に固定されます。

## Guild の権限判定

`GET https://discord.com/api/v10/users/@me/guilds` で取得した Guild 一覧から、
以下のいずれかを満たす Guild だけを「管理可能」として表示します。

- サーバーのオーナー (`owner === true`)
- `ADMINISTRATOR` 権限 (ビット `1 << 3`)
- `MANAGE_GUILD` 権限 (ビット `1 << 5`)

判定ロジックは `apps/studio/src/lib/discord.ts` の `canManageGuild()` にあります。

## ページ構成

| パス                          | 説明                                       | 保護 |
| ----------------------------- | ------------------------------------------ | ---- |
| `/login`                      | Discord ログイン導線                       | -    |
| `/dashboard`                  | ログイン後のホーム                         | 要   |
| `/dashboard/guilds`           | 管理可能な Guild 一覧                      | 要   |
| `/dashboard/guilds/[guildId]` | 選択した Guild の詳細 (権限が無い場合 404) | 要   |

`/dashboard` 配下は `apps/studio/src/middleware.ts` により保護され、
未ログイン時は `/login` へリダイレクトされます。

## API (Route Handlers)

Studio 内の Route Handler として以下を提供します。

| メソッド / パス             | 説明                            |
| --------------------------- | ------------------------------- |
| `GET /api/me`               | 現在のログインユーザー          |
| `GET /api/guilds`           | 管理可能な Guild 一覧           |
| `GET /api/guilds/[guildId]` | 選択 Guild (権限が無い場合 403) |

いずれも未認証は `401` を返します。

## DB 保存

- `users`: ログイン時に upsert (`apps/studio/src/lib/users.ts`)
- `guilds` / `guild_members`: Guild を選択 (`/dashboard/guilds/[guildId]` 表示、
  または `GET /api/guilds/[guildId]`) した際に upsert
  (`apps/studio/src/lib/guilds.ts` の `persistSelectedGuild()`)

既存の Prisma スキーマ (`users` / `guilds` / `guild_members`) をそのまま利用するため、
新規マイグレーションは不要です。

## セキュリティ

- Discord のアクセストークンは **JWT (サーバー専用)** にのみ保持し、
  クライアントへ渡すセッションオブジェクトには含めません
  (`apps/studio/src/lib/session.ts` 経由でサーバー側からのみ取得)。
- Guild 詳細ページ / API は毎回 Discord の権限を再検証し、
  権限の無い Guild へのアクセスを拒否します (404 / 403)。
- `DISCORD_CLIENT_SECRET` / `NEXTAUTH_SECRET` は環境変数からのみ読み込み、
  コードにハードコードしません。
