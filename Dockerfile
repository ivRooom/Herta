# ============================================================
# Herta. — 本番用 Docker イメージ (モノレポ共通)
# ============================================================
FROM node:22-alpine AS builder

RUN apk add --no-cache libc6-compat openssl bash
RUN corepack enable
WORKDIR /app

COPY . .

# 全workspaceを事前ビルドし、本番でtsxによるTypeScript直接実行を行わない。
RUN pnpm install --frozen-lockfile \
  && pnpm --filter @herta/db exec prisma generate \
  && pnpm build \
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
