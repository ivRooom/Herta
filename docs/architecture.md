# Herta. — システムアーキテクチャ設計書

> Version: 0.1.0 (Initial Architecture)
> 最終更新: 2026-06-30

---

## 1. プロダクト概要

**Herta.** は Discord Community Operating System として設計される拡張可能なプラットフォームである。

MEE6 のような「機能の集合体」ではなく、「拡張できる基盤」を最重要方針とし、Quote 機能ですら Plugin として動作する設計とする。

### 1.1 ビジョン

```
"できないことはほぼ無い" Discord プラットフォーム
```

将来的に統合するドメイン:

| Phase | ドメイン |
|---|---|
| MVP | Discord Bot, Dashboard, Plugin Platform, Rule Engine |
| v1.0 | Analytics, Config Management |
| v1.5 | Plugin Store, Game Integration |
| v2.0 | Minecraft Server Management, Web Server Management |
| v3.0 | AI Assistant, Identity Platform |

### 1.2 設計原則

1. **Plugin First** — 全機能を Plugin として実装する。Core は Plugin を動かす基盤のみ
2. **Guild Isolation** — Guild 単位で完全にデータを分離する (マルチテナント)
3. **Schema Versioning** — Rule JSON, Plugin Config, API はすべてバージョン管理する
4. **Extensibility Over Features** — 機能追加より拡張性を優先する
5. **Minimal Core** — Core に含めるものを最小限にする

---

## 2. システム構成図

```
                      ┌─────────────────────────────────┐
                      │       Cloudflare DNS / CDN       │
                      │         *.herta.app              │
                      └──────┬──────┬──────┬─────────────┘
                             │      │      │
              ┌──────────────┤      │      ├──────────────┐
              ▼              ▼      │      ▼              ▼
     ┌────────────┐  ┌────────────┐ │ ┌────────────┐  ┌────────────┐
     │ Landing    │  │ Herta      │ │ │ Member     │  │ API        │
     │ Page       │  │ Studio     │ │ │ Portal     │  │ Gateway    │
     │ (静的)     │  │ (Next.js)  │ │ │ (Next.js)  │  │ (NestJS)   │
     └────────────┘  └─────┬──────┘ │ └─────┬──────┘  └─────┬──────┘
                           │        │       │               │
                           └────────┼───────┘               │
                                    │                       │
                      ┌─────────────▼───────────────────────▼──┐
                      │            herta-api (NestJS)           │
                      │            AWS Lightsail                │
                      │                                        │
                      │  ┌──────────┐ ┌───────────┐ ┌────────┐│
                      │  │ Core     │ │ Plugin    │ │ Rule   ││
                      │  │ Module   │ │ Registry  │ │ Engine ││
                      │  └──────────┘ └───────────┘ └────────┘│
                      └──────┬──────────┬──────────┬───────────┘
                             │          │          │
              ┌──────────────┤          │          ├───────────┐
              ▼              ▼          ▼          ▼           ▼
     ┌────────────┐  ┌────────────┐  ┌──────┐  ┌────────┐  ┌────────┐
     │ PostgreSQL │  │   Redis    │  │ Bot  │  │ Worker │  │ (将来) │
     │ 16         │  │   7       │  │      │  │        │  │ MC/OCI │
     └────────────┘  └────────────┘  └──────┘  └────────┘  └────────┘
```

---

## 3. コンポーネント責務

| コンポーネント | ホスト | 責務 |
|---|---|---|
| **herta-api** | AWS Lightsail | REST API。認証、RBAC、Plugin Registry、Rule Engine、Audit Log |
| **herta-bot** | AWS Lightsail | Discord Gateway 接続。イベント受信 → Rule Engine 評価 → Action 実行 |
| **herta-worker** | AWS Lightsail | 非同期ジョブ (スケジュール実行、クリーンアップ、Analytics 集計) |
| **herta-studio** | AWS Lightsail | 管理者ダッシュボード (Guild 設定、Plugin 管理、Rule 編集、Audit 閲覧) |
| **PostgreSQL** | AWS Lightsail | 永続データストア |
| **Redis** | AWS Lightsail | キャッシュ、セッション、Rate Limit、BullMQ Queue |

---

## 4. 通信プロトコル

```
Studio ──── HTTPS/REST ──→ herta-api
Studio ──── WSS ──────────→ herta-api (リアルタイム通知、将来)
Bot ─────── Discord GW ───→ Discord
Bot ─────── HTTP ─────────→ herta-api (署名付き JWT、設定取得)
Worker ──── BullMQ ────────→ Redis Queue
API ─────── Prisma ────────→ PostgreSQL
API ─────── ioredis ───────→ Redis
```

### 4.1 サービス間認証

| 経路 | 認証方式 |
|---|---|
| Studio → API | Discord OAuth2 → JWT (access + refresh) |
| Bot → API | 署名付き JWT (サービス間トークン) |
| Worker → API | 署名付き JWT (サービス間トークン) |
| API → DB | PostgreSQL 接続文字列 (SSL 必須) |
| API → Redis | Redis パスワード認証 |

> **設計判断:** Internal API Key の単一キーではなく、署名付き JWT を採用する。鍵のローテーションが可能で、サービスごとに異なる権限を付与できる。

---

## 5. マルチテナント設計

Guild 単位で完全分離。全テーブルに `guild_id` カラムを持ち、API レイヤーで Guild スコープを強制する。

```typescript
// 全 Service に適用される Guild スコープ Guard
@Injectable()
export class GuildScopeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const guildId = request.params.guildId;
    const userGuilds = request.user.guilds;
    return userGuilds.some((g) => g.id === guildId && g.hasAccess);
  }
}
```

---

## 6. Monorepo 構成

### 6.1 ツールチェイン

| ツール | 用途 |
|---|---|
| **Turborepo** | モノレポビルドオーケストレーション |
| **pnpm** | パッケージマネージャー (ワークスペース対応) |
| **TypeScript** | 全パッケージ共通の型安全性 |
| **ESLint + Prettier** | コード品質 |
| **Vitest** | ユニット / インテグレーションテスト |
| **Prisma** | ORM / マイグレーション |
| **Docker Compose** | ローカル開発 + 本番デプロイ |

### 6.2 ワークスペース構成

```
herta/
├── apps/
│   ├── api/           # NestJS — herta-api
│   ├── bot/           # discord.js — herta-bot
│   ├── worker/        # BullMQ — herta-worker
│   └── studio/        # Next.js — Herta Studio (管理 Dashboard)
│
├── packages/
│   ├── db/            # Prisma schema + migrations + client
│   ├── plugin-sdk/    # Plugin SDK (BasePlugin, PluginContext, EventBus)
│   ├── rule-engine/   # Trigger/Condition/Action 評価エンジン
│   ├── shared/        # 共通型定義、定数、ユーティリティ
│   ├── logger/        # 構造化ログ (pino ラッパー)
│   ├── queue/         # BullMQ ジョブ定義の共通化
│   ├── ui/            # shadcn/ui ベースの共通 UI コンポーネント
│   └── config/        # ESLint, TypeScript, Tailwind 共通設定
│
├── plugins/           # Plugin 実装
│   ├── auto-response/
│   ├── moderation/
│   ├── quote/
│   ├── lfg/
│   ├── team-split/
│   └── daily-content/
│
├── deploy/            # デプロイスクリプト + nginx 設定
├── docs/              # 設計書・運用ドキュメント
└── .github/           # CI/CD ワークフロー
```

### 6.3 パッケージ境界の原則

- `packages/*` は純粋な npm パッケージとしてビルド可能にする (`tsc` で `.d.ts` 生成、`exports` フィールド設定)
- `plugins/*` は将来的に外部リポジトリからインストール可能な構造にする
- `apps/*` は独立して Docker イメージをビルド可能にする

---

## 7. ディレクトリ構成

### 7.1 apps/api/ (NestJS)

```
apps/api/src/
├── main.ts
├── app.module.ts
├── core/                    # Core モジュール群
│   ├── auth/                # Discord OAuth + JWT
│   │   ├── auth.module.ts
│   │   ├── auth.controller.ts
│   │   ├── auth.service.ts
│   │   ├── strategies/      # discord.strategy.ts, jwt.strategy.ts
│   │   ├── guards/          # jwt-auth.guard.ts, rbac.guard.ts
│   │   └── decorators/      # current-user.decorator.ts, requires-permission.decorator.ts
│   ├── guild/               # Guild CRUD
│   ├── user/                # User 管理
│   ├── rbac/                # ロール・権限管理
│   └── audit/               # 監査ログ
├── plugin/                  # Plugin Registry, Config, Lifecycle
├── rule-engine/             # Rule CRUD + 評価ブリッジ
├── health/                  # ヘルスチェック
└── common/                  # Prisma, Redis, Filters, Pipes
```

### 7.2 apps/bot/ (discord.js)

```
apps/bot/src/
├── main.ts
├── bot.ts                   # Client 初期化
├── commands/                # Slash Command ハンドラ
│   ├── command-handler.ts
│   └── commands.ts          # コマンド定義の一元管理
├── events/                  # Discord Event ハンドラ
│   └── event-handler.ts
├── plugin-loader/           # Plugin ロード + Context 生成
│   └── loader.ts
├── rule-bridge/             # Bot ↔ Rule Engine ブリッジ
└── scripts/                 # deploy-commands.ts
```

### 7.3 apps/studio/ (Next.js)

```
apps/studio/src/
├── app/
│   ├── (auth)/              # ログイン, コールバック
│   └── (dashboard)/
│       ├── layout.tsx
│       ├── select-guild/    # Guild 選択
│       └── [guildId]/
│           ├── page.tsx     # Overview
│           ├── plugins/     # Plugin 管理
│           ├── rules/       # Rule Builder
│           ├── audit-log/   # 監査ログ
│           ├── roles/       # RBAC ロール管理
│           └── settings/    # Guild 設定
├── components/
│   ├── layout/              # sidebar, header, guild-switcher
│   ├── plugins/             # plugin-card, plugin-config-form
│   ├── rules/               # rule-builder, trigger-select, condition-editor, action-editor
│   └── audit/               # audit-table, audit-detail
├── lib/                     # api-client, auth, utils
└── hooks/                   # use-guild, use-plugins
```

---

## 8. API 設計

### 8.1 URL 構造

API は最初からバージョニングを導入する: `/api/v1/...`

```
# 認証
POST   /api/v1/auth/discord
GET    /api/v1/auth/discord/callback
POST   /api/v1/auth/refresh
POST   /api/v1/auth/logout
GET    /api/v1/auth/me

# Guild
GET    /api/v1/guilds
GET    /api/v1/guilds/:guildId
PATCH  /api/v1/guilds/:guildId/settings
GET    /api/v1/guilds/:guildId/members

# RBAC
GET    /api/v1/guilds/:guildId/roles
POST   /api/v1/guilds/:guildId/roles
PATCH  /api/v1/guilds/:guildId/roles/:roleId
DELETE /api/v1/guilds/:guildId/roles/:roleId

# Audit Log
GET    /api/v1/guilds/:guildId/audit-logs

# Plugin
GET    /api/v1/plugins
GET    /api/v1/guilds/:guildId/plugins
POST   /api/v1/guilds/:guildId/plugins/:pluginId/install
DELETE /api/v1/guilds/:guildId/plugins/:pluginId/uninstall
PATCH  /api/v1/guilds/:guildId/plugins/:pluginId/config
GET    /api/v1/guilds/:guildId/plugins/:pluginId/config/history
POST   /api/v1/guilds/:guildId/plugins/:pluginId/config/rollback

# Rule Engine
GET    /api/v1/guilds/:guildId/rules
POST   /api/v1/guilds/:guildId/rules
GET    /api/v1/guilds/:guildId/rules/:ruleId
PATCH  /api/v1/guilds/:guildId/rules/:ruleId
DELETE /api/v1/guilds/:guildId/rules/:ruleId
POST   /api/v1/guilds/:guildId/rules/:ruleId/test
GET    /api/v1/guilds/:guildId/rules/:ruleId/logs

# Plugin 固有 API (例: Auto Response)
GET    /api/v1/guilds/:guildId/auto-responses
POST   /api/v1/guilds/:guildId/auto-responses
PATCH  /api/v1/guilds/:guildId/auto-responses/:id
DELETE /api/v1/guilds/:guildId/auto-responses/:id
```

### 8.2 レスポンス形式

```typescript
// 成功
{
  "data": T,
  "meta": {
    "page": 1,
    "perPage": 20,
    "total": 100,
    "totalPages": 5
  }
}

// エラー
{
  "error": {
    "code": "FORBIDDEN",
    "message": "このリソースへのアクセス権限がありません",
    "details": {}
  }
}
```

---

## 9. 認証・認可

| レイヤー | 実装 |
|---|---|
| **認証** | Discord OAuth2 → JWT (access + refresh) |
| **セッション** | Redis-backed, HttpOnly Cookie + Bearer Token |
| **RBAC** | 独自ロールシステム (Guild スコープ) |
| **API 認可** | NestJS Guard + Custom Decorator |
| **サービス間認証** | 署名付き JWT (Bot ↔ API, Worker ↔ API) |

### 9.1 認証プロバイダーの抽象化

将来的に Minecraft (Microsoft OAuth)、Web ログインを追加するため、認証プロバイダーを抽象化する:

```typescript
interface AuthProvider {
  readonly providerId: string;  // 'discord' | 'microsoft' | 'web'
  authorize(params: AuthorizeParams): Promise<AuthorizeResult>;
  callback(params: CallbackParams): Promise<UserProfile>;
  refresh(refreshToken: string): Promise<TokenPair>;
}
```

> MVP では Discord のみ実装。インタフェースだけ定義しておく。

---

## 10. セキュリティ設計

### 10.1 データ保護

| 対策 | 実装 |
|---|---|
| 通信暗号化 | 全通信 HTTPS (Cloudflare SSL) |
| DB 接続 | SSL 必須 |
| 環境変数 | dotenv + 本番は Secrets Manager |
| SQL Injection | Prisma (パラメータ化クエリ) |
| XSS | React の自動エスケープ + CSP ヘッダー |
| CSRF | SameSite Cookie + Origin チェック |

### 10.2 Rate Limiting

```typescript
// Global: 100 req / 60s
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 100, ttl: 60000 } })

// Per-endpoint: 10 req / 60s
@Throttle({ default: { limit: 10, ttl: 60000 } })
@Post('auto-responses')
```

Guild 単位、User 単位、Plugin 単位の Rate Limit を追加する。

### 10.3 Input Validation

```typescript
// Zod schema を NestJS Pipe で統一
@UsePipes(new ZodValidationPipe(CreateRuleSchema))
@Post('rules')
async createRule(@Body() dto: CreateRuleDto) {}
```

### 10.4 Audit Trail

- 全設定変更を `audit_logs` に記録
- actor, target, changes (diff), IP アドレス, severity
- 90 日保持 (設定可能)
- Append-only 設計 (DELETE/UPDATE を DB レベルで制限)

---

## 11. インフラ構成

### 11.1 MVP 構成 (単一インスタンス)

```
┌──────────────────────────────────────────────┐
│  AWS Lightsail                               │
│                                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐     │
│  │ API      │ │ Bot      │ │ Worker   │     │
│  └──────────┘ └──────────┘ └──────────┘     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐     │
│  │ Studio   │ │ PG 16    │ │ Redis 7  │     │
│  └──────────┘ └──────────┘ └──────────┘     │
│  ┌──────────┐                                │
│  │ nginx    │ (リバースプロキシ + SSL)       │
│  └──────────┘                                │
└──────────────────────────────────────────────┘
```

### 11.2 スケーリング戦略

```
Phase 1 (MVP):       単一インスタンス (Docker Compose)
Phase 2 (100 Guild):  Bot シャーディング開始
Phase 3 (1000 Guild): API 水平スケール (ロードバランサー)
Phase 4 (10000+):     Kubernetes 移行検討
```

### 11.3 監視

| 対象 | ツール |
|---|---|
| アプリログ | Pino → CloudWatch / Loki |
| メトリクス | Prometheus + Grafana |
| アラート | Grafana Alerting → Discord Webhook |
| ヘルスチェック | `/api/v1/health` + UptimeRobot |
| エラー追跡 | Sentry |

### 11.4 バックアップ

- PostgreSQL: 日次 pg_dump → S3 (30 日保持)
- Redis: RDB スナップショット (1 時間ごと)
- Config: `guild_plugin_config_history` テーブルで自動バージョニング

---

## 12. 将来拡張戦略

### 12.1 アーキテクチャ進化パス

```
MVP (単一インスタンス)
  ↓
v1.0 (Bot シャーディング)
  ↓
v1.5 (API 水平スケール + ロードバランサー)
  ↓
v2.0 (マイクロサービス化検討)
  ↓
v3.0 (Kubernetes 移行検討)
```

### 12.2 Identity Platform (将来構想)

```
┌──────────────┐
│  Herta ID    │
│              │
│  ┌────────┐  │
│  │Discord │  │ ← MVP
│  ├────────┤  │
│  │Microsoft│ │ ← v1.5 (Minecraft)
│  ├────────┤  │
│  │Web     │  │ ← v2.0
│  └────────┘  │
└──────────────┘
```

> マイクロサービス化は「必要になってから」行う。premature optimization を避ける。1000 Guild 未満なら Monolith + シャーディングで十分。
