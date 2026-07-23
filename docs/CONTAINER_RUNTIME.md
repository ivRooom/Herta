# Production Container Runtime

Herta. の本番用共有イメージは、API / Studio / Bot / Worker / Migrator を1つのイメージで実行しつつ、実行に不要なsource・test・開発依存を含めない構成とします。

## 方針

- Builderでは全workspaceをインストールし、Prisma Client生成と全体buildを実行する
- build後に`node_modules`をproduction依存だけで再構成する
- production再構成はbuilder内のpnpm storeを利用し、`--offline`で実行する
- API / Bot / Workerと、その依存workspaceだけをインストール対象にする
- StudioはNext.js standalone成果物を使用する
- Migratorは`packages/db/node_modules/.bin/prisma`を直接実行し、runtimeでpnpmを必要としない
- workspace packageの実行時exportは`dist/*.js`を参照する
- runtime stageにはbuild成果物・production依存・Prisma migration・package metadataだけをコピーする

## Runtimeへ残すもの

- `apps/api/dist`
- `apps/bot/dist`
- `apps/worker/dist`
- `apps/studio/.next/standalone`
- `apps/studio/.next/static`
- 必要な`packages/*/dist`
- 必要な`plugins/*/dist`
- production用`node_modules`
- `packages/db/prisma/schema.prisma`
- `packages/db/prisma/migrations`
- Prisma ClientとQuery Engine

## Runtimeへ含めないもの

- `apps/*/src`
- `packages/*/src`
- `plugins/*/src`
- test / spec
- docs / examples / GitHub Actions設定
- TypeScript・Vitest・Nest CLI等の開発専用依存
- pnpm lockfile・workspace設定・Turbo設定
- 証明書・環境変数・Secret

## Migrator

本番composeでは、共有イメージ内のPrisma CLIを直接実行します。

```yaml
command:
  - /app/packages/db/node_modules/.bin/prisma
  - migrate
  - deploy
  - --schema
  - /app/packages/db/prisma/schema.prisma
```

これによりruntime imageでCorepackやpnpmを有効化する必要がありません。

## 検証

```bash
docker build -t herta-app:runtime .

docker run --rm --entrypoint sh herta-app:runtime -lc '
  set -eu
  test "$(id -u)" != "0"
  test -f apps/api/dist/main.js
  test -f apps/bot/dist/main.js
  test -f apps/worker/dist/main.js
  test -f apps/studio/.next/standalone/apps/studio/server.js
  test -x packages/db/node_modules/.bin/prisma
  test ! -e apps/api/src
  test ! -e packages/shared/src
  test ! -e plugins/quote/src
'
```

イメージサイズは次のコマンドで確認します。

```bash
docker image inspect herta-app:runtime --format '{{.Size}}'
docker history herta-app:runtime
```

CIではproduction build後に、non-root、主要成果物、Prisma Engine、workspace sourceの除外、runtime package importを検証し、イメージサイズをJob Summaryへ出力します。
