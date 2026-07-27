# ivrm-status-agent

## 目的

`ivrm-status-agent`は、Lightsail上のHerta Bot内部ヘルスを取得し、既存の`ivrm-stats`へ公開可能な最小情報だけを送信します。

```text
Herta /healthz
  -> ivrm-status-agent
  -> HTTPS + HMAC-SHA256
  -> POST https://stats.ivrm.jp/api/internal/status-ingest
  -> 既存 ivrm-status-api / SQLite
  -> stats.ivrm.jp
```

独立したstatus-ingestコンテナ、追加Caddy、追加SQLiteは使用しません。

## 公開payload

```json
{
  "schema_version": "1.0",
  "service": {
    "id": "herta-discord-bot",
    "name": "Herta",
    "group": "Discordサービス",
    "type": "discord_bot"
  },
  "status": "operational",
  "checked_at": "2026-07-27T00:00:00.000Z",
  "version": "0.1.0",
  "summary": "正常に稼働しています"
}
```

`summary`は全体状態だけから生成します。内部check、Guild数、uptime、Gateway詳細、heartbeat、latency、内部URL、Token、Secret、例外、スタックトレースは送信しません。

## 内部ヘルス検証

送信前に次を確認します。

- HTTP 200または503
- JSONドキュメントが正確に1件
- 本文が空でなく、既定65536 bytes以下
- `service.id=herta-discord-bot`
- status、checked_at、versionが安全な形式
- processからworkerまでの内部checkが既知の値

内部checkは検証にだけ利用し、公開payloadへ含めません。

## 送信先URL

本番送信先は固定です。

```text
https://stats.ivrm.jp/api/internal/status-ingest
```

AgentはHTTPS以外、異なるpath、query・fragment・userinfo付きURLを拒否します。

## HMAC認証

Headers:

```http
Content-Type: application/json
X-IVRM-Service-Id: herta-discord-bot
X-IVRM-Timestamp: Unix秒
X-IVRM-Request-Id: UUID v4
X-IVRM-Body-SHA256: raw bodyのSHA-256小文字hex
X-IVRM-Signature: v1=<HMAC-SHA256小文字hex>
```

Canonical string:

```text
POST
/api/internal/status-ingest
{timestamp}
{request_id}
herta-discord-bot
{body_sha256}
```

末尾改行は付けません。送信するJSONバイト列そのものをSHA-256へ入力します。

## 再送

- curlで一時障害を再試行
- 同じrequest IDが処理済みでHTTP 409になった場合は正常終了
- 失敗payloadは保存せず、次回timerで最新状態を再取得
- timerは1分間隔

## systemd

専用`herta-status-agent`ユーザーで実行します。

- `NoNewPrivileges=true`
- Capabilityなし
- Home非公開
- System領域read-only
- namespace作成禁止
- メモリ128MB
- Tasks 32
- Secretファイルは`root:root 0600`

## テスト

```bash
bash -n deploy/scripts/ivrm-status-agent.sh
bash deploy/scripts/ivrm-status-agent.test.sh
bash deploy/scripts/ivrm-status-agent-url.test.sh
bash deploy/scripts/ivrm-status-agent-json.test.sh
bash deploy/scripts/ivrm-status-agent-size.test.sh
bash deploy/scripts/ivrm-status-agent-proxy.test.sh
```

# 本番反映

## 1. OCI側Secret

既存Status APIの環境ファイルです。

```text
/opt/ivrm/compose/ivrm-status-api/.env
```

新しい64文字hex Secretをパスワードマネージャー等で生成し、画面へ表示しない入力で取得します。

```bash
read -rsp '新しいHERTA_INGEST_SECRET: ' HERTA_INGEST_SECRET
printf '\n'
```

編集ソフトを使わず設定します。

```bash
sudo env HERTA_INGEST_SECRET="${HERTA_INGEST_SECRET}" python3 - <<'PY'
import os
from pathlib import Path

path = Path('/opt/ivrm/compose/ivrm-status-api/.env')
key = 'HERTA_INGEST_SECRET'
value = os.environ[key]
lines = path.read_text(encoding='utf-8').splitlines() if path.exists() else []
output = []
found = False
for line in lines:
    if line.startswith(key + '='):
        output.append(f'{key}={value}')
        found = True
    else:
        output.append(line)
if not found:
    output.append(f'{key}={value}')
path.write_text('\n'.join(output) + '\n', encoding='utf-8')
PY

sudo chown root:root /opt/ivrm/compose/ivrm-status-api/.env
sudo chmod 600 /opt/ivrm/compose/ivrm-status-api/.env
```

Status APIだけを再作成します。CaddyとMinecraftは再起動しません。

```bash
sudo docker compose \
  --project-directory /opt/ivrm/compose/ivrm-status-api \
  -f /opt/ivrm/compose/ivrm-status-api/docker-compose.yml \
  up -d --force-recreate status-api
```

## 2. Lightsail側Secret

OCIと同じSecretを非表示入力し、`/etc/herta/status-agent.env`を更新します。

```bash
read -rsp 'OCIと同じHERTA_INGEST_SECRET: ' NEW_SECRET
printf '\n'

sudo env NEW_SECRET="${NEW_SECRET}" python3 - <<'PY'
import os
from pathlib import Path

path = Path('/etc/herta/status-agent.env')
replacements = {
    'STATUS_INGEST_URL': 'https://stats.ivrm.jp/api/internal/status-ingest',
    'STATUS_SIGNING_SECRET': os.environ['NEW_SECRET'],
    'STATUS_SERVICE_ID': 'herta-discord-bot',
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

unset NEW_SECRET HERTA_INGEST_SECRET
sudo chown root:root /etc/herta/status-agent.env
sudo chmod 600 /etc/herta/status-agent.env
```

## 3. Agent更新

```bash
cd /app/herta
git fetch origin main
git switch main
git pull --ff-only origin main

sudo install --owner root --group root --mode 0644 \
  deploy/systemd/herta-status-agent.service \
  /etc/systemd/system/herta-status-agent.service

sudo install --owner root --group root --mode 0644 \
  deploy/systemd/herta-status-agent.timer \
  /etc/systemd/system/herta-status-agent.timer

sudo systemctl daemon-reload
sudo systemd-analyze verify --recursive-errors=yes \
  /etc/systemd/system/herta-status-agent.service \
  /etc/systemd/system/herta-status-agent.timer
```

## 4. 手動送信

Timerは無効のまま実行します。

```bash
sudo systemctl start herta-status-agent.service
systemctl show herta-status-agent.service -p Result -p ExecMainStatus
sudo journalctl -u herta-status-agent.service -n 100 --no-pager
```

期待値:

```text
Result=success
ExecMainStatus=0
ステータス送信に成功しました。HTTP 202
```

## 5. 公開反映

```bash
curl -fsS https://stats.ivrm.jp/api/status.json | python3 -m json.tool
```

`herta-discord-bot`の`status`、`checked_at`、`last_received_at`、`meta.version`を確認します。

## 6. Timer有効化

手動送信と公開反映に成功した後だけ実行します。

```bash
sudo systemctl enable --now herta-status-agent.timer
systemctl is-enabled herta-status-agent.timer
systemctl is-active herta-status-agent.timer
systemctl list-timers herta-status-agent.timer --all
```

1〜2分後に`last_received_at`が更新されれば完了です。

# 停止

```bash
sudo systemctl disable --now herta-status-agent.timer
```

Herta本体のPrisma migration、Compose、PostgreSQLの巻き戻しは不要です。
