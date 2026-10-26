FROM node:22-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /fixture
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/db/package.json ./packages/db/package.json
# Optional operator trust bundle is ephemeral, never part of the image.
RUN --mount=type=secret,id=trusted_ca \
    if [ -f /run/secrets/trusted_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/trusted_ca; fi; \
    corepack enable && corepack prepare pnpm@9.15.4 --activate \
    && pnpm install --frozen-lockfile --filter @herta/db...
COPY packages/db/prisma ./packages/db/prisma
RUN pnpm --filter @herta/db generate
COPY tests/postgresql-readiness/client.mjs ./packages/db/client.mjs
WORKDIR /fixture/packages/db
ENTRYPOINT ["node", "client.mjs"]
