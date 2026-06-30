# Herta. — 開発ロードマップ

> Version: 0.1.0
> 最終更新: 2026-06-30

---

## 1. 全体スケジュール

```
Phase 0  ┃ 設計確定 + セットアップ         ┃ 1 週間
Phase 1  ┃ Core 基盤                       ┃ 3 週間
Phase 2  ┃ Rule Engine + Bot               ┃ 2 週間
Phase 3  ┃ MVP Plugin                      ┃ 3 週間
Phase 4  ┃ Dashboard (Herta Studio)        ┃ 3 週間
Phase 5  ┃ 本番準備                        ┃ 2 週間
Phase 6  ┃ 追加 Plugin + 安定化            ┃ 2 週間
─────────┃─────────────────────────────────┃──────────
合計     ┃                                 ┃ 16 週間 (約 4 ヶ月)
```

---

## 2. Phase 0: 設計確定 + セットアップ (Week 0)

| タスク | 成果物 |
|---|---|
| アーキテクチャレビュー反映 | 最終設計書 (docs/) |
| Monorepo セットアップ | turbo.json, pnpm-workspace.yaml, tsconfig.base.json |
| CI パイプライン | .github/workflows/ci.yml |
| Docker Compose (開発環境) | docker-compose.yml (PostgreSQL + Redis) |
| ESLint + Prettier 設定 | packages/config/ |
| Prisma 初期スキーマ | packages/db/prisma/schema.prisma (Core テーブル) |
| 環境変数テンプレート | .env.example |
| 共通パッケージ初期化 | packages/shared/, logger/, queue/ |

**完了条件:**
- `pnpm install && pnpm build` が通る
- `docker compose up -d` で PostgreSQL + Redis が起動する
- `pnpm db:generate && pnpm db:migrate` が通る
- CI (lint + typecheck + build) が GitHub Actions で動作する

---

## 3. Phase 1: Core 基盤 (Week 1-3)

### Week 1: 認証 + Guild/User API

| タスク | 成果物 |
|---|---|
| Discord OAuth2 認証フロー | apps/api/src/core/auth/ |
| JWT (access + refresh) 発行・検証 | strategies/jwt.strategy.ts |
| User CRUD API | apps/api/src/core/user/ |
| Guild CRUD API | apps/api/src/core/guild/ |
| GuildScopeGuard | 全 API に Guild スコープを強制 |
| Health Check | apps/api/src/health/ |

### Week 2: RBAC + Audit Log

| タスク | 成果物 |
|---|---|
| Role CRUD API | apps/api/src/core/rbac/ |
| UserRole 割り当て | role.controller.ts |
| RequiresPermission デコレータ | decorators/requires-permission.decorator.ts |
| RbacGuard | guards/rbac.guard.ts |
| Audit Log 記録 | apps/api/src/core/audit/ |
| Audit Log 検索 API | audit.controller.ts |

### Week 3: Plugin System

| タスク | 成果物 |
|---|---|
| Plugin SDK (BasePlugin, PluginContext) | packages/plugin-sdk/ |
| EventBus 実装 | packages/plugin-sdk/src/context/ |
| Plugin Registry API | apps/api/src/plugin/ |
| Plugin Config 管理 | plugin-config.service.ts |
| Config Versioning + Rollback | guild_plugin_config_history |
| Plugin Lifecycle 管理 | plugin-lifecycle.service.ts |

**Phase 1 完了条件:**
- Discord OAuth でログインし、JWT を取得できる
- Guild 一覧・詳細の取得ができる
- Role の作成・割り当てができる
- Audit Log が記録・検索できる
- Plugin の登録・有効化・無効化・設定変更ができる
- Plugin Config のロールバックができる

---

## 4. Phase 2: Rule Engine + Bot (Week 4-5)

### Week 4: Rule Engine

| タスク | 成果物 |
|---|---|
| Rule Engine コア (Evaluator) | packages/rule-engine/src/evaluator.ts |
| TriggerRegistry | trigger-registry.ts |
| ConditionRegistry (ツリー評価) | condition-registry.ts |
| ActionRegistry | action-registry.ts |
| テンプレート変数解決 | template.ts (handlebars ベース) |
| Rule CRUD API | apps/api/src/rule-engine/ |
| Rule テスト実行 API | POST /rules/:ruleId/test |
| 組み込み Trigger/Condition/Action | 基本セット |

### Week 5: Bot 基盤

| タスク | 成果物 |
|---|---|
| discord.js Gateway 接続 | apps/bot/src/bot.ts |
| Event Handler | apps/bot/src/events/event-handler.ts |
| Plugin Loader | apps/bot/src/plugin-loader/loader.ts |
| PluginContext 実装 (Bot 側) | PluginContext の具体実装 |
| Rule Bridge (Bot → Rule Engine) | apps/bot/src/rule-bridge/ |
| Slash Command ハンドラ | apps/bot/src/commands/ |
| deploy-commands スクリプト | apps/bot/src/scripts/deploy-commands.ts |
| Bot ↔ API 通信 (署名付き JWT) | サービス間認証 |

**Phase 2 完了条件:**
- Bot が Discord に接続し、イベントを受信できる
- Rule Engine が Trigger → Condition → Action を評価・実行できる
- Slash Command (`/herta ping`) が動作する
- Bot が API と署名付き JWT で通信できる

---

## 5. Phase 3: MVP Plugin (Week 6-8)

### Week 6: Auto Response Plugin

| タスク | 成果物 |
|---|---|
| Plugin 実装 (BasePlugin) | plugins/auto-response/src/plugin.ts |
| マッチャー (完全一致/部分一致/正規表現) | matcher.ts |
| クールダウン管理 (Redis) | cooldown.ts |
| API エンドポイント | apps/api/src/auto-response/ |
| ユニットテスト | matcher.test.ts, cooldown.test.ts |

### Week 7: Moderation Plugin

| タスク | 成果物 |
|---|---|
| Plugin 実装 | plugins/moderation/src/plugin.ts |
| NGワードフィルター | word-filter.ts |
| スパム検知 | spam-detector.ts |
| 招待リンク検知 | invite-detector.ts |
| Moderation API | apps/api/src/moderation/ |
| ユニットテスト | word-filter.test.ts, spam-detector.test.ts |

### Week 8: Quote Plugin

| タスク | 成果物 |
|---|---|
| Plugin 実装 | plugins/quote/src/plugin.ts |
| Slash Command (/quote add, random, list, show) | quote-command.ts |
| Context Menu (右クリック → Add Quote) | |
| Embed フォーマッター | embed-formatter.ts |
| NSFW フィルター | |
| Quote API | apps/api/src/quote/ |
| ユニットテスト | embed-formatter.test.ts |

**Phase 3 完了条件:**
- Auto Response: キーワード → 自動応答が動作する
- Moderation: NGワード → メッセージ削除が動作する
- Quote: `/quote add` → 名言登録が動作する
- 全 Plugin の API が Dashboard から操作可能
- 全 Plugin のユニットテストがパスする

---

## 6. Phase 4: Dashboard — Herta Studio (Week 9-11)

### Week 9: 認証 + レイアウト

| タスク | 成果物 |
|---|---|
| Next.js プロジェクトセットアップ | apps/studio/ |
| Discord OAuth ログイン | src/app/(auth)/ |
| Guild 選択画面 | src/app/(dashboard)/select-guild/ |
| Dashboard レイアウト (Sidebar + Header) | src/components/layout/ |
| Guild 概要ページ | src/app/(dashboard)/[guildId]/page.tsx |
| API クライアント (TanStack Query) | src/lib/api-client.ts |

### Week 10: Plugin 管理

| タスク | 成果物 |
|---|---|
| Plugin 一覧 (カード UI) | src/app/(dashboard)/[guildId]/plugins/ |
| Plugin 設定フォーム (JSON Schema → フォーム) | src/components/plugins/ |
| Auto Response 管理画面 | CRUD UI |
| Moderation 設定画面 | NGワード管理、スパム設定 |
| Quote 管理画面 | 一覧、検索、タグ管理 |
| Audit Log 閲覧 | src/app/(dashboard)/[guildId]/audit-log/ |

### Week 11: Rule Builder

| タスク | 成果物 |
|---|---|
| Visual Rule Builder (WHEN/IF/THEN) | src/components/rules/ |
| Trigger セレクター | trigger-select.tsx |
| Condition エディター (ツリー) | condition-editor.tsx |
| Action エディター | action-editor.tsx |
| Rule 一覧・詳細 | src/app/(dashboard)/[guildId]/rules/ |
| RBAC ロール管理画面 | src/app/(dashboard)/[guildId]/roles/ |

**Phase 4 完了条件:**
- Discord OAuth でログインし、Guild を選択できる
- Plugin の ON/OFF、設定変更ができる
- Auto Response / Moderation / Quote の管理ができる
- Visual Rule Builder でルールを作成・編集できる
- Audit Log を閲覧・検索できる

---

## 7. Phase 5: 本番準備 (Week 12-13)

### Week 12: インフラ

| タスク | 成果物 |
|---|---|
| Dockerfile (マルチステージビルド) | Dockerfile |
| docker-compose.prod.yml | 本番構成 |
| nginx 設定 (リバースプロキシ + SSL) | deploy/docker/nginx/ |
| デプロイスクリプト | deploy/scripts/ (setup, start, update, ssl-setup) |
| Lightsail セットアップ手順 | docs/operations/deploy-prod.md |

### Week 13: 品質 + 運用

| タスク | 成果物 |
|---|---|
| テスト充実 (カバレッジ向上) | |
| バグ修正 | |
| パフォーマンス最適化 | |
| バックアップ Runbook | docs/operations/backup-restore.md |
| 監視 Runbook | docs/operations/monitoring.md |
| セキュリティ確認 | Rate Limit, Input Validation, CORS |

**Phase 5 完了条件:**
- Docker Compose で本番環境が起動する
- SSL (Let's Encrypt) が設定される
- ヘルスチェック (`/api/v1/health`) が動作する
- バックアップが自動実行される
- 全テストがパスする

---

## 8. Phase 6: 追加 Plugin + 安定化 (Week 14-15)

### Week 14: LFG + Team Split

| タスク | 成果物 |
|---|---|
| LFG Plugin | plugins/lfg/ |
| Team Split Plugin | plugins/team-split/ |
| Slash Command 追加 | /lfg, /team |
| Dashboard 統合 | LFG / Team Split 管理画面 |

### Week 15: Daily Content + Worker

| タスク | 成果物 |
|---|---|
| Daily Content Plugin | plugins/daily-content/ |
| Worker ジョブ (スケジュール実行) | apps/worker/src/jobs/ |
| Worker ジョブ (クリーンアップ) | 古いログの削除 |
| 全体の安定化 + バグ修正 | |

**Phase 6 完了条件:**
- LFG: `/lfg create` → 募集 → 参加 → 終了 が動作する
- Team Split: `/team split` → チーム分け が動作する
- Daily Content: 指定時刻にメッセージが自動投稿される
- Worker が定期ジョブを実行する

---

## 9. Post-MVP ロードマップ

### v0.2.0 — 安定化 (+4 週間)

| 機能 | 説明 |
|---|---|
| Audit Log UI 改善 | フィルタ、エクスポート |
| Config Rollback UI | Dashboard から設定ロールバック |
| Bot シャーディング | 2500+ Guild 対応 |
| E2E テスト導入 | Playwright |
| CI/CD 改善 | 自動デプロイ、ステージング環境 |

### v0.3.0 — メンバーポータル (+4 週間)

| 機能 | 説明 |
|---|---|
| Member Portal | apps/member-web/ |
| プロフィール | メンバーのプロフィールページ |
| Quote 閲覧 | メンバー向け Quote ビューア |
| Leaderboard | ランキング表示 |
| Analytics 基盤 | データ収集 + 集計パイプライン |

### v1.0.0 — GA (General Availability) (+4 週間)

| 機能 | 説明 |
|---|---|
| 安定版リリース | 全機能の安定化 |
| SLA 定義 | 稼働率目標 |
| 監視・アラート完備 | Sentry + Grafana + Discord Webhook |
| ドキュメント整備 | Plugin 開発ガイド、API リファレンス |
| Economy Plugin | ポイント / 通貨システム |
| Analytics Plugin | Community Analytics Dashboard |

### v1.5.0 — Plugin Marketplace (+8 週間)

| 機能 | 説明 |
|---|---|
| Plugin Marketplace (公式) | 公式 Plugin のカタログ |
| Game API 連携 | VALORANT, 原神 |
| Minecraft 管理 | OCI 連携、サーバー管理 |
| FAQ Plugin | FAQ / RAG 統合 |
| Plugin SDK 公開 | npm パッケージとして公開 |

### v2.0.0 — プラットフォーム拡張 (+12 週間)

| 機能 | 説明 |
|---|---|
| AI Assistant | LLM 統合 |
| Visual Workflow Builder | IFTTT 的なノーコード自動化 UI |
| Plugin 開発エディタ | ブラウザ上での Plugin 開発 |
| Community Plugin Store | コミュニティ Plugin の公開 |
| Identity Platform | Discord + Microsoft + Web 統合認証 |
| Web Server Management | Web サービス管理 |

---

## 10. マイルストーン一覧

| マイルストーン | バージョン | 予定 | 主な成果 |
|---|---|---|---|
| MVP 完成 | v0.1.0 | Week 15 | Bot + API + Studio + 6 Plugin |
| 安定化 | v0.2.0 | Week 19 | シャーディング, E2E, CI/CD 改善 |
| メンバーポータル | v0.3.0 | Week 23 | Member Portal, Analytics 基盤 |
| GA | v1.0.0 | Week 27 | 安定版, SLA, 監視完備 |
| Marketplace | v1.5.0 | Week 35 | Plugin Store, Game 連携 |
| プラットフォーム | v2.0.0 | Week 47 | AI, Workflow Builder, Identity |

---

## 11. リスクと対策

| リスク | 影響 | 対策 |
|---|---|---|
| スコープ拡大 | スケジュール遅延 | MVP のスコープを厳守。追加要望は Post-MVP |
| Plugin SDK の設計変更 | 全 Plugin の書き換え | Phase 1 で SDK を十分にレビュー・テスト |
| Discord API の変更 | Bot の動作不全 | discord.js の更新に追従 |
| 単一障害点 (Lightsail) | 全サービス停止 | v1.0 でバックアップ + 復旧手順整備 |
| チームリソース不足 | スケジュール遅延 | Phase の優先度を明確にし、柔軟に調整 |
