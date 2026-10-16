# 開発環境専用のPrisma Studio(DBブラウザ)。
# モノレポ全体をインストールせず、schema.prismaだけを使って軽量に起動する。
FROM node:22-bookworm-slim

RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

# packages/db/package.jsonのprisma依存と同じバージョンに固定する。
RUN npm install --global prisma@6.19.3

WORKDIR /app
COPY packages/db/prisma ./prisma

ENV PRISMA_HIDE_UPDATE_MESSAGE=true
EXPOSE 5555

CMD ["prisma", "studio", "--schema", "./prisma/schema.prisma", "--hostname", "0.0.0.0", "--port", "5555"]
