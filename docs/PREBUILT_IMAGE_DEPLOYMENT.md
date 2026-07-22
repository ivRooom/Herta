# GHCR事前ビルド方式による本番デプロイ

Hertaの本番アプリimageはGitHub Actionsでbuildし、GitHub Container Registry（GHCR）へpushします。AWS Lightsailではmonorepo全体をbuildせず、commit SHAで固定したimageをpullして起動します。

## 目的

Lightsail上でのDocker buildはCPU・memory・disk I/Oを大きく使用し、SSH切断や途中中断によって不完全な`herta-app:latest`が残る原因になります。

事前ビルド方式では以下を保証します。

- GitHub Actionsの一時runnerでDocker imageをbuild
- API / Studio / Bot / Workerの成果物をimage配布前に検証
- Next.js standaloneにPrisma Query Engineが含まれることを検証
- commit SHAタグを使用して同じimageを再取得可能にする
- Lightsailではpullとcontainer再作成だけを行う

## Image

配布先:

```text
ghcr.io/ivrooom/herta
```

タグ:

- `:<commit SHA>`: 本番デプロイとrollbackで使用する不変タグ
- `:latest`: `main`の最新正常buildを示す手動起動用タグ

`docker-compose.prod.yml`では`HERTA_IMAGE`を指定した場合にそのimageを利用します。未指定時はローカル互換用の`herta-app:latest`へフォールバックします。

## 自動デプロイ

`main`へのpushまたは`Deploy Production`の手動実行で、次の順に処理します。

1. 指定refをcheckout
2. Docker imageをbuild
3. API / Studio / Bot / Worker / Prisma Engine / 非root実行を検証
4. GHCRへcommit SHAタグをpush
5. `main`の場合は`latest`もpush
6. LightsailへSSH接続
7. GHCRへ一時的にログイン
8. commit SHA imageをpull
9. migrationを実行して全serviceを起動
10. nginx / Caddyを再起動してupstreamを再解決
11. container、migration、API、Auth.js、Discord Botログインを検証
12. Cloudflare経由のAPI・Auth.js endpointを検証

GitHub Actionsの`GITHUB_TOKEN`はworkflow実行中だけLightsailへ渡し、GHCR pull後に`docker logout`します。永続Tokenを`.env.production`へ保存しません。

## Lightsailの環境変数

`.env.production`へ次を追加します。

```env
HERTA_IMAGE=ghcr.io/ivrooom/herta:latest
```

自動デプロイではcommit SHA imageがshell環境変数として上書きされます。

## 手動起動

private packageを手動pullする場合は、`read:packages`を持つGitHub Personal Access TokenでGHCRへログインします。Tokenをshell historyへ直接入力しないでください。

```bash
printf '%s' "$GHCR_PAT" | docker login ghcr.io \
  --username '<GitHubユーザー名>' \
  --password-stdin
```

起動:

```bash
cd /app/herta
./deploy/scripts/start.sh
```

指定refのcommit SHA imageをデプロイ:

```bash
cd /app/herta
./deploy/scripts/deploy.sh main
```

## Rollback

指定commitまたはtagに対応するGHCR imageへ切り戻します。

```bash
cd /app/herta
./deploy/scripts/rollback.sh <commit-or-tag>
```

DB migrationは前方向のみです。schema変更を伴うrollbackでは、codeとimageを戻すだけでDB schemaは戻りません。破壊的migrationの前にbackupを取得し、必要に応じてrestoreしてください。

## 稼働確認

```bash
cd /app/herta

docker compose \
  --env-file .env.production \
  -f docker-compose.prod.yml \
  ps -a

curl -fsS https://herta.ivrm.jp/api/v1/health
curl -fsS https://herta.ivrm.jp/api/auth/providers

docker logs --since 5m herta-bot-1 2>&1 | \
  grep 'Herta Bot がログインしました'
```

## 緊急hotfixの解除

過去の復旧作業で`docker-compose.bot-hotfix.yml`を作成していても、通常の自動デプロイではoverride fileを指定しないため利用されません。新しい本番imageでBotの`apps/bot/dist/main.js`が確認でき、`/ping`が成功した後に削除できます。

```bash
rm -f /app/herta/docker-compose.bot-hotfix.yml
```

## Troubleshooting

### GHCRからpullできない

- packageのvisibilityとrepository accessを確認
- GitHub Actionsの`packages: write`権限を確認
- 手動実行時はPATに`read:packages`があることを確認
- image名が小文字の`ghcr.io/ivrooom/herta`であることを確認

### Botが再起動を繰り返す

```bash
docker logs --tail=200 herta-bot-1
```

`apps/bot/dist/main.js`不足はimage検証でデプロイ前に検出されます。Token・Discord接続・DB・Redisのエラーを確認してください。

### StudioでPrisma Engineが見つからない

配布image内を確認します。

```bash
docker run --rm --entrypoint sh "$HERTA_IMAGE" -lc '
  find apps/studio/.next/standalone/apps/studio/.prisma/client \
    -maxdepth 1 -type f -name "libquery_engine-*.so.node" -print
'
```

EngineがないimageはGitHub Actionsの成果物検証でpush前に失敗する設計です。
