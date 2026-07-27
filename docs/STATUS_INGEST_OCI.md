# OCI status-ingest

## 目的

Lightsail上の`ivrm-status-agent`から送信されたHerta Botの公開可能な稼働状態だけを受信し、`stats.ivrm.jp`向けに最新状態を提供します。

```text
Herta Bot /healthz
  -> ivrm-status-agent
  -> HTTPS + HMAC-SHA256
  -> OCI status-ingest
  -> SQLite
  -> GET /api/status.json
```

## 実装範囲

- `POST /v1/observations`
- HMAC-SHA256署名検証
- Timestamp許容差
- 128-bit Nonceの再利用拒否
- Service ID / Sourceのallowlist
- 厳格なJSON schema検証
- SQLiteへの履歴・最新状態保存
- `GET /v1/status`
- `GET /api/status.json`
- `GET /healthz`
- 観測が一定時間更新されない場合の`unknown`化
- OCI VM向けDocker ComposeとCaddy TLS終端

今回のPRには`stats.ivrm.jp`のHTML画面は含みません。

## 署名仕様

Header:

```text
X-IVRM-Signature-Version: v1
X-IVRM-Timestamp: 1785120000
X-IVRM-Nonce: 32文字の小文字hex
X-IVRM-Signature: sha256=64文字の小文字hex
```

Canonical bytes:

```text
X-IVRM-Timestamp + "\n" + X-IVRM-Nonce + "\n" + raw request body
```

署名:

```text
HMAC-SHA256(shared secret, canonical bytes)
```

受信側はJSONを再serializeせず、受信したraw bodyで署名を再計算します。

## 受信payload

許可するtop-level fieldは次だけです。

```json
{
  "schema_version": 1,
  "service_id": "herta-discord-bot",
  "source": "herta-production",
  "observed_at": "2026-07-27T00:00:00Z",
  "sent_at": "2026-07-27T00:00:00Z",
  "status": "operational",
  "version": "0.1.0",
  "checks": {
    "process": "ok",
    "discord": "ok",
    "database": "ok",
    "redis": "ok",
    "worker": "ok"
  }
}
```

以下を受信・保存しません。

- Guild数、Guild ID
- Discordユーザー、チャンネル情報
- uptime
- latency
- heartbeat詳細
- 内部URL、ホスト名、IP
- Token、Secret
- エラーメッセージ、スタックトレース
- raw request body
- 署名値

## HTTP response

### POST /v1/observations

成功:

```text
HTTP 202
```

主な失敗:

- `401 invalid_signature`: 署名、Timestamp、Header形式不正
- `403 service_not_allowed`: Service IDまたはSource不一致
- `409 replayed_nonce`: Nonce再利用
- `413 payload_too_large`: Body上限超過
- `422 invalid_payload`: JSON schema不正
- `422 stale_observation`: 観測時刻が古い
- `422 future_observation`: 観測時刻が未来
- `422 unsupported_schema`: schema_versionをサポートしていない

レスポンスとログにSecret、署名、raw bodyは出しません。

### GET /api/status.json

観測が`STATUS_STALE_AFTER_SECONDS`を超えて更新されない場合、公開`status`を`unknown`へ変更します。最後に報告された状態は`reported_status`へ残します。

初回観測前もHTTP 200で`status=unknown`を返します。

## SQLite

保存テーブル:

- `status_nonces`
- `status_observations`
- `latest_status`

既定保持期間:

- Nonce: 15分（署名Timestamp許容差の2倍以上）
- 観測履歴: 30日
- 最新状態: 常時1件

`WAL`と`busy_timeout`を有効化しています。単一OCI VM・単一API replicaを前提とします。複数replicaへ拡張する場合はPostgreSQL等の共有DBへ移行します。

# CI

```bash
cd services/status-ingest
python3 -m compileall -q app.py test_app.py
python3 -m unittest -v test_app.py

docker build -t herta-status-ingest:test .
```

専用GitHub Actionsは、次を検証します。

- Python構文
- 正常署名
- 改ざん署名拒否
- Nonce再利用拒否
- 厳格schema
- stale判定
- SQLiteへraw body・署名を保存しないこと
- Compose構文
- Caddy構文
- 非root runtime
- read-only filesystemでの起動
- コンテナhealth

`main`へマージされた場合は次をGHCRへpushします。

```text
ghcr.io/ivrooom/herta-status-ingest:{commit SHA}
ghcr.io/ivrooom/herta-status-ingest:latest
```

# マージ後のOCI導入

## 0. 事前条件

- OCI Ubuntu VM
- Docker Engine
- Docker Compose plugin
- OCI Security ListまたはNSGでTCP 80 / 443を許可
- `stats.ivrm.jp`のA / AAAA recordをOCI VMへ設定
- Cloudflare SSL/TLSをFull (strict)に設定
- GHCR private packageの場合は`read:packages`を持つToken

APIコンテナの8080番は外部公開しません。

## 1. GitHub Actions

`main`マージ後、次を確認します。

```text
Actions
-> Status Ingest CI
-> Python, API and container validation
```

GHCRへSHA imageがpushされたことを確認します。

## 2. 配置ディレクトリ

OCI VMで実行します。

```bash
sudo install -d \
  --owner root \
  --group root \
  --mode 0750 \
  /opt/ivrm-status
```

RepositoryをOCI VMへclone済みの場合:

```bash
sudo install \
  --owner root \
  --group root \
  --mode 0644 \
  /path/to/Herta/services/status-ingest/docker-compose.yml \
  /opt/ivrm-status/docker-compose.yml

sudo install \
  --owner root \
  --group root \
  --mode 0644 \
  /path/to/Herta/services/status-ingest/Caddyfile \
  /opt/ivrm-status/Caddyfile
```

## 3. 新しい共有Secret

チャット、Issue、PR、Shell historyへSecretを直接書きません。

```bash
read -rsp '新しいSTATUS_SIGNING_SECRET: ' STATUS_SIGNING_SECRET
printf '\n'

if [ "${#STATUS_SIGNING_SECRET}" -lt 32 ]; then
  echo 'ERROR: 32文字以上必要です'
  unset STATUS_SIGNING_SECRET
  exit 1
fi
```

別Terminalで生成する場合:

```bash
openssl rand -hex 32
```

## 4. OCI環境ファイル

編集ソフトを使わず作成します。

```bash
STATUS_IMAGE='ghcr.io/ivrooom/herta-status-ingest:マージ後の完全なcommit SHA'
STATUS_ENV_TMP="$(mktemp)"
chmod 600 "${STATUS_ENV_TMP}"

cat > "${STATUS_ENV_TMP}" <<EOF
STATUS_INGEST_IMAGE=${STATUS_IMAGE}
STATUS_PUBLIC_HOST=stats.ivrm.jp
STATUS_INGEST_HOST=0.0.0.0
STATUS_INGEST_PORT=8080
STATUS_DATABASE_PATH=/data/status-ingest.sqlite3
STATUS_SIGNING_SECRET=${STATUS_SIGNING_SECRET}
STATUS_ALLOWED_SERVICE_ID=herta-discord-bot
STATUS_ALLOWED_SOURCE=herta-production
STATUS_TIMESTAMP_TOLERANCE_SECONDS=300
STATUS_MAX_OBSERVATION_AGE_SECONDS=600
STATUS_FUTURE_OBSERVATION_TOLERANCE_SECONDS=60
STATUS_NONCE_RETENTION_SECONDS=900
STATUS_OBSERVATION_RETENTION_DAYS=30
STATUS_STALE_AFTER_SECONDS=180
STATUS_MAX_BODY_BYTES=16384
STATUS_PUBLIC_CORS_ORIGIN=https://stats.ivrm.jp
LOG_LEVEL=INFO
EOF

sudo install \
  --owner root \
  --group root \
  --mode 0600 \
  "${STATUS_ENV_TMP}" \
  /opt/ivrm-status/.env

rm -f "${STATUS_ENV_TMP}"
unset STATUS_SIGNING_SECRET
```

権限:

```bash
sudo stat -c '%U:%G %a %n' /opt/ivrm-status/.env
```

期待値:

```text
root:root 600 /opt/ivrm-status/.env
```

Secretを伏せて確認:

```bash
sudo awk -F= '
  $1 == "STATUS_SIGNING_SECRET" {
    print $1 "=<redacted:" length($2) "文字>"
    next
  }
  { print }
' /opt/ivrm-status/.env
```

## 5. GHCR login

```bash
read -rp 'GitHub username: ' GHCR_USERNAME
read -rsp 'GitHub read:packages token: ' GHCR_TOKEN
printf '\n'

printf '%s' "${GHCR_TOKEN}" |
  sudo docker login ghcr.io \
    --username "${GHCR_USERNAME}" \
    --password-stdin

unset GHCR_TOKEN
```

## 6. Compose検証と起動

```bash
cd /opt/ivrm-status

sudo docker compose config --quiet
sudo docker compose pull
sudo docker compose up -d
sudo docker compose ps
```

期待状態:

```text
status-ingest  healthy
caddy          Up
```

## 7. OCI内部確認

```bash
cd /opt/ivrm-status

sudo docker compose exec -T status-ingest \
  python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8080/healthz').read().decode())"
```

公開状態:

```bash
curl -fsS https://stats.ivrm.jp/healthz | python3 -m json.tool
curl -fsS https://stats.ivrm.jp/api/status.json | python3 -m json.tool
```

初回送信前は`status=unknown`で正常です。

## 8. Lightsailへ同じSecretを設定

Lightsailの`/etc/herta/status-agent.env`へ、OCIと同じ新Secretを設定します。編集ソフトを使わない更新例:

```bash
read -rsp 'OCIと共有する新STATUS_SIGNING_SECRET: ' NEW_SECRET
printf '\n'

if [ "${#NEW_SECRET}" -lt 32 ]; then
  echo 'ERROR: 32文字以上必要です'
  unset NEW_SECRET
  exit 1
fi

sudo env NEW_SECRET="${NEW_SECRET}" python3 - <<'PY'
import os
from pathlib import Path

path = Path('/etc/herta/status-agent.env')
replacements = {
    'STATUS_INGEST_URL': 'https://stats.ivrm.jp/v1/observations',
    'STATUS_SIGNING_SECRET': os.environ['NEW_SECRET'],
    'STATUS_DRY_RUN': 'false',
}

lines = path.read_text(encoding='utf-8').splitlines()
output = []
found = set()
for line in lines:
    key = line.split('=', 1)[0]
    if key in replacements:
        output.append(f'{key}={replacements[key]}')
        found.add(key)
    else:
        output.append(line)
for key, value in replacements.items():
    if key not in found:
        output.append(f'{key}={value}')
path.write_text('\n'.join(output) + '\n', encoding='utf-8')
PY

unset NEW_SECRET
sudo chown root:root /etc/herta/status-agent.env
sudo chmod 600 /etc/herta/status-agent.env
```

## 9. Lightsailから手動送信

```bash
sudo systemctl start herta-status-agent.service

systemctl show herta-status-agent.service \
  -p Result \
  -p ExecMainStatus

sudo journalctl \
  -u herta-status-agent.service \
  -n 100 \
  --no-pager
```

期待値:

```text
Result=success
ExecMainStatus=0
ステータス送信に成功しました。HTTP 2xx
```

OCI側:

```bash
cd /opt/ivrm-status
sudo docker compose logs --since=5m status-ingest
curl -fsS https://stats.ivrm.jp/api/status.json | python3 -m json.tool
```

## 10. timer有効化

手動送信と公開APIを確認した後だけ実行します。

```bash
sudo systemctl enable --now herta-status-agent.timer

systemctl is-enabled herta-status-agent.timer
systemctl is-active herta-status-agent.timer
systemctl list-timers herta-status-agent.timer --all
```

1〜2分後、`observed_at`と`received_at`が更新されることを確認します。

# 運用

## ログ

OCI:

```bash
cd /opt/ivrm-status
sudo docker compose logs --tail=200 status-ingest caddy
```

Lightsail:

```bash
sudo journalctl -u herta-status-agent.service -n 100 --no-pager
```

## SQLite整合性確認

```bash
cd /opt/ivrm-status
sudo docker compose exec -T status-ingest python - <<'PY'
import os
import sqlite3

path = os.environ['STATUS_DATABASE_PATH']
connection = sqlite3.connect(path)
print(connection.execute('PRAGMA integrity_check').fetchone()[0])
print(connection.execute('SELECT COUNT(*) FROM status_observations').fetchone()[0])
PY
```

期待値:

```text
ok
```

## バックアップ

SQLite online backup APIを使います。

```bash
cd /opt/ivrm-status
sudo docker compose exec -T status-ingest python - <<'PY'
import os
import sqlite3
from datetime import UTC, datetime

source = sqlite3.connect(os.environ['STATUS_DATABASE_PATH'])
name = '/data/status-ingest-' + datetime.now(UTC).strftime('%Y%m%dT%H%M%SZ') + '.sqlite3'
target = sqlite3.connect(name)
with target:
    source.backup(target)
target.close()
source.close()
print(name)
PY
```

バックアップファイルは別ストレージへ退避し、DB volume内だけに残さないでください。

## Secret rotation

1. OCI受信側を新Secretへ変更
2. Lightsail送信側を同じ新Secretへ変更
3. 手動送信で202確認
4. timerの次回送信確認

本実装はSecretを1つだけ受け付けます。無停止rotationが必要になった場合は、新旧2Secret対応を別PRで追加します。

## 停止

Lightsail送信停止:

```bash
sudo systemctl disable --now herta-status-agent.timer
```

OCI受信停止:

```bash
cd /opt/ivrm-status
sudo docker compose down
```

## ロールバック

`/opt/ivrm-status/.env`の`STATUS_INGEST_IMAGE`を以前のcommit SHAへ変更し、次を実行します。

```bash
cd /opt/ivrm-status
sudo docker compose pull
sudo docker compose up -d
sudo docker compose ps
```

SQLite schemaは起動時に追加作成のみを行い、破壊的migrationはありません。
