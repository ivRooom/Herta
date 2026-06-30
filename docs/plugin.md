# Herta. — Plugin 設計書

> Version: 0.1.0
> 最終更新: 2026-06-30

---

## 1. 設計思想

Herta. の全機能は Plugin として実装される。Core は Plugin を動かす基盤のみを提供する。

```
Core が提供するもの:
  - Plugin Lifecycle 管理 (ロード/有効化/無効化/アンロード)
  - PluginContext (ロガー, キャッシュ, コマンド登録, イベント購読, EventBus)
  - Guild スコープの設定管理
  - Rule Engine との統合
  - Audit Log 連携

Core が提供しないもの:
  - 個別機能 (Auto Response, Moderation, Quote 等)
  - Plugin 固有の DB テーブル
  - Plugin 固有の API エンドポイント
  - Plugin 固有の Dashboard UI
```

---

## 2. Plugin SDK

### 2.1 BasePlugin 抽象クラス

```typescript
export abstract class BasePlugin {
  abstract readonly manifest: PluginManifest;

  /** Plugin がシステムにロードされたとき */
  abstract onLoad(context: PluginContext): Promise<void>;

  /** Plugin が特定の Guild で有効化されたとき */
  abstract onEnable(guildId: string, config: unknown): Promise<void>;

  /** Plugin が特定の Guild で無効化されたとき */
  abstract onDisable(guildId: string): Promise<void>;

  /** Plugin がシステムからアンロードされたとき */
  abstract onUnload(): Promise<void>;

  /** Plugin の設定が変更されたとき (オプション) */
  onConfigChange?(guildId: string, oldConfig: unknown, newConfig: unknown): Promise<void>;
}
```

### 2.2 PluginManifest

```typescript
export interface PluginManifest {
  /** 一意識別子 (kebab-case) */
  id: string;

  /** 表示名 */
  name: string;

  /** セマンティックバージョン */
  version: string;

  /** 説明 */
  description: string;

  /** 作者情報 */
  author: {
    name: string;
    url?: string;
  };

  /** カテゴリ (Dashboard のグルーピング用) */
  category: PluginCategory;

  /** Plugin が要求する権限 */
  permissions: PluginPermission[];

  /** 依存する他の Plugin */
  dependencies: PluginDependency[];

  /** 設定の JSON Schema */
  configSchema: Record<string, unknown>;

  /** 購読する Discord イベント */
  events: string[];

  /** 登録する Slash Command */
  commands: CommandDefinition[];

  /** 最小 Herta バージョン */
  minHertaVersion?: string;
}

export type PluginCategory =
  | 'core'
  | 'moderation'
  | 'fun'
  | 'game'
  | 'utility'
  | 'analytics';
```

### 2.3 PluginContext

```typescript
export interface PluginContext {
  /** Plugin スコープのロガー */
  logger: Logger;

  /** Redis クライアント (キーは Plugin ID で自動プレフィックス) */
  cache: ScopedRedisClient;

  /** Slash Command 登録 */
  registerCommands(commands: CommandDefinition[]): void;

  /** Discord イベント購読 */
  on(event: string, handler: (...args: unknown[]) => Promise<void>): void;

  /** Rule Engine Trigger 登録 */
  registerTrigger(trigger: TriggerDefinition): void;

  /** Rule Engine Condition 登録 */
  registerCondition(condition: ConditionDefinition): void;

  /** Rule Engine Action 登録 */
  registerAction(action: ActionDefinition): void;

  /** Audit Log イベント発行 */
  audit(guildId: string, event: AuditEvent): Promise<void>;

  /** 他の Plugin インスタンス取得 (依存宣言が必要) */
  getPlugin<T>(pluginId: string): T | null;

  /** Guild 固有の設定取得 */
  getConfig<T>(guildId: string): Promise<T>;

  /** 定期ジョブのスケジュール */
  schedule(cronExpression: string, handler: () => Promise<void>): void;

  /** Plugin 間イベント発火 */
  emit(eventName: string, payload: unknown): Promise<void>;

  /** Plugin 間イベント購読 */
  subscribe(eventName: string, handler: (payload: unknown) => Promise<void>): void;
}
```

---

## 3. Plugin 間通信 (EventBus)

Plugin 間の通信は EventBus パターンで実現する。直接参照 (`getPlugin`) も可能だが、疎結合を維持するために EventBus を推奨する。

### 3.1 EventBus アーキテクチャ

```
Plugin A                    EventBus                    Plugin B
   │                           │                           │
   │  emit('mod.userWarned',   │                           │
   │       { userId, reason }) │                           │
   │ ─────────────────────────>│                           │
   │                           │  subscribe('mod.userWarned')
   │                           │ ─────────────────────────>│
   │                           │                           │
```

### 3.2 イベント命名規則

```
<plugin-id>.<action>

例:
  moderation.userWarned
  moderation.messageDeleted
  quote.created
  quote.deleted
  lfg.postCreated
  lfg.postClosed
  auto-response.matched
```

### 3.3 使用例

```typescript
// moderation-plugin: ユーザー警告時にイベント発火
await this.ctx.emit('moderation.userWarned', {
  guildId,
  userId,
  reason,
  moderatorId,
});

// quote-plugin: 警告されたユーザーの Quote を一時的に非表示
this.ctx.subscribe('moderation.userWarned', async (payload) => {
  const { guildId, userId } = payload as { guildId: string; userId: string };
  await this.hideQuotesByUser(guildId, userId);
});
```

---

## 4. Plugin Lifecycle

### 4.1 状態遷移

```
[未登録] ──(register)──→ [登録済み]
[登録済み] ──(load)──→ [ロード済み]
[ロード済み] ──(enable)──→ [有効] (Guild 単位)
[有効] ──(disable)──→ [無効] (Guild 単位)
[ロード済み] ──(unload)──→ [登録済み]
```

### 4.2 ロード順序

1. Plugin の依存関係を解析
2. 依存グラフのトポロジカルソートで順序を決定
3. 循環依存がある場合はエラー
4. `manifest.dependencies[].optional === true` の場合、依存先が存在しなくてもロード可能

### 4.3 Guild 単位の有効化

```
Guild A: [auto-response: ON, moderation: ON, quote: OFF]
Guild B: [auto-response: OFF, moderation: ON, quote: ON]
```

各 Plugin は `guild_plugins` テーブルで Guild ごとに有効/無効が管理される。

---

## 5. Plugin の設定管理

### 5.1 設定スキーマ

Plugin は `configSchema` (JSON Schema) で設定項目を定義する。Dashboard はこのスキーマから自動的にフォームを生成する。

```typescript
configSchema: {
  type: 'object',
  properties: {
    maxResponses: {
      type: 'number',
      default: 50,
      minimum: 1,
      maximum: 200,
      description: '最大応答ルール数',
    },
    cooldownMs: {
      type: 'number',
      default: 3000,
      minimum: 0,
      maximum: 60000,
      description: 'クールダウン (ミリ秒)',
    },
  },
}
```

### 5.2 設定バージョニング

設定変更は `guild_plugin_config_history` テーブルに自動記録される。ロールバックが可能。

```
config_version: 1 → 変更 → config_version: 2 → 変更 → config_version: 3
                                                         ↑
                                                    ロールバック先
```

---

## 6. Plugin の DB テーブル管理

### 6.1 MVP 方針

全テーブルを中央の `packages/db/prisma/schema.prisma` に集約する。

**理由:**
- Plugin 数が少ない (MVP で 6 Plugin)
- Prisma の型生成が一元管理できる
- マイグレーションの整合性が保証される

### 6.2 Guild モデルの設計原則

Guild モデルは Core リレーションのみを保持する。Plugin 固有のリレーションは定義しない。

```prisma
// 正しい設計: Core リレーションのみ
model Guild {
  settings      GuildSettings?
  members       GuildMember[]
  roles         Role[]
  auditLogs     AuditLog[]
  guildPlugins  GuildPlugin[]
  rules         Rule[]
}

// 避ける: Plugin リレーションを Guild に追加しない
// model Guild {
//   quotes        Quote[]          ← 追加しない
//   lfgPosts      LfgPost[]        ← 追加しない
//   autoResponses AutoResponse[]   ← 追加しない
// }
```

Plugin テーブルは `guildId` の外部キーで直接 `guilds` テーブルを参照する。

### 6.3 将来の分離 (100 Plugin 超)

Plugin 数が増えた場合の選択肢:

| 選択肢 | 説明 | 移行コスト |
|---|---|---|
| Prisma マルチファイルスキーマ | `prismaSchemaFolder` で分割 | 低 |
| Kysely / raw SQL マイグレーション | Plugin 固有テーブルのみ別管理 | 中 |
| Plugin ごとに独立 DB | 完全分離 | 高 |

---

## 7. Plugin 固有の API エンドポイント

各 Plugin は NestJS Module として API エンドポイントを提供する。

```
apps/api/src/
├── auto-response/              # Auto Response Plugin の API
│   ├── auto-response.module.ts
│   ├── auto-response.controller.ts
│   ├── auto-response.service.ts
│   └── auto-response.dto.ts
├── moderation/                 # Moderation Plugin の API
│   ├── moderation.module.ts
│   ├── moderation.controller.ts
│   └── ...
```

**URL パターン:**

```
/api/v1/guilds/:guildId/<plugin-route>/...
```

---

## 8. Plugin パッケージの標準構造

```
plugins/<plugin-name>/
├── src/
│   ├── index.ts                # エントリポイント (export default plugin)
│   ├── plugin.ts               # BasePlugin 実装
│   ├── types.ts                # Plugin 固有の型定義
│   ├── <domain-logic>.ts       # ドメインロジック
│   └── <domain-logic>.test.ts  # ユニットテスト
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

### 8.1 package.json

```json
{
  "name": "@herta/plugin-<name>",
  "version": "1.0.0",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src/",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@herta/plugin-sdk": "workspace:*",
    "@herta/shared": "workspace:*"
  },
  "devDependencies": {
    "@herta/config": "workspace:*",
    "vitest": "^3.0.0"
  }
}
```

---

## 9. Plugin 実装例 (Auto Response)

```typescript
import { BasePlugin, PluginContext } from '@herta/plugin-sdk';
import type { PluginManifest } from '@herta/shared';

export class AutoResponsePlugin extends BasePlugin {
  readonly manifest: PluginManifest = {
    id: 'auto-response',
    name: 'Auto Response',
    version: '1.0.0',
    description: 'キーワード・正規表現に基づく自動応答',
    author: { name: 'Herta' },
    category: 'utility',
    permissions: [
      { id: 'auto-response.manage', name: 'Auto Response 管理', description: '自動応答ルールの追加・編集・削除' },
    ],
    dependencies: [],
    configSchema: {
      type: 'object',
      properties: {
        maxResponses: { type: 'number', default: 50 },
        cooldownMs: { type: 'number', default: 3000 },
      },
    },
    events: ['messageCreate'],
    commands: [{ name: 'autoresponse', description: '自動応答の管理' }],
  };

  private ctx!: PluginContext;

  async onLoad(context: PluginContext): Promise<void> {
    this.ctx = context;

    // Discord イベント購読
    context.on('messageCreate', this.handleMessage.bind(this));

    // Rule Engine Trigger 登録
    context.registerTrigger({
      type: 'auto-response.match',
      name: 'Auto Response マッチ',
      configSchema: {},
      evaluate: this.evaluateTrigger.bind(this),
    });
  }

  async onEnable(guildId: string): Promise<void> {
    // Guild のルールをキャッシュにロード
    await this.loadResponsesIntoCache(guildId);
  }

  async onDisable(guildId: string): Promise<void> {
    // キャッシュをクリア
    await this.ctx.cache.del(`responses:${guildId}`);
  }

  async onUnload(): Promise<void> {
    // クリーンアップ
  }

  private async handleMessage(message: unknown): Promise<void> {
    // マッチング → 応答
  }

  private async evaluateTrigger(event: unknown): Promise<boolean> {
    return false;
  }

  private async loadResponsesIntoCache(guildId: string): Promise<void> {
    // DB → Redis
  }
}
```

---

## 10. MVP Plugin 一覧

| Plugin ID | 名前 | カテゴリ | 優先度 |
|---|---|---|---|
| `auto-response` | Auto Response | utility | Phase 3 Week 6 |
| `moderation` | Moderation | moderation | Phase 3 Week 7 |
| `quote` | Quote (名言) | fun | Phase 3 Week 8 |
| `lfg` | LFG (メンバー募集) | game | Phase 6 Week 14 |
| `team-split` | Team Split | game | Phase 6 Week 14 |
| `daily-content` | Daily Content | utility | Phase 6 Week 15 |

---

## 11. 将来の Plugin 候補

| Plugin ID | 名前 | Phase |
|---|---|---|
| `analytics` | Community Analytics | v1.0 |
| `economy` | ポイント / 通貨システム | v1.0 |
| `faq` | FAQ / RAG | v1.5 |
| `music` | Music Player | v1.5 |
| `valorant` | VALORANT 連携 | v1.5 |
| `genshin` | 原神連携 | v1.5 |
| `minecraft` | Minecraft 管理 | v1.5 |
| `ai-assistant` | AI アシスタント | v2.0 |

---

## 12. Plugin セキュリティ

### 12.1 公式 Plugin (MVP)

- Monorepo 内で開発・レビュー
- 制限なし (Core と同じ権限)

### 12.2 コミュニティ Plugin (将来)

| 制限項目 | 制限内容 |
|---|---|
| DB アクセス | Plugin 専用テーブルのみ |
| Redis | キープレフィックスで namespace 分離 |
| 外部通信 | 許可された URL のみ |
| Discord API | Rate Limit を Plugin 単位で管理 |
| 実行時間 | タイムアウト設定 |
| メモリ | 制限付き |
