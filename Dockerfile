# ============================================================
# Herta. — 本番用 Docker イメージ (モノレポ共通)
# ============================================================
# Node本体は現行の公式Node 22 Alpine imageから取得する。
# builder/runtimeは同じAlpine 3.21基盤に揃え、Prisma / Sharpなどのnative artifactのABIを一致させる。
# Alpine 3.21はOpenSSL 3.3系を提供するため、OpenSSL 3.5以降のQUIC実装由来CVEをruntimeへ持ち込まない。
FROM node:22-alpine3.24 AS node-current

FROM alpine:3.21 AS builder

RUN apk add --no-cache libc6-compat openssl bash libstdc++
COPY --from=node-current /usr/local /usr/local
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
  && pnpm --filter @herta/db exec prisma generate

# Next.js standalone出力ではPrisma Query Engine / static / publicが自動追跡されない場合があるため、
# production依存から生成したClientとStudio配信アセットをstandaloneへ明示的に配置する。
RUN PRISMA_SOURCE="$(find node_modules/.pnpm -path '*/node_modules/.prisma/client' -type d -print -quit)" \
  && PRISMA_DEST="apps/studio/.next/standalone/apps/studio/.prisma/client" \
  && STUDIO_STANDALONE="apps/studio/.next/standalone/apps/studio" \
  && test -n "${PRISMA_SOURCE}" \
  && PRISMA_ENGINE="$(find "${PRISMA_SOURCE}" -maxdepth 1 -type f -name 'libquery_engine-*.so.node' -print -quit)" \
  && test -n "${PRISMA_ENGINE}" \
  && mkdir -p "${PRISMA_DEST}" "${STUDIO_STANDALONE}/public" \
  && cp -r "${PRISMA_SOURCE}/." "${PRISMA_DEST}/" \
  && cp -r apps/studio/.next/static "${STUDIO_STANDALONE}/.next/static" \
  && cp -r apps/studio/public/. "${STUDIO_STANDALONE}/public/" \
  && test -f "${STUDIO_STANDALONE}/public/birthday-card-presets/herta-lavender-tea.webp" \
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
    apps/studio/.next/cache \
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
    \( -path '*/node_modules' -o -path '*/.next' \) -prune -o \
    -type f \( -name 'tsconfig*.json' -o -name '*.test.ts' -o -name '*.spec.ts' \) \
    -exec rm -f {} + \
  && test -f apps/api/dist/main.js \
  && test -f apps/bot/dist/main.js \
  && test -f apps/worker/dist/main.js \
  && test -f apps/studio/.next/standalone/apps/studio/server.js \
  && test -f apps/studio/.next/standalone/apps/studio/public/birthday-card-presets/herta-lavender-tea.webp \
  && test -x packages/db/node_modules/.bin/prisma \
  && test ! -d apps/studio/.next/cache \
  && test ! -d apps/api/src \
  && test ! -d packages/shared/src \
  && test ! -d plugins/quote/src

FROM alpine:3.21 AS runtime

# Node binaryは現行公式imageから取得し、runtime OS packagesはAlpine 3.21のsecurity updatesを利用する。
# Birthday CardはDiscord表示名・日付を画像へ描画するため、日本語を含むCJK glyphをRuntimeに用意する。
RUN apk add --no-cache libc6-compat openssl curl font-noto-cjk libstdc++ \
  && addgroup -g 1000 -S node \
  && adduser -u 1000 -S -G node node
COPY --from=node-current /usr/local /usr/local
RUN rm -rf \
    /usr/local/lib/node_modules/npm \
    /usr/local/lib/node_modules/corepack \
  && rm -f \
    /usr/local/bin/npm \
    /usr/local/bin/npx \
    /usr/local/bin/corepack \
    /usr/local/bin/pnpm \
    /usr/local/bin/pnpx \
    /usr/local/bin/yarn \
    /usr/local/bin/yarnpkg

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
