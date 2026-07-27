# Herta Bot ヘルスエンドポイント

## 目的

`GET /healthz` は、`ivrm-status-agent`がHerta Discord Botの利用者影響を判定するための内部向けJSONエンドポイントです。
CPU・メモリなどのインフラ指標ではなく、Discord Botとして主要機能を提供できるかを返します。

外部送信エージェントは`docs/STATUS_AGENT.md`で管理します。OCI側のstatus-ingest APIと`stats.ivrm.jp`のUIはこのRepositoryに含みません。

## 公開範囲

このエンドポイントを公開インターネットへ直接公開しないでください。

ローカルでBotを直接実行する場合は、既定値の `HEALTH_HOST=127.0.0.1` を使用します。
本番Docker Composeでは、コンテナ内部で `0.0.0.0:3000` に待受し、Lightsailホストの `127.0.0.1:3000` だけへpublishします。
このため、Cloudflare、Caddy、nginx、LightsailのパブリックIPからは到達できません。

## 確認項目

- Botプロセス
- Discord Clientのready状態
- Discord Gateway接続状態
- 最後にGatewayが正常と観測された時刻
- PostgreSQLへの軽量な `SELECT 1`
- Redisの `PING`
- Redisへ保存されたWorker heartbeat

Discord.jsはHeartbeat ACKの時刻を公開APIとして提供しないため、`last_heartbeat_at` はClient ready状態とGateway pingを定期観測した時刻です。
レスポンスでは `heartbeat_source: "gateway_status_observation"` として、実Heartbeat時刻と区別します。

WorkerはRedisキー `herta:health:worker:heartbeat:v1` を30秒ごとに更新します。
Botはこの時刻を取得し、`HEALTH_HEARTBEAT_STALE_MS` を超えた場合にWorker異常と判定します。

## 環境変数

| 変数                        |      既定値 | 説明                                          |
| --------------------------- | ----------: | --------------------------------------------- |
| `HEALTH_ENABLED`            |      `true` | HTTPエンドポイントを有効化する                |
| `HEALTH_HOST`               | `127.0.0.1` | Botプロセスの待受アドレス                     |
| `HEALTH_PORT`               |      `3000` | Botプロセスの待受ポート                       |
| `HEALTH_CHECK_TIMEOUT_MS`   |      `3000` | 各依存チェックのタイムアウト                  |
| `HEALTH_CACHE_TTL_MS`       |      `5000` | 同時・連続アクセスをまとめるキャッシュ時間    |
| `HEALTH_HEARTBEAT_STALE_MS` |    `120000` | Discord・Worker heartbeatの期限               |
| `HERTA_VERSION`             |     `0.1.0` | 公開レスポンスへ返すアプリバージョン          |
| `HEALTH_PUBLISH_HOST`       | `127.0.0.1` | Docker Composeでホスト側にpublishするアドレス |
| `HEALTH_PUBLISH_PORT`       |      `3000` | Docker Composeでホスト側にpublishするポート   |

`HEALTH_HOST=0.0.0.0` はDockerコンテナ内部でのみ使用してください。ホスト側は必ず `HEALTH_PUBLISH_HOST=127.0.0.1` にします。

## レスポンス例

```json
{
  "service": {
    "id": "herta-discord-bot",
    "name": "Herta",
    "type": "discord_bot"
  },
  "status": "operational",
  "checked_at": "2026-07-25T11:30:00.000Z",
  "uptime_seconds": 43200,
  "version": "0.1.0",
  "checks": {
    "process": {
      "status": "ok"
    },
    "discord": {
      "status": "ok",
      "connected": true,
      "ready": true,
      "gateway_status": "ready",
      "reconnecting": false,
      "last_ready_at": "2026-07-25T10:00:00.000Z",
      "last_heartbeat_at": "2026-07-25T11:29:42.000Z",
      "last_disconnect_at": null,
      "heartbeat_source": "gateway_status_observation"
    },
    "database": {
      "status": "ok",
      "latency_ms": 3
    },
    "redis": {
      "status": "ok",
      "latency_ms": 1
    },
    "worker": {
      "status": "ok",
      "latency_ms": 1,
      "last_heartbeat_at": "2026-07-25T11:29:50.000Z"
    }
  }
}
```

失敗時のメッセージは `dependency check failed` へ正規化し、接続先やスタックトレースを返しません。

## ステータス判定

### `operational`

- Discord Clientがready
- Gateway接続済み
- Discord heartbeat観測が期限内
- PostgreSQLが正常
- Redisが正常、または未設定
- Workerが正常、またはWorker確認が未設定

### `degraded`

- Discord Bot自体は利用可能
- Redis異常
- Worker停止・heartbeat遅延
- DB・Redis・Workerの応答遅延
- 必須DBが未設定

### `outage`

- Discord Clientがreadyではない
- Gateway切断・再接続中
- Discord heartbeat観測が期限超過
- 必須PostgreSQLへの接続不能

### `unknown`

- Discordまたは必須DBの状態を判定できない
- ヘルス収集処理自体が想定外に失敗した
- Bot初期化中

HTTPコードは次の通りです。

| status        |  HTTP |
| ------------- | ----: |
| `operational` | `200` |
| `degraded`    | `200` |
| `maintenance` | `200` |
| `outage`      | `503` |
| `unknown`     | `503` |

## ローカル確認

Botを直接起動した場合:

```bash
curl -fsS http://127.0.0.1:3000/healthz | jq
```

HTTPコードを含める場合:

```bash
curl -sS \
  -o /tmp/herta-health.json \
  -w '%{http_code}\n' \
  http://127.0.0.1:3000/healthz
jq . /tmp/herta-health.json
```

本番Docker ComposeでもLightsailホストから同じURLで取得できます。
コンテナ内部で確認する場合:

```bash
docker compose \
  --env-file /app/herta/.env.production \
  -f /app/herta/docker-compose.prod.yml \
  exec -T bot \
  curl -fsS http://127.0.0.1:3000/healthz | jq
```

## セキュリティ

公開レスポンスへ次の情報は含めません。

- Discord Bot Token
- Guild、ユーザー、チャンネル情報
- DB接続文字列、ホスト名、ユーザー名
- Redis URL
- AWS認証情報
- 内部IPアドレス
- 環境変数一覧
- Discordメッセージ
- スタックトレース、ファイルパス、秘密鍵

状態変化ログにも依存サービスのエラー全文を含めず、変化したチェック名だけを記録します。

## Graceful shutdown

`SIGTERM` と `SIGINT` を受けた場合、HTTPサーバーを閉じた後にBot、Redis、Prisma、Discord Clientを終了します。
Workerはheartbeatタイマーを停止し、Redis上のheartbeatキーを削除してから終了します。

## 外部ステータス連携

Lightsailホスト上の`ivrm-status-agent`が`http://127.0.0.1:3000/healthz`を定期取得し、公開許可フィールドだけをOCI側status-ingest APIへ送信します。

次の詳細は`docs/STATUS_AGENT.md`を参照してください。

- 公開payload
- 送信しない情報
- HMAC-SHA256署名
- Timestamp・Nonceによるreplay対策
- HTTPS制約
- 再送とタイムアウト
- systemd導入・停止・ロールバック
