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

Agentは次を拒否します。

- `stats.ivrm.jp`以外のHost
- HTTPS以外
- 443以外の本番Port
- `/api/internal/status-ingest`以外のPath
- query、fragment、userinfo付きURL

HTTPは、loopbackを使用する自動テストで明示的に許可した場合だけ利用できます。

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

- curlで一時的な接続障害を再試行
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

以前チャットやShellへ表示したSecretは使用せず、新しいSecretを設定します。Secretをコマンド引数、`sudo env`、Shell historyへ直接含めません。

## 1. OCI側Secret

既存Status APIの環境ファイルです。

```text
/opt/ivrm/compose/ivrm-status-api/.env
```

新しい64文字hex Secretをパスワードマネージャー等で生成し、非表示入力します。

```bash
read -rsp '新しいHERTA_INGEST_SECRET: ' HERTA_INGEST_SECRET
printf '\n'

if [ "${#HERTA_INGEST_SECRET}" -lt 32 ]; then
  echo 'ERROR: Secretは32文字以上必要です'
  unset HERTA_INGEST_SECRET
  return 1 2>/dev/null || exit 1
fi
```

Secretを標準入力経由でroot処理へ渡します。値は`sudo`の引数やプロセス一覧へ現れません。

```bash
SECRET_UPDATER="$(mktemp)"
chmod 700 "${SECRET_UPDATER}"

cat > "${SECRET_UPDATER}" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
key = sys.argv[2]
secret = sys.stdin.read()
if len(secret) < 32:
    raise SystemExit('secret must be at least 32 characters')

lines = path.read_text(encoding='utf-8').splitlines() if path.exists() else []
output = []
found = False
for line in lines:
    if line.startswith(key + '='):
        output.append(f'{key}={secret}')
        found = True
    else:
        output.append(line)
if not found:
    output.append(f'{key}={secret}')
path.write_text('\n'.join(output) + '\n', encoding='utf-8')
PY

printf '%s' "${HERTA_INGEST_SECRET}" |
  sudo python3 "${SECRET_UPDATER}" \
    /opt/ivrm/compose/ivrm-status-api/.env \
    HERTA_INGEST_SECRET

rm -f "${SECRET_UPDATER}"
unset HERTA_INGEST_SECRET

sudo chown root:root /opt/ivrm/compose/ivrm-status-api/.env
sudo chmod 600 /opt/ivrm/compose/ivrm-status-api/.env
```

Secretを表示せず、設定有無と長さだけ確認します。

```bash
sudo awk -F= '
  $1 == "HERTA_INGEST_SECRET" {
    print $1 "=<redacted:" length($2) "文字>"
  }
' /opt/ivrm/compose/ivrm-status-api/.env
```

Status APIだけを再作成します。CaddyとMinecraftは再起動しません。

```bash
sudo docker compose \
  --project-directory /opt/ivrm/compose/ivrm-status-api \
  -f /opt/ivrm/compose/ivrm-status-api/docker-compose.yml \
  up -d --force-recreate status-api

sudo docker compose \
  --project-directory /opt/ivrm/compose/ivrm-status-api \
  -f /opt/ivrm/compose/ivrm-status-api/docker-compose.yml \
  ps
```

## 2. Lightsail側Secret・送信先

OCIと同じSecretを非表示入力します。

```bash
read -rsp 'OCIと同じHERTA_INGEST_SECRET: ' NEW_SECRET
printf '\n'

if [ "${#NEW_SECRET}" -lt 32 ]; then
  echo 'ERROR: Secretは32文字以上必要です'
  unset NEW_SECRET
  return 1 2>/dev/null || exit 1
fi
```

Secretは標準入力、Secret以外の設定値は固定値として更新します。

```bash
SECRET_UPDATER="$(mktemp)"
chmod 700 "${SECRET_UPDATER}"

cat > "${SECRET_UPDATER}" <<'PY'
from pathlib import Path
import sys

path = Path('/etc/herta/status-agent.env')
secret = sys.stdin.read()
if len(secret) < 32:
    raise SystemExit('secret must be at least 32 characters')

replacements = {
    'STATUS_INGEST_URL': 'https://stats.ivrm.jp/api/internal/status-ingest',
    'STATUS_SIGNING_SECRET': secret,
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

printf '%s' "${NEW_SECRET}" |
  sudo python3 "${SECRET_UPDATER}"

rm -f "${SECRET_UPDATER}"
unset NEW_SECRET

sudo chown root:root /etc/herta/status-agent.env
sudo chmod 600 /etc/herta/status-agent.env
```

Secretを伏せて確認します。

```bash
sudo awk -F= '
  $1 == "STATUS_SIGNING_SECRET" {
    print $1 "=<redacted:" length($2) "文字>"
    next
  }
  $1 == "STATUS_INGEST_URL" ||
  $1 == "STATUS_SERVICE_ID" ||
  $1 == "STATUS_DRY_RUN" {
    print
  }
' /etc/herta/status-agent.env
```

## 3. Agent更新

```bash
cd /app/herta
git fetch origin main
git switch main
git pull --ff-only origin main

git log -1 --oneline
```

Unit自体に変更がなくても、実配置と検証を再実行します。

```bash
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
systemctl is-enabled herta-status-agent.timer || true
systemctl is-active herta-status-agent.timer || true

sudo systemctl start herta-status-agent.service

systemctl show herta-status-agent.service \
  -p Result \
  -p ExecMainStatus \
  -p ActiveState \
  -p SubState

sudo journalctl \
  -u herta-status-agent.service \
  -n 100 \
  --no-pager
```

期待値:

```text
Result=success
ExecMainStatus=0
ステータス送信に成功しました。HTTP 202
```

oneshotの正常終了後に`ActiveState=inactive`、`SubState=dead`となるのは正常です。

## 5. 公開反映

```bash
curl -fsS https://stats.ivrm.jp/api/status.json |
  python3 -m json.tool
```

`herta-discord-bot`の次を確認します。

- `status`が`unknown`以外
- `checked_at`が直近時刻
- `last_received_at`が直近時刻
- `meta.version`がHertaのversion

OCI側ログ:

```bash
sudo docker logs \
  --since=10m \
  ivrm-status-api
```

`status_ingest_accepted`が記録され、Secret・署名・本文全文が出ていないことを確認します。

## 6. Timer有効化

手動送信と公開反映に成功した後だけ実行します。

```bash
sudo systemctl enable --now herta-status-agent.timer
systemctl is-enabled herta-status-agent.timer
systemctl is-active herta-status-agent.timer
systemctl list-timers herta-status-agent.timer --all
```

1〜2分後に`last_received_at`が更新されれば完了です。

# 不要になったOCI試作物の整理

独立status-ingestコンテナを一度も起動していないことを確認します。

```bash
sudo docker ps -a --filter name=herta-status-ingest
```

結果が空なら、ローカルBuildした試作イメージと空ディレクトリを削除できます。

```bash
sudo docker image rm \
  herta-status-ingest:f5d82dab35861e91d43eedafbf86d48744c9f8ae \
  herta-status-ingest:a765d1bf38d008dfcc2ce3b4ef84d0997878fa68 \
  2>/dev/null || true

sudo rm -rf /opt/ivrm-status
```

`/opt/herta-src`は調査用cloneとして残しても、削除しても既存Status APIには影響しません。

# 停止

```bash
sudo systemctl disable --now herta-status-agent.timer
```

Herta本体のPrisma migration、Compose、PostgreSQLの巻き戻しは不要です。
