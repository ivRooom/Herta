# OCI status-ingest 復旧・導入手順

## この手順を使う条件

次の状態から復旧する場合に使用します。

- OCIホストがOracle Linux系で`git`が未導入
- `/opt/herta-src`が空のまま作成済み
- `/opt/ivrm-status`が`root:root 0750`で一般ユーザーから`cd`できない
- GHCR loginが`denied`になる
- `stats.ivrm.jp`ですでに別のステータスAPIが稼働している
- SecretをShellのprompt文字列やチャットへ直接書いてしまった

## 重要な方針

既存の`stats.ivrm.jp`はMinecraftを含むステータスAPIを配信しているため、DNSをOCI status-ingestへ向け直しません。

status-ingestは次の専用ホストへ分離します。

```text
status-ingest.ivrm.jp
```

Lightsailの送信先は次です。

```text
https://status-ingest.ivrm.jp/v1/observations
```

`STATUS_PUBLIC_CORS_ORIGIN`は既存ステータス画面向けに`https://stats.ivrm.jp`のままとします。

## 1. 漏えいしたSecretを破棄

チャット、Shell command、Shell historyへ表示したSecretは使用しません。

新しいSecretはパスワードマネージャー等で64文字hexとして生成し、入力値を画面へ表示しない`read -s`でOCIとLightsailへ設定します。

正しい入力例:

```bash
read -rsp '新しいSTATUS_SIGNING_SECRET: ' STATUS_SIGNING_SECRET
printf '\n'
```

promptの引用符内へSecretそのものを書いてはいけません。prompt表示後にSecretを入力してEnterを押します。

長さ確認:

```bash
if [ "${#STATUS_SIGNING_SECRET}" -lt 32 ]; then
  echo 'ERROR: 32文字以上必要です'
  unset STATUS_SIGNING_SECRET
  exit 1
fi
```

## 2. Oracle LinuxへGitを導入

OS確認:

```bash
cat /etc/os-release
```

Oracle Linux、RHEL、Rocky Linux、AlmaLinux系:

```bash
sudo dnf install -y git
```

`dnf`がない場合:

```bash
sudo yum install -y git
```

確認:

```bash
git --version
```

## 3. Repositoryを正しいcommitへ固定

PR #69のmerge commit:

```text
f5d82dab35861e91d43eedafbf86d48744c9f8ae
```

空ディレクトリをいったん削除し、cloneし直します。

```bash
sudo rm -rf /opt/herta-src
sudo install -d --owner "$USER" --group "$USER" --mode 0750 /opt/herta-src

git clone https://github.com/ivRooom/Herta.git /opt/herta-src
cd /opt/herta-src
git checkout --detach f5d82dab35861e91d43eedafbf86d48744c9f8ae
git log -1 --oneline
```

## 4. GHCRを使わないローカルbuild

GHCR loginが`denied`の場合でも、公開Repositoryの同一commitからOCI上でbuildできます。

```bash
cd /opt/herta-src
sudo docker build \
  --tag herta-status-ingest:f5d82dab35861e91d43eedafbf86d48744c9f8ae \
  services/status-ingest
```

確認:

```bash
sudo docker image inspect \
  herta-status-ingest:f5d82dab35861e91d43eedafbf86d48744c9f8ae \
  --format '{{.Id}}'
```

ローカルbuildを使用する場合は`docker compose pull`を実行しません。

## 5. 配置

`/opt/ivrm-status`はroot所有のまま運用します。一般ユーザーが`cd`できないのは想定どおりです。

```bash
sudo install -d --owner root --group root --mode 0750 /opt/ivrm-status

sudo install \
  --owner root \
  --group root \
  --mode 0644 \
  /opt/herta-src/services/status-ingest/docker-compose.yml \
  /opt/ivrm-status/docker-compose.yml

sudo install \
  --owner root \
  --group root \
  --mode 0644 \
  /opt/herta-src/services/status-ingest/Caddyfile \
  /opt/ivrm-status/Caddyfile
```

確認:

```bash
sudo ls -la /opt/ivrm-status
```

## 6. OCI環境ファイル

```bash
STATUS_ENV_TMP="$(mktemp)"
chmod 600 "$STATUS_ENV_TMP"

cat > "$STATUS_ENV_TMP" <<EOF
STATUS_INGEST_IMAGE=herta-status-ingest:f5d82dab35861e91d43eedafbf86d48744c9f8ae
STATUS_PUBLIC_HOST=status-ingest.ivrm.jp
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
STATUS_REQUEST_BODY_TIMEOUT_SECONDS=10
STATUS_PUBLIC_CORS_ORIGIN=https://stats.ivrm.jp
LOG_LEVEL=INFO
EOF

sudo install \
  --owner root \
  --group root \
  --mode 0600 \
  "$STATUS_ENV_TMP" \
  /opt/ivrm-status/.env

rm -f "$STATUS_ENV_TMP"
unset STATUS_SIGNING_SECRET
```

権限確認:

```bash
sudo stat -c '%U:%G %a %n' /opt/ivrm-status/.env
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

## 7. DNS

Cloudflare等で次のRecordを追加します。

```text
Type: A
Name: status-ingest
Content: OCI VMのpublic IPv4
Proxy: DNS onlyで初回TLS確認後、必要に応じてProxied
```

既存の`stats.ivrm.jp` Recordは変更しません。

OCI Security ListまたはNSGとOS firewallでTCP 80 / 443を許可します。

## 8. Compose起動

root所有ディレクトリへ一般ユーザーが`cd`せず、`--project-directory`を使用します。

```bash
sudo docker compose \
  --project-directory /opt/ivrm-status \
  -f /opt/ivrm-status/docker-compose.yml \
  config --quiet

sudo docker compose \
  --project-directory /opt/ivrm-status \
  -f /opt/ivrm-status/docker-compose.yml \
  up -d

sudo docker compose \
  --project-directory /opt/ivrm-status \
  -f /opt/ivrm-status/docker-compose.yml \
  ps
```

ローカルimage利用時は`pull`しません。

ログ:

```bash
sudo docker compose \
  --project-directory /opt/ivrm-status \
  -f /opt/ivrm-status/docker-compose.yml \
  logs --tail=100 status-ingest caddy
```

## 9. 確認

DNS反映前のコンテナ内部確認:

```bash
sudo docker compose \
  --project-directory /opt/ivrm-status \
  -f /opt/ivrm-status/docker-compose.yml \
  exec -T status-ingest \
  python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=3).read().decode())"
```

DNSとTLS反映後:

```bash
curl -fsS https://status-ingest.ivrm.jp/healthz | python3 -m json.tool
curl -fsS https://status-ingest.ivrm.jp/api/status.json | python3 -m json.tool
```

初回観測前は`status=unknown`で正常です。

## 10. Lightsail送信先

Lightsailの`/etc/herta/status-agent.env`では次へ変更します。

```text
STATUS_INGEST_URL=https://status-ingest.ivrm.jp/v1/observations
STATUS_DRY_RUN=false
```

OCIと同じ新Secretを非表示入力で設定し、手動送信がHTTP 202になった後だけtimerを有効化します。

## GHCR認証を後で直す場合

`denied`の主な確認項目:

- usernameが空でない
- classic PATに`read:packages`がある
- Tokenの所有者が`ivRooom/Herta`とPackageへアクセスできる
- OrganizationでSSO認可が必要な場合はTokenをAuthorizeしている
- GitHub ActionsのPublish jobが完了しPackageが作成済み

認証を直した後はSHA tagへ切り替え、`docker compose pull`して再作成できます。
