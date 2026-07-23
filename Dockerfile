# ============================================================
# Herta. — 本番用 Docker イメージ (モノレポ共通)
# ============================================================
FROM node:22-alpine AS builder

RUN apk add --no-cache libc6-compat openssl bash
RUN corepack enable
WORKDIR /app

COPY . .

# 全workspaceをビルドした後、実行対象サービスとその依存だけをproduction構成で再配置する。
# pnpm storeはbuilder内に残るため、production再インストールはofflineで完結する。
RUN pnpm install --frozen-lockfile \
  && pnpm --filter @herta/db exec prisma generate \
  && pnpm build \
  && rm -rf node_modules \
    apps/*/node_modules \
    packages/*/node_modules \
    plugins/*/node_modules \
    examples/*/node_modules \
  && pnpm install --prod --offline --frozen-lockfile \
    --filter @herta/api... \
    --filter @herta/bot... \
    --filter @herta/worker... \
  && pnpm --filter @herta/db add --prod --offline --lockfile=false prisma@6.2.1 \
  && pnpm --filter @herta/db exec prisma generate

# Next.js standalone出力ではPrisma Query Engineが自動追跡されない場合があるため、
# production依存から生成したClientとEngineをStudio standaloneへ明示的に配置する。
RUN PRISMA_SOURCE="$(find node_modules/.pnpm -path '*/node_modules/.prisma/client' -type d -print -quit)" \
  && PRISMA_DEST="apps/studio/.next/standalone/apps/studio/.prisma/client" \
  && test -n "${PRISMA_SOURCE}" \
  && PRISMA_ENGINE="$(find "${PRISMA_SOURCE}" -maxdepth 1 -type f -name 'libquery_engine-*.so.node' -print -quit)" \
  && test -n "${PRISMA_ENGINE}" \
  && mkdir -p "${PRISMA_DEST}" \
  && cp -r "${PRISMA_SOURCE}/." "${PRISMA_DEST}/" \
  && cp -r apps/studio/.next/static apps/studio/.next/standalone/apps/studio/.next/static \
  && test -n "$(find "${PRISMA_DEST}" -maxdepth 1 -type f -name 'libquery_engine-*.so.node' -print -quit)"

# Runtimeへ持ち込まないworkspace source・test・開発設定をbuilder側で除去する。
# node_modules内の外部packageは変更せず、Herta workspaceだけを明示的にpruneする。
RUN rm -rf \
    .github \
    .turbo \
    certs \
    docs \
    examples \
    deploy \
    packages/config \
    packages/ui \
    apps/api/src \
    apps/bot/src \
    apps/worker/src \
    apps/studio/src \
    packages/db/src \
    packages/logger/src \
    packages/plugin-catalog/src \
    packages/plugin-sdk/src \
    packages/queue/src \
    packages/rule-engine/src \
    packages/shared/src \
    plugins/auto-response/src \
    plugins/daily-content/src \
    plugins/lfg/src \
    plugins/moderation/src \
    plugins/quote/src \
    plugins/team-split/src \
  && rm -f \
    pnpm-lock.yaml \
    pnpm-workspace.yaml \
    turbo.json \
    tsconfig.json \
    .prettierrc* \
    .prettierignore \
  && find apps packages plugins \
    -path '*/node_modules' -prune -o \
    -path '*/.next' -prune -o \
    -type f \( -name 'tsconfig*.json' -o -name '*.test.ts' -o -name '*.spec.ts' \) \
    -delete \
  && test -f apps/api/dist/main.js \
  && test -f apps/bot/dist/main.js \
  && test -f apps/worker/dist/main.js \
  && test -f apps/studio/.next/standalone/apps/studio/server.js \
  && test -x packages/db/node_modules/.bin/prisma \
  && test ! -d apps/api/src \
  && test ! -d packages/shared/src \
  && test ! -d plugins/quote/src

FROM node:22-alpine AS runtime

RUN apk add --no-cache libc6-compat openssl curl

ENV NODE_ENV=production
WORKDIR /app

# root node_modulesはproduction依存のみ。workspaceはbuild成果物・package metadata・
# Prisma migration files・Next.js standaloneだけをコピーする。
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/apps ./apps
COPY --from=builder --chown=node:node /app/packages ./packages
COPY --from=builder --chown=node:node /app/plugins ./plugins

USER node

EXPOSE 3000 3001
CMD ["node", "apps/api/dist/main.js"]
