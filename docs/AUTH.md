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

| 変数名                      | 説明                                                       |
| --------------------------- | ---------------------------------------------------------- |
| `DISCORD_CLIENT_ID`         | Discord Application のクライアント ID                      |
| `DISCORD_CLIENT_SECRET`     | Discord Application のクライアントシークレット             |
| `DISCORD_BOT_PERMISSIONS`   | Guild Installで要求するBot権限bitfield（既定: `2048`）     |
| `NEXTAUTH_URL`              | Dashboard の公開 URL (Discord Redirect URI のベース)       |
| `NEXTAUTH_SECRET`           | セッション JWT の署名鍵 (`openssl rand -base64 32` で生成) |

## Discord Developer Portal の設定

[Discord Developer Portal](https://discord.com/developers/applications) →
対象アプリで以下を設定します。

### OAuth2ログイン

- **Redirects** に Dashboard のコールバック URL を登録:
  - 開発: `http://localhost:3000/api/auth/callback/discord`
  - 本番: `https://herta.ivrm.jp/api/auth/callback/discord`
- **スコープ**: `identify` `email` `guilds`

> `DISCORD_CALLBACK_URL`（`.env`）は API (NestJS) 側の別フロー用です。
> Dashboard の NextAuth コールバックは `{NEXTAUTH_URL}/api/auth/callback/discord` に固定されます。

### Guild Install

StudioのGuild一覧・Guild詳細から開くインストールURLでは、以下を明示します。

- scope: `bot applications.commands`
- installation context: `integration_type=0`（Guild Install）
- permissions: `DISCORD_BOT_PERMISSIONS`
- Guild詳細から開く場合:
  - `guild_id=<選択Guild ID>`
  - `disable_guild_select=true`

既定の`DISCORD_BOT_PERMISSIONS=2048`はSend Messagesのみです。Pluginが追加権限を必要とする場合は、必要性をレビューした上でbitfieldを更新します。Administratorを既定で要求しません。

Discord Developer Portalの**Installation**設定でも、Guild Installを有効にして`applications.commands`と`bot`を許可してください。User InstallだけではSlash Commandを利用できてもBotユーザーがGuildへ参加しないため、BotのGuild Runtime・Guild Command同期・Gateway Event処理は有効になりません。

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
| `/dashboard/guilds`           | 管理可能な Guild 一覧・汎用Guild Install   | 要   |
| `/dashboard/guilds/[guildId]` | Guild詳細・対象Guild固定のGuild Install     | 要   |

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

## DB 保存と同期責務

- `users`: ログイン時にupsert (`apps/studio/src/lib/users.ts`)
- `guilds`: Guild選択時に、OAuth APIから確実に取得できる`id`、`name`、`icon`だけをupsert
- `guilds.owner_id`: ログインユーザー本人がGuild ownerの場合のみ保存し、それ以外は`NULL`
- `guild_members`: StudioのOAuthフローからは作成・更新しない

Discordの`/users/@me/guilds`では、ログインユーザーがownerでない場合の実owner ID、
ログインユーザー自身のrole ID、nickname、joinedAtを取得できません。不明な値を空文字や
空配列として保存すると、将来のRBAC・監査で正しい同期値と区別できなくなるためです。

Guild member metadataの同期は、BotがGuild member情報を正規に取得できるようになった時点で、
必要なIntent・保存範囲・保持期間をレビューした上で別の同期処理として実装します。
Dashboardの管理権限判定はDB上のGuildMemberではなく、操作ごとにDiscord APIで再確認します。

`owner_id=''`の既存データはmigrationで`NULL`へ変換します。

## セキュリティ

- Discord のアクセストークンは **JWT (サーバー専用)** にのみ保持し、
  クライアントへ渡すセッションオブジェクトには含めません
  (`apps/studio/src/lib/session.ts` 経由でサーバー側からのみ取得)。
- Guild 詳細ページ / API は毎回 Discord の権限を再検証し、
  権限の無い Guild へのアクセスを拒否します (404 / 403)。
- Guild Install URLはサーバー側で生成し、`client_id`、`guild_id`、`permissions`を数字だけに制限します。
- `DISCORD_CLIENT_SECRET` / `NEXTAUTH_SECRET` は環境変数からのみ読み込み、
  コードにハードコードしません。
