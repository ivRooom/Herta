# ============================================================
# Herta. — 本番用 Docker イメージ (モノレポ共通)
# ------------------------------------------------------------
# 1 つのイメージに全ワークスペースの依存関係とビルド成果物を含め、
# docker-compose.prod.yml から各サービス (api / bot / worker / studio /
# migrator) が command を切り替えて起動します。
# 単一ホスト (AWS Lightsail) での運用を想定した構成です。
# ============================================================
FROM node:22-alpine

# Prisma / curl (health check) / bash の実行に必要なパッケージ
RUN apk add --no-cache libc6-compat openssl curl bash

# pnpm を corepack 経由で有効化
RUN corepack enable

WORKDIR /app

# ワークスペース全体をコピー (.dockerignore で node_modules 等は除外)
COPY . .

# 依存インストール → Prisma Client 生成 → API / Studio をビルド
#   - bot / worker は tsx で TS を直接実行するためビルド不要
RUN pnpm install --frozen-lockfile \
  && pnpm --filter @herta/db exec prisma generate \
  && pnpm --filter @herta/api build \
  && pnpm --filter @herta/studio build \
  && cp -r apps/studio/.next/static apps/studio/.next/standalone/apps/studio/.next/static

# api=3001 / studio=3000
EXPOSE 3000 3001

# デフォルトは API を起動 (各サービスの command は compose 側で上書き)
CMD ["node", "apps/api/dist/main.js"]
