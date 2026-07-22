# ============================================================
# Herta. — 本番用 Docker イメージ (モノレポ共通)
# ============================================================
FROM node:22-alpine AS builder

RUN apk add --no-cache libc6-compat openssl bash
RUN corepack enable
WORKDIR /app

COPY . .

# 全workspaceを事前ビルドし、本番でtsxによるTypeScript直接実行を行わない。
# Next.js standalone出力ではPrisma Query Engineが自動追跡されない場合があるため、
# Prismaが実際に検索するStudio配下の .prisma/client へ明示的にコピーする。
RUN pnpm install --frozen-lockfile \
  && pnpm --filter @herta/db exec prisma generate \
  && pnpm build \
  && PRISMA_SOURCE="$(find node_modules/.pnpm -path '*/node_modules/.prisma/client' -type d -print -quit)" \
  && PRISMA_DEST="apps/studio/.next/standalone/apps/studio/.prisma/client" \
  && test -n "${PRISMA_SOURCE}" \
  && test -f "${PRISMA_SOURCE}/libquery_engine-linux-musl-openssl-3.0.x.so.node" \
  && mkdir -p "${PRISMA_DEST}" \
  && cp -r "${PRISMA_SOURCE}/." "${PRISMA_DEST}/" \
  && test -f "${PRISMA_DEST}/libquery_engine-linux-musl-openssl-3.0.x.so.node" \
  && cp -r apps/studio/.next/static apps/studio/.next/standalone/apps/studio/.next/static

FROM node:22-alpine AS runtime

RUN apk add --no-cache libc6-compat openssl curl bash \
  && corepack enable

ENV NODE_ENV=production
WORKDIR /app

# node公式imageの非rootユーザー(uid=1000)で全アプリを実行する。
COPY --from=builder --chown=node:node /app /app

USER node

EXPOSE 3000 3001
CMD ["node", "apps/api/dist/main.js"]
