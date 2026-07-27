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

Agentは次のURLだけを許可します。

- scheme: `https`
- host: `stats.ivrm.jp`
- port: 省略または`443`
- path: `/api/internal/status-ingest`
- query、fragment、userinfoなし

HTTPはloopbackを使用する自動テストで明示的に許可した場合だけ利用できます。

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

以前チャットやShellへ表示したSecretは再利用しません。Secretをコマンド引数、`sudo env`、Shell履歴へ直接含めません。

## 0. LightsailのTimerを停止

**OCI側Secretを変更する前に**Lightsailへ接続し、旧Secretでの自動送信を停止します。

```bash
sudo systemctl disable --now herta-status-agent.timer 2>/dev/null || true
systemctl is-enabled herta-status-agent.timer || true
systemctl is-active herta-status-agent.timer || true
```

期待値:

```text
disabled
inactive
```

Timerは手動送信と公開反映が成功するまで有効化しません。

## 1. OCI側Secret

既存Status APIの環境ファイルを更新します。

```text
/opt/ivrm/compose/ivrm-status-api/.env
```

OCIへ接続し、次を実行します。

```bash
set -euo pipefail
sudo -v

read -rsp '新しいHERTA_INGEST_SECRET: ' HERTA_INGEST_SECRET
printf '\n'

if ! [[ "${HERTA_INGEST_SECRET}" =~ ^[0-9a-fA-F]{64}$ ]]; then
  echo 'ERROR: Secretは64文字のhexで入力してください'
  unset HERTA_INGEST_SECRET
  return 1 2>/dev/null || exit 1
fi

printf '%s\n' "${HERTA_INGEST_SECRET}" |
  sudo -n sh -c 'umask 077; cat > /run/herta-ingest-secret'
unset HERTA_INGEST_SECRET

sudo -n python3 - <<'PY'
from pathlib import Path

secret_path = Path('/run/herta-ingest-secret')
env_path = Path('/opt/ivrm/compose/ivrm-status-api/.env')
key = 'HERTA_INGEST_SECRET'

try:
    value = secret_path.read_text(encoding='utf-8').strip()
    if len(value) != 64 or any(character not in '0123456789abcdefABCDEF' for character in value):
        raise SystemExit('ERROR: Secret形式が不正です')

    lines = env_path.read_text(encoding='utf-8').splitlines() if env_path.exists() else []
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

    env_path.write_text('\n'.join(output) + '\n', encoding='utf-8')
finally:
    secret_path.unlink(missing_ok=True)
PY

sudo -n chown root:root /opt/ivrm/compose/ivrm-status-api/.env
sudo -n chmod 600 /opt/ivrm/compose/ivrm-status-api/.env
sudo -n stat -c '%U:%G %a %n' /opt/ivrm/compose/ivrm-status-api/.env
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

Lightsailへ戻り、OCIと同じSecretを非表示入力します。Timerが停止していることを再確認します。

```bash
set -euo pipefail
sudo -v

systemctl is-enabled herta-status-agent.timer || true
systemctl is-active herta-status-agent.timer || true

read -rsp 'OCIと同じHERTA_INGEST_SECRET: ' NEW_SECRET
printf '\n'

if ! [[ "${NEW_SECRET}" =~ ^[0-9a-fA-F]{64}$ ]]; then
  echo 'ERROR: Secretは64文字のhexで入力してください'
  unset NEW_SECRET
  return 1 2>/dev/null || exit 1
fi

printf '%s\n' "${NEW_SECRET}" |
  sudo -n sh -c 'umask 077; cat > /run/herta-status-agent-secret'
unset NEW_SECRET

sudo -n python3 - <<'PY'
from pathlib import Path

secret_path = Path('/run/herta-status-agent-secret')
env_path = Path('/etc/herta/status-agent.env')

try:
    value = secret_path.read_text(encoding='utf-8').strip()
    if len(value) != 64 or any(character not in '0123456789abcdefABCDEF' for character in value):
        raise SystemExit('ERROR: Secret形式が不正です')

    replacements = {
        'STATUS_INGEST_URL': 'https://stats.ivrm.jp/api/internal/status-ingest',
        'STATUS_SIGNING_SECRET': value,
        'STATUS_SERVICE_ID': 'herta-discord-bot',
        'STATUS_DRY_RUN': 'false',
    }

    lines = env_path.read_text(encoding='utf-8').splitlines()
    output = []
    found = set()
    for line in lines:
        key = line.split('=', 1)[0]
        if key in replacements:
            output.append(f'{key}={replacements[key]}')
            found.add(key)
        else:
            output.append(line)
    for key, replacement in replacements.items():
        if key not in found:
            output.append(f'{key}={replacement}')

    env_path.write_text('\n'.join(output) + '\n', encoding='utf-8')
finally:
    secret_path.unlink(missing_ok=True)
PY

sudo -n chown root:root /etc/herta/status-agent.env
sudo -n chmod 600 /etc/herta/status-agent.env
sudo -n stat -c '%U:%G %a %n' /etc/herta/status-agent.env
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

PRのマージと`Deploy Production`成功後に実行します。

```bash
cd /app/herta
git fetch origin main
git switch main
git pull --ff-only origin main

git log -1 --oneline

test -f deploy/scripts/ivrm-status-agent.sh
test -f deploy/systemd/herta-status-agent.service
test -f deploy/systemd/herta-status-agent.timer

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

## 7. 不要になったOCI試作物の整理

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
