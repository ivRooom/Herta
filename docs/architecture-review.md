# Herta. Architecture Review

> Discord Community Operating System — 設計・企画・アーキテクチャレビュー
> Reviewer: Devin (Cognition AI)
> Date: 2026-06-30
> Status: Pre-Implementation Review

---

## 前提

本レビューは、ivRooom/Herta リポジトリ（現在 README.md のみ）と、前身プロジェクト ivRooom/lunaria（稼働中の Discord Bot + Dashboard + Plugin Platform）の設計・実装を精査した上で、Herta. の新規アーキテクチャとして何を継承し、何を改善すべきかを提言するものです。

lunaria の現状:
- Monorepo (pnpm + Turborepo)
- apps/: api (NestJS), bot (discord.js), worker (BullMQ), admin-web (Next.js), member-web (Next.js)
- packages/: db (Prisma), plugin-sdk, rule-engine, shared, ui, config
- plugins/: auto-response, moderation, quote (3つ実装済み)
- Docker Compose + AWS Lightsail でデプロイ
- 設計書あり (docs/architecture/README.md, 1893行)

---

## ① 設計思想レビュー

### 評価: 方向性は正しい。ただし「OS」を名乗るなら抽象度をもう1段上げる必要がある

**良い点:**
- 「機能ではなく拡張基盤」という方針は正しい。lunaria で既に Plugin System + Rule Engine の基盤を実証済み
- Guild 単位のマルチテナント設計が最初から組み込まれている
- Quote ですら Plugin として動作する設計哲学は一貫している

**改善すべき点:**
- 「Discord Community Operating System」を名乗るなら、現在の設計は「Discord Bot with Plugin System」のレベルに留まっている
- OS と呼ぶには以下が欠けている:
  1. **プロセス管理**: Plugin のライフサイクルが `onLoad/onEnable/onDisable/onUnload` の4つだけ。サスペンド・レジューム、リソース制限、優先度スケジューリングがない
  2. **ファイルシステム抽象**: Plugin 間のデータ共有の仕組みが `getPlugin()` 経由の直接参照のみ。共有データバスやイベントバスがない
  3. **プロセス間通信 (IPC)**: Plugin 間のメッセージパッシングが未定義。現状は Plugin A が Plugin B のインスタンスを直接取得するだけ
  4. **リソースガバナンス**: Plugin ごとの CPU/メモリ/API コール制限が未設計

**提言:**
- MVP では「OS」の全機能は不要。まず「Extensible Discord Platform」として設計し、Phase 2 以降で OS レイヤーを段階的に追加する
- ただし、Plugin 間通信の抽象化（EventBus パターン）だけは MVP から入れるべき。後から入れると全 Plugin の書き換えが必要になる

---

## ② Monorepo 構成レビュー

### 評価: この規模なら Monorepo で問題ない。ただし分割ポイントを今から決めておくべき

**問題ない理由:**
- pnpm workspaces + Turborepo は 50+ パッケージでも実績がある
- 全コンポーネントが同一言語 (TypeScript) であり、型共有の恩恵が大きい
- lunaria で既に apps 5 + packages 6 + plugins 3 = 14 パッケージで問題なく運用できている
- CI キャッシュ (Turborepo Remote Cache) で ビルド時間を制御可能

**将来の分割ポイント:**
- **100 Plugin 超**: `plugins/` ディレクトリが肥大化する。Plugin を別リポジトリに分離し、npm private registry 経由でインストールする設計を今から想定しておく
- **Bot シャーディング**: Bot が複数プロセスに分かれたとき、Monorepo 内の `apps/bot` を独立デプロイ可能にする必要がある
- **Dashboard の独立運用**: admin-web を Vercel にデプロイする場合、Monorepo の一部だけをデプロイする仕組みが必要（Turborepo の `--filter` で対応可能）

**提言:**
- Monorepo を維持しつつ、各パッケージの境界を厳密にする:
  - `packages/*` は純粋な npm パッケージとしてビルド可能にする（`tsc` で `.d.ts` 生成、`exports` フィールド設定）
  - `plugins/*` は将来的に外部リポジトリからインストール可能な構造にする
  - `apps/*` は独立して Docker イメージをビルド可能にする（lunaria で既に実現済み）

---

## ③ Package 構成レビュー

### 評価: 概ね適切。いくつか追加・統合が必要

**lunaria の現在の構成:**
```
packages/
├── db/           # Prisma schema + migrations
├── plugin-sdk/   # BasePlugin, PluginContext, lifecycle types
├── rule-engine/  # Trigger/Condition/Action 評価
├── shared/       # 型定義、定数、ユーティリティ
├── ui/           # 共通 UI コンポーネント
└── config/       # ESLint/TS/Tailwind 設定
```

**Herta. で推奨する構成:**
```
packages/
├── db/              # 継続: Prisma schema + migrations + seed
├── plugin-sdk/      # 継続 + 強化: Plugin manifest, lifecycle, EventBus
├── rule-engine/     # 継続: Trigger/Condition/Action
├── shared/          # 継続: 型定義、定数、ユーティリティ
├── ui/              # 継続: shadcn/ui ベース
├── config/          # 継続: lint/ts/tailwind 設定
├── logger/          # 新規: 構造化ログ (pino) のラッパー
├── queue/           # 新規: BullMQ ジョブ定義の共通化
└── api-client/      # 新規: 型安全な内部 API クライアント (Bot→API, Worker→API)
```

**追加の理由:**
- `logger/`: 現状 pino を各 app で個別に初期化している。ログフォーマット、ログレベル、コンテキスト注入を統一するパッケージが必要
- `queue/`: Worker のジョブ定義が `apps/worker` に閉じている。Bot や API からジョブをエンキューするとき、ジョブ名・ペイロード型の共有が必要
- `api-client/`: Bot が API を呼ぶとき、Internal API Key を使った HTTP クライアントが各所で重複する。型安全なクライアントを共有パッケージにする

---

## ④ Plugin SDK レビュー

### 評価: 基本は十分。3つの重要な拡張が必要

**現状の SDK が提供するもの:**
- `BasePlugin` 抽象クラス (onLoad/onEnable/onDisable/onUnload/onConfigChange)
- `PluginContext` インタフェース (logger, cache, registerCommands, on, registerTrigger/Condition/Action, audit, getPlugin, getConfig, schedule)
- `PluginManifest` 型 (id, name, version, description, author, category, permissions, dependencies, configSchema, events, commands)

**不足している点と改善案:**

### 1. EventBus（Plugin 間通信）
```typescript
// 現状: Plugin 間の通信手段がない（getPlugin で直接参照のみ）
// 改善: EventBus を PluginContext に追加

interface PluginContext {
  // 既存のメソッドに加えて:

  /** Plugin 間イベントを発火 */
  emit(eventName: string, payload: unknown): Promise<void>;

  /** 他の Plugin が発火したイベントを購読 */
  subscribe(eventName: string, handler: (payload: unknown) => Promise<void>): void;
}

// 使用例: Moderation Plugin が Quote Plugin に通知
// moderation-plugin:
await this.ctx.emit('moderation.userWarned', { userId, guildId, reason });

// quote-plugin:
this.ctx.subscribe('moderation.userWarned', async (payload) => {
  // 警告されたユーザーの Quote を一時的に非表示
});
```

### 2. Dashboard 統合（Plugin が UI を提供する仕組み）
```typescript
interface PluginManifest {
  // 既存のフィールドに加えて:

  /** Dashboard に表示する設定ページの定義 */
  dashboard?: {
    /** 設定フォームの JSON Schema */
    settingsSchema?: JsonSchema;
    /** カスタムページのルート定義 */
    pages?: Array<{
      path: string;
      title: string;
      icon?: string;
      /** ページコンポーネントのエントリポイント */
      component: string;
    }>;
    /** サイドバーのナビゲーション項目 */
    navigation?: {
      label: string;
      icon: string;
      position?: number;
    };
  };
}
```

### 3. Migration（Plugin 固有テーブルの管理）
```typescript
interface PluginManifest {
  // 既存の migrations フィールドを強化:

  /** Plugin 固有の DB マイグレーション */
  migrations?: {
    /** マイグレーションファイルのディレクトリ */
    directory: string;
    /** テーブル名のプレフィックス (namespace 衝突防止) */
    tablePrefix: string;
  };
}
```

現状は全テーブルが `packages/db/prisma/schema.prisma` に集約されている。Plugin 数が増えると schema.prisma が肥大化する。Plugin 固有テーブルは Plugin 側で管理すべき。

**注意:** Prisma は単一 schema ファイルが前提のため、Plugin 固有テーブルの管理は Prisma だけでは難しい。以下の選択肢がある:
- a) Prisma を Plugin Core テーブルのみに使い、Plugin 固有テーブルは `kysely` や raw SQL マイグレーションで管理
- b) Prisma の `prismaSchemaFolder` プレビュー機能（マルチファイルスキーマ）を利用
- c) 全テーブルを中央 schema に保持し続ける（100 Plugin 未満なら現実的）

**提言:** MVP では (c) を選択。100 Plugin を超える見込みが立った時点で (a) or (b) に移行。

---

## ⑤ Rule Engine レビュー

### 評価: 基本設計は十分。実行モデルの改善と安全性の強化が必要

**現状の強み:**
- Trigger → Condition (AND) → Action の3段パイプラインは直感的で正しい
- Priority ベースの順序実行が実装済み
- 実行ログの記録が設計済み
- Cooldown と Max Executions が組み込み済み

**改善すべき点:**

### 1. Condition の論理結合
現状は Condition を全て AND で評価している:
```typescript
// evaluator.ts L69
const conditionsMet = await this.conditions.evaluateAll(context, rule.conditions);
```
`not` / `or` / `and` の ConditionType は定義されているが、ネスト構造の評価ロジックが未実装。

**提言:** Condition をツリー構造で評価できるようにする:
```typescript
interface ConditionNode {
  type: 'and' | 'or' | 'not' | ConditionType;
  config?: Record<string, unknown>;
  children?: ConditionNode[];  // and/or/not の場合
}
```

### 2. Action の実行モデル
現状は Action を順次実行している。以下を追加すべき:
- **並列実行**: 独立した Action を同時に実行するオプション
- **エラーハンドリングポリシー**: `stopOnError` / `continueOnError` / `rollback` の選択
- **条件分岐 Action**: Action の結果に応じて次の Action を分岐（`conditional` ActionType は定義済みだが未実装）

### 3. サンドボックス化
Rule Engine の `callApi` や `sendWebhook` アクションは外部サービスへのリクエストを発生させる。セキュリティ上:
- 許可された URL ドメインのホワイトリスト
- レート制限（Guild 単位、Rule 単位）
- タイムアウト設定
- レスポンスサイズ制限

### 4. テンプレートエンジンの安全性
`{{user.mention}}` のようなテンプレート変数が実行時に解決される設計だが:
- テンプレートインジェクション対策（`{{constructor.prototype}}` のような悪意ある入力）
- 再帰的テンプレート展開の防止
- 変数アクセスのホワイトリスト

**提言:** テンプレートエンジンは自作せず、`handlebars` や `mustache` を使い、安全な変数解決のみに限定する。

---

## ⑥ 100+ Plugin スケーラビリティ

### 評価: 現設計は 30-50 Plugin まで。100+ には構造的な変更が必要

**ボトルネック:**

| 問題 | 現状 | 100+ Plugin 時 |
|---|---|---|
| Schema 肥大化 | 全テーブルが schema.prisma に集約 | 1000行超の schema、マイグレーション衝突リスク |
| Plugin ロード時間 | 全 Plugin を起動時に一括ロード | メモリ消費増大、起動時間の長期化 |
| CI ビルド時間 | `turbo build` で全パッケージビルド | 変更のない Plugin もビルドされる |
| Guild モデルの肥大化 | Guild model に全 Plugin のリレーションが定義 | リレーション 100+ で Prisma の型生成が遅くなる |

**解決策:**

1. **Lazy Loading**: Plugin を必要なときだけロードする
```typescript
class PluginLoader {
  private loaded = new Map<string, BasePlugin>();

  async getPlugin(pluginId: string): Promise<BasePlugin> {
    if (!this.loaded.has(pluginId)) {
      const plugin = await import(`@herta/plugin-${pluginId}`);
      await plugin.default.onLoad(this.createContext(pluginId));
      this.loaded.set(pluginId, plugin.default);
    }
    return this.loaded.get(pluginId)!;
  }
}
```

2. **Plugin Registry の外部化**: Plugin の定義を DB + npm registry に保持し、コードベースから分離

3. **Schema の分割**: Plugin Core テーブル (guilds, users, roles, rules, audit_logs, guild_plugins) と Plugin 固有テーブルを分離

4. **Guild モデルのスリム化**: Guild モデルから Plugin 固有のリレーションを除去。`guild_plugins` テーブル経由で動的に解決

---

## ⑦ Herta Studio の方向性

### 評価: 適切だが、段階的に構築すべき

「Herta Studio」= Dashboard + Visual Rule Builder + Plugin Marketplace の統合環境と解釈する。

**lunaria の現状:**
- admin-web: Guild 設定、Plugin 管理、Rule 編集、Audit 閲覧
- member-web: メンバーポータル（プロフィール、Quote 閲覧）
- Rule Builder UI: WHEN/IF/THEN のビジュアルエディタ（設計済み、実装途中）

**Herta Studio として追加すべき要素:**

| Phase | 機能 | 優先度 |
|---|---|---|
| MVP | Plugin ON/OFF + 設定フォーム | 必須 |
| MVP | Rule Builder (WHEN/IF/THEN) | 必須 |
| MVP | Audit Log 閲覧 | 必須 |
| v1.0 | Plugin テンプレート（ワンクリック設定） | 高 |
| v1.0 | ダッシュボード（統計、アクティビティ） | 高 |
| v1.5 | Plugin Marketplace (公式 Plugin 一覧) | 中 |
| v2.0 | Visual Workflow Builder (IFTTT 的 UI) | 中 |
| v2.0 | Plugin 開発エディタ (Monaco Editor) | 低 |
| v3.0 | コミュニティ Plugin ストア | 低 |

**提言:**
- 「Studio」ブランドは v1.0 以降に使用。MVP 段階では「Dashboard」で十分
- Visual Rule Builder は MVP で必須。これが Herta. の差別化ポイント
- Plugin 開発エディタ（ブラウザ上で Plugin コードを書く機能）は v2.0 以降。複雑すぎて MVP には不要

---

## ⑧ Marketplace 設計

### 評価: MVP では不要。v1.5 以降で段階的に構築

**Marketplace のアーキテクチャ提案:**

```
┌─────────────────────────────────────────────────────┐
│                 Herta Marketplace                     │
├────────────┬──────────────┬─────────────────────────┤
│  Registry  │  Review      │  Distribution            │
│            │  System      │                          │
│ - manifest │ - 自動審査   │ - npm private registry   │
│ - version  │ - 手動審査   │ - Docker image           │
│ - metadata │ - サンドボックス │ - CDN (static assets) │
│ - stats    │   テスト     │                          │
└────────────┴──────────────┴─────────────────────────┘
```

**Phase 分け:**

### Phase 1 (v1.5): 公式 Plugin ストア
- Herta チームが作成した Plugin のみ
- Monorepo 内の `plugins/` から自動的に一覧生成
- Dashboard で ON/OFF + 設定変更

### Phase 2 (v2.0): コミュニティ Plugin (招待制)
- Plugin SDK を npm パッケージとして公開
- 開発者がローカルで Plugin を開発 → PR で審査
- サンドボックス環境でテスト実行
- 審査通過後に Marketplace に公開

### Phase 3 (v3.0): オープン Marketplace
- 開発者ポータル (developer.herta.app)
- 自動審査パイプライン (lint, security scan, test)
- レビュー・評価システム
- 収益化モデル (free / premium Plugin)

**セキュリティ上の重要事項:**
- コミュニティ Plugin は制限された PluginContext を受け取る
  - DB アクセス: Plugin 専用テーブルのみ (他 Plugin のテーブルにはアクセス不可)
  - Redis: キープレフィックスで namespace 分離
  - 外部通信: 許可された URL のみ
  - Discord API: Rate Limit を Plugin 単位で管理
- Plugin のコードレビューは必須 (少なくとも Phase 2 まで)

---

## ⑨ セキュリティ上の問題点

### 重大度: 高

1. **Discord OAuth Access Token の平文保存**
   - lunaria の Prisma schema で `accessToken String? @map("access_token")` が User モデルにある
   - Discord OAuth の access token は DB に平文で保存されている
   - **対策:** access token は DB に保存しない。JWT のクレームに含めるか、Redis に短期間だけ保持

2. **Internal API Key の管理**
   - Bot ↔ API 通信が単一の `INTERNAL_API_KEY` で認証されている
   - この鍵が漏洩すると全 Guild のデータにアクセス可能
   - **対策:** 署名付き JWT (サービス間認証) に切り替え。鍵のローテーション機構を追加

3. **Rule Engine の `callApi` / `sendWebhook`**
   - 任意の URL に HTTP リクエストを送信可能
   - SSRF (Server Side Request Forgery) のリスク
   - **対策:** URL ホワイトリスト、内部ネットワークへのアクセス禁止、DNS リバインディング対策

4. **テンプレートインジェクション**
   - Rule Engine のテンプレート変数 `{{...}}` が安全にサンドボックス化されていない
   - **対策:** 安全なテンプレートエンジンの採用、変数アクセスのホワイトリスト

5. **Plugin のリソース制限がない**
   - 悪意のある Plugin が無限ループ、大量のメモリ消費、大量の DB クエリを発行可能
   - MVP（公式 Plugin のみ）では問題にならないが、コミュニティ Plugin 開放時に必須
   - **対策:** Plugin 実行のタイムアウト、メモリ制限、クエリ数制限

### 重大度: 中

6. **RBAC のデフォルトロール**
   - lunaria では `isDefault` ロールの初期権限が明示されていない
   - **対策:** 最小権限の原則。デフォルトロールは `view` 権限のみ

7. **Audit Log の改ざん防止**
   - Audit Log は通常の DB テーブルに保存されており、DB アクセス権があれば改変可能
   - **対策:** Append-only テーブル設計 (DELETE/UPDATE を DB レベルで禁止)、ハッシュチェーン

8. **Rate Limiting の粒度**
   - lunaria では Global と Per-Endpoint の Rate Limit のみ
   - **対策:** Guild 単位、User 単位、Plugin 単位の Rate Limit を追加

---

## ⑩ 将来的に設計変更しづらい箇所

### 変更コストが極めて高い項目:

1. **Guild モデルと Plugin の密結合**
   - 現状: Guild model に全 Plugin のリレーション (`quotes`, `lfgPosts`, `autoResponses` 等) が直接定義
   - 問題: Plugin 追加のたびに Guild model を変更 → マイグレーション → 全サービス再デプロイ
   - **今決めるべき:** Guild model は Core フィールドのみ保持。Plugin データは `guild_plugins` テーブル + Plugin 固有テーブルで管理

2. **Plugin SDK の PluginContext インタフェース**
   - `PluginContext` のメソッドシグネチャは全 Plugin が依存する
   - 一度公開すると後方互換性を壊す変更は全 Plugin の修正が必要
   - **今決めるべき:** PluginContext をバージョニングする (`PluginContextV1`, `PluginContextV2`)、または Extension パターンで拡張可能にする

3. **Rule の JSON 構造**
   - `trigger`, `conditions`, `actions` が JSONB カラムに保存
   - JSON のスキーマを変更すると既存ルールが壊れる
   - **今決めるべき:** JSON スキーマにバージョンフィールドを追加 (`{ "version": 1, "type": "...", "config": {...} }`)

4. **API の URL 構造**
   - `/api/guilds/:guildId/plugins/:pluginId/...` というパス構造
   - Plugin が独自エンドポイントを登録する仕組みが固定されている
   - **今決めるべき:** API Versioning (`/api/v1/...`)

5. **認証方式**
   - Discord OAuth2 + JWT が唯一の認証手段
   - 将来 Minecraft (Microsoft OAuth), Web ログインを追加する場合、認証レイヤーの大幅な変更が必要
   - **今決めるべき:** 認証プロバイダーを抽象化する。統合 Identity モデルを設計

---

## ⑪ 今決めておくべきこと

### 必須 (MVP 開始前に決定)

1. **プロジェクト名の確定**
   - "Herta." と "Lunaria" の関係を明確にする
   - Herta. が Lunaria の後継なのか、別プロジェクトなのか
   - npm パッケージのスコープ (`@herta/*` vs `@lunaria/*`)

2. **Plugin 間通信の設計**
   - EventBus パターンを採用するか、直接参照を維持するか
   - この決定は全 Plugin の実装に影響する

3. **API Versioning**
   - `/api/v1/...` を最初から導入するか
   - ヘッダーベース (`Accept: application/vnd.herta.v1+json`) vs パスベース (`/api/v1/...`)
   - **推奨:** パスベース（シンプルで分かりやすい）

4. **Rule JSON Schema のバージョニング**
   - 今からバージョンフィールドを入れておく

5. **命名規則の統一**（⑱で詳述）

6. **ドメイン名**
   - `herta.app` / `herta.dev` / 既存の `ivrm.jp` サブドメイン
   - API / Dashboard / Member Portal のドメイン

7. **認証プロバイダーの抽象化レベル**
   - Discord 専用か、マルチプロバイダー対応か

### 推奨 (MVP 中に決定)

8. **Bot シャーディング戦略**
   - 2500 Guild で Discord Gateway の制限に達する
   - discord.js の `ShardingManager` を使うか、プロセス分離するか

9. **Plugin の設定スキーマ検証**
   - JSON Schema (現状) vs Zod schema vs 両方
   - Dashboard のフォーム自動生成に影響

10. **ログ・監視基盤**
    - Pino + CloudWatch / Loki / Datadog のどれを使うか
    - 構造化ログのフォーマット

---

## ⑫ 今の時点で不要な設計

### 削除または延期すべき項目:

1. **member-web (メンバーポータル)**
   - lunaria では `apps/member-web` が存在するがほぼ空
   - MVP ではメンバー向け UI は Discord 内で完結すべき
   - **延期: v1.0 以降**

2. **Plugin Marketplace**
   - コミュニティ Plugin のストアは MVP では不要
   - **延期: v1.5 以降**

3. **AI Assistant**
   - LLM 統合は複雑すぎて MVP のスコープ外
   - **延期: v2.0 以降**

4. **Game API 統合 (Riot, HoYo)**
   - 外部 API 連携は個別の Plugin として後から追加可能
   - **延期: v1.5 以降**

5. **Minecraft Server Management**
   - OCI 連携は別インフラの問題。Plugin として後から追加
   - **延期: v1.5 以降**

6. **Web Server Management**
   - Discord Bot の範囲を大きく超える。別プロジェクトにすべき
   - **延期: v2.0 以降、または別プロジェクト**

7. **Economy Plugin (ポイント/通貨システム)**
   - 複雑なトランザクション管理が必要。MVP では不要
   - **延期: v1.0 以降**

8. **Kubernetes 移行**
   - 1000 Guild 未満なら Docker Compose + Lightsail で十分
   - **延期: スケーリングが必要になったとき**

9. **Config の暗号化**
   - PII の暗号化保存は重要だが MVP では不要
   - **延期: v1.0 (本番リリース前)**

---

## ⑬ MVP として削るべきもの

### 以下は MVP から除外:

| 機能 | 理由 | いつ追加 |
|---|---|---|
| member-web | Discord 内で完結可能 | v1.0 |
| Visual Workflow Builder (IFTTT的) | Rule Builder で代用 | v2.0 |
| Plugin Marketplace | 公式 Plugin のみ | v1.5 |
| Game API 連携 | 外部依存が多い | v1.5 |
| AI Assistant | 複雑すぎる | v2.0 |
| Minecraft Management | 別インフラ | v1.5 |
| Web Server Management | スコープ外 | v2.0 |
| Economy (ポイントシステム) | トランザクション管理 | v1.0 |
| Analytics Dashboard | データ蓄積が必要 | v1.0 |
| Multi-language (i18n) | 日本語のみで十分 | v1.5 |
| Bot シャーディング | 2500 Guild まで不要 | v1.0 |
| E2E テスト (Playwright) | Unit + Integration で十分 | v0.3 |

---

## ⑭ MVP でも絶対に必要なもの

### 必須コンポーネント:

| カテゴリ | コンポーネント | 理由 |
|---|---|---|
| **基盤** | Discord OAuth + JWT 認証 | Dashboard アクセスに必須 |
| **基盤** | Guild マルチテナント | 全機能の前提 |
| **基盤** | RBAC (ロールベースアクセス制御) | 権限管理の基盤 |
| **基盤** | Audit Log | 運用・セキュリティの基盤 |
| **基盤** | Plugin Registry + Lifecycle | 全 Plugin の基盤 |
| **基盤** | Rule Engine (Trigger/Condition/Action) | 自動化の基盤 |
| **基盤** | Config Versioning + Rollback | 設定ミスからの復旧 |
| **Bot** | discord.js Gateway 接続 | Bot の中核 |
| **Bot** | Slash Command ハンドリング | ユーザーインタラクション |
| **Bot** | Event Handler + Plugin Loader | Plugin 実行基盤 |
| **API** | NestJS REST API | Dashboard のバックエンド |
| **API** | Rate Limiting | API 保護 |
| **API** | Input Validation (Zod) | セキュリティ |
| **API** | Health Check | 運用監視 |
| **Worker** | BullMQ ジョブキュー | 非同期処理 |
| **Dashboard** | Guild 選択 + Overview | 最低限の管理 UI |
| **Dashboard** | Plugin ON/OFF + 設定 | Plugin 管理 |
| **Dashboard** | Rule Builder (WHEN/IF/THEN) | 差別化機能 |
| **Dashboard** | Audit Log 閲覧 | 運用必須 |
| **Plugin** | Auto Response | 最初の Plugin (基盤検証) |
| **Plugin** | Moderation (NGワード, スパム) | コミュニティ運営必須 |
| **Infra** | Docker Compose | デプロイ基盤 |
| **Infra** | PostgreSQL + Redis | データストア |
| **Infra** | CI (lint + typecheck + test + build) | コード品質 |

---

## ⑮ 推奨ディレクトリ構成

```
herta/
├── apps/
│   ├── api/                    # NestJS REST API
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── app.module.ts
│   │   │   ├── core/           # 認証, Guild, User, RBAC, Audit
│   │   │   │   ├── auth/
│   │   │   │   ├── guild/
│   │   │   │   ├── user/
│   │   │   │   ├── rbac/
│   │   │   │   └── audit/
│   │   │   ├── plugin/         # Plugin Registry, Config, Lifecycle
│   │   │   ├── rule-engine/    # Rule CRUD + 評価ブリッジ
│   │   │   ├── health/
│   │   │   └── common/         # Prisma, Redis, Filters, Pipes
│   │   ├── test/
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   ├── bot/                    # discord.js Bot
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── bot.ts
│   │   │   ├── commands/       # Slash Command ハンドラ
│   │   │   ├── events/         # Discord Event ハンドラ
│   │   │   ├── plugin-loader/  # Plugin ロード + Context 生成
│   │   │   └── rule-bridge/    # Bot ↔ Rule Engine ブリッジ
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   ├── worker/                 # BullMQ Worker
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   └── jobs/           # ジョブハンドラ
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   └── studio/                 # Next.js Dashboard (Herta Studio)
│       ├── src/
│       │   ├── app/
│       │   │   ├── (auth)/     # ログイン, コールバック
│       │   │   └── (dashboard)/
│       │   │       └── [guildId]/
│       │   │           ├── page.tsx         # Overview
│       │   │           ├── plugins/         # Plugin 管理
│       │   │           ├── rules/           # Rule Builder
│       │   │           ├── audit-log/       # 監査ログ
│       │   │           ├── roles/           # RBAC ロール
│       │   │           └── settings/        # Guild 設定
│       │   ├── components/
│       │   ├── lib/
│       │   └── hooks/
│       ├── tsconfig.json
│       └── package.json
│
├── packages/
│   ├── db/                     # Prisma schema + migrations + seed
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   ├── migrations/
│   │   │   └── seed.ts
│   │   ├── src/
│   │   │   └── index.ts        # PrismaClient re-export
│   │   └── package.json
│   │
│   ├── plugin-sdk/             # Plugin SDK
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── base/           # BasePlugin
│   │   │   ├── context/        # PluginContext, EventBus
│   │   │   └── types/          # Manifest, Lifecycle, Permissions
│   │   └── package.json
│   │
│   ├── rule-engine/            # Rule Engine コア
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── evaluator.ts
│   │   │   ├── trigger-registry.ts
│   │   │   ├── condition-registry.ts
│   │   │   ├── action-registry.ts
│   │   │   ├── template.ts     # テンプレート変数解決
│   │   │   └── types.ts
│   │   └── package.json
│   │
│   ├── shared/                 # 共通型定義・定数・ユーティリティ
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── types/          # API, Auth, Guild, Plugin, Rule
│   │   │   ├── constants/      # Permissions, Limits
│   │   │   └── utils/          # Pagination, Template, Validation
│   │   └── package.json
│   │
│   ├── logger/                 # 構造化ログ
│   │   ├── src/
│   │   │   └── index.ts        # pino ラッパー
│   │   └── package.json
│   │
│   ├── queue/                  # BullMQ ジョブ定義
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   └── jobs/           # ジョブ名・ペイロード型定義
│   │   └── package.json
│   │
│   ├── ui/                     # 共通 UI コンポーネント
│   │   └── package.json
│   │
│   └── config/                 # ESLint, TypeScript, Tailwind 設定
│       └── package.json
│
├── plugins/                    # Plugin 実装
│   ├── auto-response/
│   │   ├── src/
│   │   │   ├── index.ts        # export default plugin
│   │   │   ├── plugin.ts       # extends BasePlugin
│   │   │   ├── matcher.ts      # マッチングロジック
│   │   │   ├── cooldown.ts
│   │   │   └── types.ts
│   │   ├── __tests__/
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   ├── moderation/
│   ├── quote/
│   ├── lfg/
│   ├── team-split/
│   └── daily-content/
│
├── deploy/                     # デプロイスクリプト
│   ├── docker/
│   │   └── nginx/
│   └── scripts/
│
├── docs/                       # ドキュメント
│   ├── architecture/
│   ├── operations/
│   └── plugin-development/
│
├── .github/
│   └── workflows/
│       ├── ci.yml
│       └── deploy.yml
│
├── docker-compose.yml          # ローカル開発
├── docker-compose.prod.yml     # 本番
├── Dockerfile                  # マルチステージビルド
├── turbo.json
├── pnpm-workspace.yaml
├── package.json
├── tsconfig.base.json
└── .env.example
```

**lunaria からの主な変更:**
- `apps/admin-web` → `apps/studio` (Herta Studio ブランド)
- `apps/member-web` → MVP から除外
- `packages/logger` と `packages/queue` を新規追加
- `plugins/` 内のテスト配置を `__tests__/` ディレクトリに統一
- `deploy/docker/` にコンテナ設定を集約

---

## ⑯ 推奨 DB 構成

### Core テーブル (変更不可の基盤)

```
guilds                         # Discord Guild
guild_settings                 # Guild 設定
users                          # Discord User
guild_members                  # Guild ↔ User 中間テーブル
roles                          # RBAC ロール
user_roles                     # User ↔ Role 中間テーブル
audit_logs                     # 監査ログ (append-only)
plugins                        # Plugin レジストリ (マスタ)
guild_plugins                  # Guild ↔ Plugin (設定, 有効/無効)
guild_plugin_config_history    # 設定変更履歴
rules                          # Rule Engine ルール定義
rule_execution_logs            # ルール実行ログ
```

### Plugin テーブル (Plugin 追加に伴い増加)

```
auto_responses                 # Auto Response ルール
mod_actions                    # モデレーションアクション履歴
word_filters                   # NGワードフィルター
spam_settings                  # スパム検知設定
moderation_settings            # モデレーション設定
quotes                         # 名言
daily_contents                 # 日次コンテンツ
lfg_posts                      # LFG 募集
lfg_participants               # LFG 参加者
team_split_sessions            # チーム分け
```

### lunaria からの改善点:

1. **Guild モデルのスリム化**
```prisma
// 現状 (lunaria): Guild に全 Plugin のリレーションが定義
model Guild {
  quotes        Quote[]          // ← Plugin ごとに増える
  lfgPosts      LfgPost[]        // ← Plugin ごとに増える
  autoResponses AutoResponse[]   // ← Plugin ごとに増える
  // ... 10+ Plugin のリレーション
}

// 改善 (herta): Guild は Core リレーションのみ
model Guild {
  settings      GuildSettings?
  members       GuildMember[]
  roles         Role[]
  auditLogs     AuditLog[]
  guildPlugins  GuildPlugin[]
  rules         Rule[]
  // Plugin 固有のリレーションは定義しない
  // Plugin テーブルは guildId の FK のみで参照
}
```

2. **Audit Log の改善**
```prisma
model AuditLog {
  // 既存フィールドに加えて:
  severity    String   @default("info")  // info | warning | critical
  sessionId   String?  @map("session_id") // ユーザーセッション追跡
}
```

3. **Rule のバージョニング**
```prisma
model Rule {
  // 既存フィールドに加えて:
  schemaVersion  Int  @default(1) @map("schema_version")
}
```

4. **インデックス戦略**
```prisma
// 全 Plugin テーブルに共通のインデックスパターン
@@index([guildId, enabled])     // 有効なレコードの検索
@@index([guildId, createdAt])   // 時系列の検索

// Audit Log は時系列クエリが多いため
@@index([guildId, createdAt(sort: Desc)])
@@index([guildId, event])
@@index([guildId, actorId])
```

---

## ⑰ 推奨 Plugin 構成

### Plugin パッケージの標準構造:

```
plugins/<plugin-name>/
├── src/
│   ├── index.ts                # エントリポイント (export default plugin)
│   ├── plugin.ts               # BasePlugin 実装
│   ├── types.ts                # Plugin 固有の型定義
│   ├── <domain-logic>.ts       # ドメインロジック
│   └── <domain-logic>.test.ts  # ユニットテスト (co-located)
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

### package.json の標準構成:

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
  },
  "herta": {
    "plugin": {
      "id": "<name>",
      "category": "utility"
    }
  }
}
```

### Plugin 実装の標準パターン:

```typescript
// plugins/<name>/src/plugin.ts
import { BasePlugin, PluginContext } from '@herta/plugin-sdk';
import type { PluginManifest } from '@herta/shared';

export class MyPlugin extends BasePlugin {
  readonly manifest: PluginManifest = {
    id: 'my-plugin',
    name: 'My Plugin',
    version: '1.0.0',
    description: 'プラグインの説明',
    author: { name: 'Herta' },
    category: 'utility',
    permissions: [],
    dependencies: [],
    configSchema: {},
    events: [],
    commands: [],
  };

  private ctx!: PluginContext;

  async onLoad(context: PluginContext): Promise<void> {
    this.ctx = context;
    // イベント登録、コマンド登録、Trigger/Condition/Action 登録
  }

  async onEnable(guildId: string, config: unknown): Promise<void> {
    // Guild 有効化時の初期化
  }

  async onDisable(guildId: string): Promise<void> {
    // Guild 無効化時のクリーンアップ
  }

  async onUnload(): Promise<void> {
    // Plugin アンロード時のクリーンアップ
  }
}
```

### Plugin ごとの API エンドポイント登録:

```typescript
// apps/api/src/plugin/<plugin-id>/<plugin-id>.module.ts
// Plugin が独自の NestJS Module を持ち、API に登録される
// パス: /api/v1/guilds/:guildId/<plugin-route>/...
```

---

## ⑱ 推奨命名規則

### コードベース全般

| 対象 | 規則 | 例 |
|---|---|---|
| ファイル名 | kebab-case | `auto-response.service.ts` |
| ディレクトリ名 | kebab-case | `plugin-sdk/`, `rule-engine/` |
| クラス名 | PascalCase | `AutoResponsePlugin`, `RuleEvaluator` |
| インタフェース名 | PascalCase (I プレフィックスなし) | `PluginContext`, `RuleDefinition` |
| 型名 | PascalCase | `TriggerType`, `ActionResult` |
| 関数名 | camelCase | `evaluateRule()`, `handleMessage()` |
| 変数名 | camelCase | `guildId`, `pluginConfig` |
| 定数 | UPPER_SNAKE_CASE | `MAX_PLUGINS_PER_GUILD`, `DEFAULT_COOLDOWN_MS` |
| Enum 値 | UPPER_SNAKE_CASE | `Permission.GUILD_MANAGE` |
| DB テーブル名 | snake_case (複数形) | `guilds`, `guild_plugins`, `audit_logs` |
| DB カラム名 | snake_case | `guild_id`, `created_at`, `config_version` |
| API パス | kebab-case | `/api/v1/guilds/:guildId/auto-responses` |
| npm パッケージ名 | @herta/<kebab-case> | `@herta/plugin-sdk`, `@herta/rule-engine` |
| Plugin ID | kebab-case | `auto-response`, `team-split` |
| Docker サービス名 | kebab-case | `herta-api`, `herta-bot` |
| 環境変数 | UPPER_SNAKE_CASE | `DATABASE_URL`, `DISCORD_BOT_TOKEN` |

### Git

| 対象 | 規則 | 例 |
|---|---|---|
| ブランチ名 | `<type>/<短い説明>` | `feat/plugin-auto-response`, `fix/rule-engine-cooldown` |
| コミットメッセージ | Conventional Commits (日本語OK) | `feat(plugin): Auto Response プラグイン追加` |
| type | feat, fix, chore, docs, ci, refactor, test, perf | |
| scope | plugin, bot, api, studio, db, rule-engine, sdk | |

### ドキュメント・コメント

| 対象 | 言語 |
|---|---|
| ソースコードコメント | 日本語 |
| README.md | 日本語 |
| 設計書 (docs/) | 日本語 |
| API レスポンスメッセージ | 日本語 |
| コミットメッセージ body | 日本語 |
| コミットメッセージ type/scope | 英語 |
| 変数名・関数名・クラス名 | 英語 |

---

## ⑲ 開発ロードマップ

### Phase 0: 設計確定 + セットアップ (1週間)

| タスク | 成果物 |
|---|---|
| アーキテクチャレビュー反映 | 最終設計書 |
| Monorepo セットアップ | turbo.json, pnpm-workspace.yaml, tsconfig.base.json |
| CI パイプライン | .github/workflows/ci.yml (lint + typecheck + test + build) |
| Docker Compose (開発環境) | docker-compose.yml (PostgreSQL + Redis) |
| ESLint + Prettier 設定 | packages/config/ |
| Prisma 初期スキーマ | packages/db/prisma/schema.prisma (Core テーブルのみ) |
| 環境変数テンプレート | .env.example |

### Phase 1: Core 基盤 (3週間)

| 週 | タスク | 成果物 |
|---|---|---|
| Week 1 | Discord OAuth + JWT 認証 | apps/api/src/core/auth/ |
| Week 1 | User + Guild API | apps/api/src/core/user/, guild/ |
| Week 2 | RBAC 実装 | apps/api/src/core/rbac/ |
| Week 2 | Audit Log | apps/api/src/core/audit/ |
| Week 3 | Plugin Registry + Lifecycle | apps/api/src/plugin/, packages/plugin-sdk/ |
| Week 3 | Plugin SDK (BasePlugin, PluginContext, EventBus) | packages/plugin-sdk/ |

### Phase 2: Rule Engine + Bot (2週間)

| 週 | タスク | 成果物 |
|---|---|---|
| Week 4 | Rule Engine コア (Evaluator, Trigger/Condition/Action Registry) | packages/rule-engine/ |
| Week 4 | Rule CRUD API | apps/api/src/rule-engine/ |
| Week 5 | Bot 基盤 (Gateway 接続, Event Handler, Plugin Loader) | apps/bot/ |
| Week 5 | Bot ↔ API 通信 (Internal API Client) | packages/api-client/ |

### Phase 3: MVP Plugin (3週間)

| 週 | タスク | 成果物 |
|---|---|---|
| Week 6 | Auto Response Plugin (Bot + API + テスト) | plugins/auto-response/ |
| Week 7 | Moderation Plugin (NGワード, スパム, 招待リンク) | plugins/moderation/ |
| Week 8 | Quote Plugin (Slash Command + API) | plugins/quote/ |

### Phase 4: Dashboard (Herta Studio) (3週間)

| 週 | タスク | 成果物 |
|---|---|---|
| Week 9 | ログイン + Guild 選択 + レイアウト | apps/studio/ |
| Week 10 | Plugin 管理 UI + 設定フォーム | apps/studio/src/app/(dashboard)/ |
| Week 11 | Rule Builder UI (WHEN/IF/THEN) | apps/studio/src/components/rules/ |

### Phase 5: 本番準備 (2週間)

| 週 | タスク | 成果物 |
|---|---|---|
| Week 12 | Docker 本番ビルド + Lightsail デプロイ | deploy/, docker-compose.prod.yml |
| Week 12 | SSL + nginx + ヘルスチェック | deploy/docker/nginx/ |
| Week 13 | テスト充実 + バグ修正 + パフォーマンス最適化 | |
| Week 13 | 運用ドキュメント (デプロイ手順, バックアップ, 監視) | docs/operations/ |

### Phase 6: 追加 Plugin + 安定化 (2週間)

| 週 | タスク | 成果物 |
|---|---|---|
| Week 14 | LFG Plugin | plugins/lfg/ |
| Week 14 | Team Split Plugin | plugins/team-split/ |
| Week 15 | Daily Content Plugin | plugins/daily-content/ |
| Week 15 | Worker ジョブ (スケジュール実行, クリーンアップ) | apps/worker/ |

**合計: 約 16 週間 (4ヶ月)**

### Post-MVP ロードマップ

| Version | 期間 | 主な機能 |
|---|---|---|
| v0.2 | +4週 | Audit Log UI, Config Rollback, Bot シャーディング |
| v0.3 | +4週 | Member Portal, Analytics 基盤, E2E テスト |
| v1.0 | +4週 | 安定版リリース, SLA 定義, 監視・アラート完備 |
| v1.5 | +8週 | Plugin Marketplace (公式), Game API 統合 |
| v2.0 | +12週 | AI Assistant, Visual Workflow Builder |

---

## ⑳ 長期運営で改善すべき点

### 1. lunaria からの技術的負債の解消

| 負債 | lunaria の現状 | Herta. での改善 |
|---|---|---|
| Guild モデル肥大化 | 全 Plugin リレーションが Guild に定義 | Core リレーションのみに限定 |
| テストカバレッジ | 一部の Service のみ | 全 Plugin に Unit テスト必須化 |
| エラーハンドリング | 統一されていない | 共通の ErrorFilter + エラーコード |
| ログフォーマット | 各 app で個別 | `@herta/logger` で統一 |
| Bot ↔ API 通信 | Internal API Key のみ | 署名付き JWT + mTLS 検討 |
| 型安全性 | `config: Json` が多い | Zod schema から Prisma 型を生成 |

### 2. 運用面での改善

| 項目 | 提言 |
|---|---|
| **デプロイ** | GitHub Actions → Docker Build → SSH Pull の一本化。Blue-Green デプロイメント検討 |
| **監視** | Sentry (エラー) + Prometheus/Grafana (メトリクス) + UptimeRobot (ヘルスチェック) の 3本柱 |
| **バックアップ** | pg_dump → S3 日次。Redis RDB 1時間ごと。Config History テーブルで設定の自動バージョニング |
| **セキュリティ** | 依存パッケージの自動更新 (Renovate/Dependabot)。定期的なセキュリティ監査 |
| **ドキュメント** | Plugin 開発ガイド、API リファレンス、運用 Runbook の整備 |
| **コミュニティ** | Plugin SDK の npm 公開、開発者ドキュメント、サンプル Plugin |

### 3. アーキテクチャの進化パス

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

**注意:** マイクロサービス化は「必要になってから」行うべき。premature optimization を避ける。1000 Guild 未満なら Monolith + シャーディングで十分。

### 4. チーム・プロセスの改善

| 項目 | 提言 |
|---|---|
| **コードレビュー** | PR 必須、自動 lint チェック、テストカバレッジ閾値 |
| **リリースプロセス** | Semantic Versioning、CHANGELOG 自動生成、Release Notes |
| **インシデント対応** | Runbook 整備、Discord Webhook でアラート通知、PagerDuty 検討 |
| **技術的意思決定** | ADR (Architecture Decision Records) で記録 |

---

## 総合評価

### 強み
- **Plugin 基盤の設計思想**: 機能ではなく拡張基盤を優先する方針は正しい
- **lunaria での実証**: 既に Bot + API + Dashboard + Plugin SDK + Rule Engine が動作しており、設計の妥当性が検証済み
- **技術選定**: TypeScript + discord.js + NestJS + Next.js + Prisma + Redis は Discord Bot プラットフォームとして適切
- **Monorepo**: pnpm + Turborepo の選択は正しい

### リスク
- **スコープの拡大**: 「Discord Community Operating System」は壮大なビジョンだが、MVP のスコープを厳密に守らないと完成しない
- **Plugin SDK の安定性**: SDK のインタフェースを固めてから Plugin 開発に入る必要がある。後から変更すると全 Plugin の書き換え
- **セキュリティ**: Rule Engine の外部通信、テンプレートインジェクション、Plugin のリソース制限は早期に対策が必要
- **単一障害点**: 全サービスが 1 台の Lightsail インスタンス上にある。DB 障害 = 全サービス停止

### 最重要アクション (Top 5)

1. **Plugin 間通信 (EventBus) を Plugin SDK に追加する** — 後から入れると全 Plugin の書き換え
2. **Guild モデルから Plugin リレーションを除去する** — スケーラビリティの根幹
3. **API Versioning (`/api/v1/...`) を最初から導入する** — 後方互換性の基盤
4. **Rule JSON Schema にバージョンフィールドを追加する** — 既存ルールの互換性
5. **PluginContext をバージョニング可能にする** — SDK の後方互換性

---

*以上、Herta. Architecture Review を完了します。*
*コードの実装は本レビューの確認後に開始してください。*
