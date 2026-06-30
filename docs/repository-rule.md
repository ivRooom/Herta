# Herta. — リポジトリ運用規約

> Version: 0.1.0
> 最終更新: 2026-06-30

---

## 1. ブランチ戦略

### 1.1 ブランチ構成

| ブランチ | 用途 | 保護 |
|---|---|---|
| `main` | 本番リリース用。常にデプロイ可能な状態 | 直接 push 禁止、PR 必須 |
| `develop` | 開発統合ブランチ。次リリースの統合先 | 直接 push 禁止、PR 必須 |
| `feat/*` | 新機能開発 | なし |
| `fix/*` | バグ修正 | なし |
| `chore/*` | 設定変更、依存更新、リファクタリング | なし |
| `docs/*` | ドキュメント変更 | なし |
| `hotfix/*` | 本番の緊急修正 (`main` から分岐) | なし |

### 1.2 ブランチ命名規則

```
<type>/<簡潔な説明>

例:
  feat/plugin-auto-response
  fix/rule-engine-cooldown
  chore/update-dependencies
  docs/architecture-review
  hotfix/oauth-token-leak
```

### 1.3 ブランチフロー

```
main ─────────────────────────────────────────────→ (本番)
  │                                         ↑
  │                                    PR (merge)
  │                                         │
  └──→ develop ───────────────────────────────→
         │              ↑         ↑
         │         PR (merge) PR (merge)
         │              │         │
         ├──→ feat/xxx ─┘         │
         └──→ fix/yyy ────────────┘
```

**hotfix の場合:**
```
main ──→ hotfix/xxx ──→ (PR → main に merge) ──→ develop にも merge
```

---

## 2. コミット規約

### 2.1 Conventional Commits

```
<type>(<scope>): <subject>

<body>

<footer>
```

### 2.2 type

| type | 用途 |
|---|---|
| `feat` | 新機能 |
| `fix` | バグ修正 |
| `chore` | ビルド、設定、依存更新 |
| `docs` | ドキュメント |
| `ci` | CI/CD |
| `refactor` | リファクタリング (機能変更なし) |
| `test` | テスト追加・修正 |
| `perf` | パフォーマンス改善 |
| `style` | フォーマット (機能変更なし) |

### 2.3 scope

| scope | 対象 |
|---|---|
| `plugin` | Plugin 実装 |
| `sdk` | Plugin SDK |
| `bot` | Bot |
| `api` | API |
| `studio` | Dashboard |
| `db` | Database |
| `rule-engine` | Rule Engine |
| `worker` | Worker |
| `ci` | CI/CD |
| `deploy` | デプロイ |

### 2.4 例

```
feat(plugin): Auto Response プラグイン追加

キーワード・正規表現に基づく自動応答プラグインを実装。
Plugin SDK / Rule Engine / Bot / API / Dashboard を縦に貫通する最初の Plugin。

- matcher.ts: 完全一致 / 部分一致 / 正規表現マッチング
- cooldown.ts: Redis ベースのクールダウン管理
- plugin.ts: BasePlugin 実装
```

```
fix(rule-engine): Condition ツリーの NOT 評価を修正

NOT の子が空の場合に true を返すように修正。
以前は undefined が返り、後続の AND 評価で誤判定していた。
```

### 2.5 禁止事項

- `git commit --no-verify` (フック無視) は禁止
- `git commit --amend` は禁止 (新しいコミットを追加する)
- `git push --force` は `main` / `develop` に対して禁止
- `git push --force-with-lease` は自分のフィーチャーブランチでのみ許可

---

## 3. Pull Request 規約

### 3.1 PR の作成

- PR は必ず `develop` ブランチに向けて作成する (`hotfix` のみ `main` 向け)
- 1 PR = 1 機能 / 1 修正 (大きなタスクは複数 PR に分割)
- Draft PR を積極的に活用する (レビュー前の WIP 共有)

### 3.2 PR テンプレート

```markdown
## 概要

<!-- 変更の要約。何を変更し、なぜ変更したか -->

## 変更内容

<!-- 主な変更点をリストアップ -->
-
-

## テスト

<!-- テストの実施内容 -->
- [ ] ユニットテスト追加/更新
- [ ] 手動テスト実施
- [ ] lint / typecheck パス

## スクリーンショット (UI 変更がある場合)

<!-- Dashboard の変更がある場合はスクリーンショットを添付 -->

## 関連 Issue

<!-- 関連する Issue 番号 -->
```

### 3.3 レビュー

- 全 PR はレビューを受けてからマージする
- 自動チェック (lint, typecheck, test, build) が全てパスしていること
- レビュアーは 48 時間以内にレビューを完了する

### 3.4 マージ

- **Squash Merge** を使用する (コミット履歴を 1 つにまとめる)
- マージ後、フィーチャーブランチは削除する

---

## 4. CI/CD

### 4.1 CI パイプライン

```yaml
# .github/workflows/ci.yml
# PR / push 時に実行

jobs:
  lint:        # ESLint + Prettier チェック
  typecheck:   # tsc --noEmit (全パッケージ)
  test-unit:   # vitest run (ユニットテスト)
  build:       # turbo build (全アプリ)
```

### 4.2 CD パイプライン

```yaml
# .github/workflows/deploy.yml
# main ブランチへのマージ時に実行

jobs:
  build:       # Docker イメージビルド
  deploy:      # Lightsail へデプロイ (SSH → docker-compose pull && up -d)
```

### 4.3 CI が通らないとマージできない

以下の全てがパスすること:
- `pnpm lint` (ESLint)
- `pnpm format:check` (Prettier)
- `pnpm typecheck` (TypeScript)
- `pnpm test:unit` (Vitest)
- `pnpm build` (Turborepo ビルド)

---

## 5. Issue 管理

### 5.1 Issue テンプレート

- **Bug Report**: バグ報告 (再現手順、期待する動作、実際の動作)
- **Feature Request**: 機能要望 (ユースケース、提案する実装)
- **Plugin Request**: Plugin の提案

### 5.2 ラベル

| ラベル | 意味 |
|---|---|
| `bug` | バグ |
| `feature` | 新機能 |
| `plugin` | Plugin 関連 |
| `enhancement` | 改善 |
| `documentation` | ドキュメント |
| `good first issue` | 初心者向け |
| `priority:high` | 高優先度 |
| `priority:medium` | 中優先度 |
| `priority:low` | 低優先度 |

---

## 6. リリース管理

### 6.1 バージョニング

Semantic Versioning (semver) に従う: `MAJOR.MINOR.PATCH`

| 変更 | バージョンアップ | 例 |
|---|---|---|
| 後方互換性のない変更 | MAJOR | 0.x → 1.0 |
| 新機能追加 (後方互換) | MINOR | 0.1 → 0.2 |
| バグ修正 | PATCH | 0.1.0 → 0.1.1 |

### 6.2 リリースフロー

1. `develop` ブランチの変更を確認
2. CHANGELOG.md を更新
3. `develop` → `main` の PR を作成
4. レビュー + CI パス確認
5. マージ → 自動デプロイ
6. GitHub Release 作成 (タグ: `v0.1.0`)

### 6.3 CHANGELOG

```markdown
# Changelog

## [0.2.0] - 2026-xx-xx

### 追加
- Moderation Plugin
- Quote Plugin

### 修正
- Rule Engine のクールダウン判定の不具合

### 変更
- Plugin SDK: EventBus インタフェース追加
```

---

## 7. ファイル管理

### 7.1 .gitignore

```
node_modules/
dist/
.next/
.turbo/
*.tsbuildinfo
.env
.env.local
.env.production
coverage/
```

### 7.2 コミットしてはいけないファイル

- `.env` (シークレット)
- `credentials.json`
- `*.pem` / `*.key` (秘密鍵)
- `node_modules/`
- ビルド成果物 (`dist/`, `.next/`)

### 7.3 コミットすべきファイル

- `.env.example` (シークレットの値は空)
- `pnpm-lock.yaml` (依存の固定)
- `docker-compose.yml`
- 設計書・ドキュメント (`docs/`)
