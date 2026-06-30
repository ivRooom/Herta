# Herta. — 開発ガイド

> Version: 0.1.0
> 最終更新: 2026-06-30

---

## 1. 必要な環境

| ツール | バージョン | 用途 |
|---|---|---|
| Node.js | 22+ | ランタイム |
| pnpm | 9+ | パッケージマネージャー |
| Docker | 24+ | インフラ (PostgreSQL, Redis) |
| Docker Compose | v2+ | ローカル環境の起動 |
| Git | 2.40+ | バージョン管理 |

---

## 2. 初回セットアップ

```bash
# 1. リポジトリをクローン
git clone https://github.com/ivRooom/Herta.git
cd herta

# 2. 依存パッケージをインストール
pnpm install

# 3. インフラ起動 (PostgreSQL + Redis)
docker compose up -d

# 4. 環境変数を設定
cp .env.example .env
# .env を編集: DISCORD_BOT_TOKEN, DATABASE_URL, REDIS_URL を設定

# 5. Prisma クライアント生成
pnpm db:generate

# 6. データベースマイグレーション
pnpm db:migrate

# 7. 全サービスを開発モードで起動
pnpm dev
```

---

## 3. 開発コマンド

### 3.1 基本コマンド

| コマンド | 説明 |
|---|---|
| `pnpm install` | 依存パッケージインストール |
| `pnpm dev` | 全サービスを開発モードで起動 (Turborepo) |
| `pnpm build` | 全サービスをビルド |
| `pnpm lint` | ESLint 実行 |
| `pnpm lint:fix` | ESLint 自動修正 |
| `pnpm typecheck` | TypeScript 型チェック |
| `pnpm test` | 全テスト実行 |
| `pnpm test:unit` | ユニットテストのみ |
| `pnpm format` | Prettier でフォーマット |
| `pnpm format:check` | フォーマットチェック |
| `pnpm clean` | ビルド成果物と node_modules を削除 |

### 3.2 データベースコマンド

| コマンド | 説明 |
|---|---|
| `pnpm db:generate` | Prisma Client 生成 |
| `pnpm db:migrate` | マイグレーション作成 + 適用 (開発) |
| `pnpm db:push` | スキーマを DB に直接反映 (プロトタイピング用) |

### 3.3 個別サービスの起動

```bash
# Bot のみ起動
pnpm --filter @herta/bot dev

# API のみ起動
pnpm --filter @herta/api dev

# Dashboard (Studio) のみ起動
pnpm --filter @herta/studio dev

# Worker のみ起動
pnpm --filter @herta/worker dev
```

---

## 4. 環境変数

### 4.1 .env.example

```env
# Discord
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
DISCORD_BOT_TOKEN=
DISCORD_CALLBACK_URL=http://localhost:3001/api/v1/auth/discord/callback

# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/herta

# Redis
REDIS_URL=redis://localhost:6379

# JWT
JWT_SECRET=dev-jwt-secret-change-in-production
JWT_REFRESH_SECRET=dev-jwt-refresh-secret-change-in-production
JWT_EXPIRATION=15m
JWT_REFRESH_EXPIRATION=7d

# API
API_PORT=3001
API_URL=http://localhost:3001
CORS_ORIGINS=http://localhost:3000

# Internal (Bot ↔ API)
INTERNAL_JWT_SECRET=dev-internal-secret-change-in-production
```

### 4.2 本番環境

本番用のシークレットは `openssl rand -base64 32` で生成する。`.env.production.example` を参照。

---

## 5. プロジェクト構造

```
herta/
├── apps/
│   ├── api/           # NestJS REST API (ポート 3001)
│   ├── bot/           # discord.js Bot
│   ├── worker/        # BullMQ Worker
│   └── studio/        # Next.js Dashboard (ポート 3000)
│
├── packages/
│   ├── db/            # Prisma schema + migrations
│   ├── plugin-sdk/    # Plugin SDK
│   ├── rule-engine/   # Rule Engine
│   ├── shared/        # 共通型・ユーティリティ
│   ├── logger/        # 構造化ログ
│   ├── queue/         # BullMQ ジョブ定義
│   ├── ui/            # 共通 UI コンポーネント
│   └── config/        # ESLint/TS/Tailwind 設定
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
└── docs/              # 設計書
```

### 5.1 依存関係

```
apps/api     → packages/db, shared, logger, plugin-sdk, rule-engine, queue
apps/bot     → packages/db, shared, logger, plugin-sdk, rule-engine, queue
apps/worker  → packages/db, shared, logger, queue
apps/studio  → packages/shared, ui, config

plugins/*    → packages/plugin-sdk, shared
```

---

## 6. Plugin の開発手順

### 6.1 新しい Plugin を作成する

```bash
# 1. Plugin ディレクトリを作成
mkdir -p plugins/my-plugin/src

# 2. package.json を作成
cat > plugins/my-plugin/package.json << 'EOF'
{
  "name": "@herta/plugin-my-plugin",
  "version": "1.0.0",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "lint": "eslint src/",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@herta/plugin-sdk": "workspace:*",
    "@herta/shared": "workspace:*"
  }
}
EOF

# 3. tsconfig.json を作成
cat > plugins/my-plugin/tsconfig.json << 'EOF'
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
EOF

# 4. pnpm-workspace.yaml に追加 (既に plugins/* が含まれていれば不要)

# 5. 依存をインストール
pnpm install
```

### 6.2 Plugin のコードを書く

```typescript
// plugins/my-plugin/src/plugin.ts
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
    this.ctx.logger.info('MyPlugin をロードしました');
  }

  async onEnable(guildId: string, config: unknown): Promise<void> {
    this.ctx.logger.info({ guildId }, 'MyPlugin を有効化');
  }

  async onDisable(guildId: string): Promise<void> {
    this.ctx.logger.info({ guildId }, 'MyPlugin を無効化');
  }

  async onUnload(): Promise<void> {
    this.ctx.logger.info('MyPlugin をアンロード');
  }
}
```

```typescript
// plugins/my-plugin/src/index.ts
export { MyPlugin } from './plugin.js';
export { MyPlugin as default } from './plugin.js';
```

### 6.3 Plugin のテストを書く

```typescript
// plugins/my-plugin/src/my-logic.test.ts
import { describe, it, expect } from 'vitest';
import { MyLogic } from './my-logic.js';

describe('MyLogic', () => {
  it('期待通りに動作すること', () => {
    const result = MyLogic.process('input');
    expect(result).toBe('expected');
  });
});
```

### 6.4 Plugin 固有の DB テーブルを追加する

```bash
# 1. packages/db/prisma/schema.prisma にモデルを追加
# 2. マイグレーション作成
pnpm db:migrate
# 3. Prisma Client 再生成
pnpm db:generate
```

### 6.5 Plugin 固有の API エンドポイントを追加する

```bash
# apps/api/src/my-plugin/ に NestJS Module を作成
mkdir -p apps/api/src/my-plugin
```

```typescript
// apps/api/src/my-plugin/my-plugin.module.ts
import { Module } from '@nestjs/common';
import { MyPluginController } from './my-plugin.controller.js';
import { MyPluginService } from './my-plugin.service.js';

@Module({
  controllers: [MyPluginController],
  providers: [MyPluginService],
})
export class MyPluginModule {}
```

```typescript
// apps/api/src/my-plugin/my-plugin.controller.ts
import { Controller, Get, Param } from '@nestjs/common';

@Controller('guilds/:guildId/my-plugin')
export class MyPluginController {
  @Get()
  async list(@Param('guildId') guildId: string) {
    // ...
  }
}
```

### 6.6 Plugin を Bot に登録する

```typescript
// apps/bot/src/plugin-loader/loader.ts に Plugin を追加
import { MyPlugin } from '@herta/plugin-my-plugin';

const plugins = [
  // 既存の Plugin
  new AutoResponsePlugin(),
  new ModerationPlugin(),
  // 新しい Plugin
  new MyPlugin(),
];
```

---

## 7. Docker 開発環境

### 7.1 docker-compose.yml (開発用)

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: herta
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data

volumes:
  postgres_data:
  redis_data:
```

### 7.2 インフラの起動/停止

```bash
# 起動
docker compose up -d

# 停止
docker compose down

# データも含めて削除
docker compose down -v
```

---

## 8. 本番デプロイ

### 8.1 構成

1台の AWS Lightsail インスタンス上に Docker Compose で全サービスをデプロイする。

### 8.2 デプロイ手順

```bash
# 1. Lightsail インスタンスに SSH
ssh ubuntu@<IP>

# 2. 初期セットアップ
bash deploy/scripts/setup.sh

# 3. .env を設定
cd /opt/herta
nano .env

# 4. 起動
bash deploy/scripts/start.sh

# 5. SSL 設定
bash deploy/scripts/ssl-setup.sh yourdomain.com admin@example.com

# 6. アップデート
bash deploy/scripts/update.sh
```

### 8.3 個別サービスのデプロイ

```bash
# Bot のみ
docker compose -f docker-compose.prod.yml build bot
docker compose -f docker-compose.prod.yml up -d bot

# API のみ
docker compose -f docker-compose.prod.yml build api
docker compose -f docker-compose.prod.yml up -d api
docker compose -f docker-compose.prod.yml restart nginx
```

---

## 9. トラブルシューティング

### 9.1 よくある問題

| 問題 | 原因 | 解決方法 |
|---|---|---|
| `pnpm install` が失敗 | Node.js バージョン不一致 | `node -v` で 22+ を確認 |
| DB 接続エラー | Docker が起動していない | `docker compose up -d` |
| Prisma エラー | クライアント未生成 | `pnpm db:generate` |
| Bot がログインできない | トークン未設定 | `.env` の `DISCORD_BOT_TOKEN` を確認 |
| ポート競合 | 他のプロセスがポートを使用中 | `lsof -i :3000` で確認 |
| 本番で 502 | nginx のキャッシュ | `docker compose restart nginx` |

### 9.2 ログの確認

```bash
# 開発環境: ターミナルに直接出力

# 本番環境:
docker compose -f docker-compose.prod.yml logs api
docker compose -f docker-compose.prod.yml logs bot
docker compose -f docker-compose.prod.yml logs worker
docker compose -f docker-compose.prod.yml logs -f  # リアルタイム
```

### 9.3 DB の直接確認

```bash
# 開発環境
docker compose exec postgres psql -U postgres -d herta

# Prisma Studio (GUI)
pnpm --filter @herta/db studio
```
