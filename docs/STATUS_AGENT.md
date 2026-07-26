# ivrm-status-agent

## 目的

`ivrm-status-agent`は、AWS Lightsailホストだけに公開されているHerta Botの内部ヘルスを定期取得し、公開ステータス表示に必要な最小情報だけをOCI側の`status-ingest API`へ送信します。

```text
Herta Bot /healthz
    ↓ loopback HTTP
ivrm-status-agent
    ↓ HTTPS + HMAC-SHA256
OCI status-ingest API
    ↓
stats.ivrm.jp
```

このPRで実装する範囲は、Herta側の送信エージェント、署名仕様、systemd運用、テストです。

次は含みません。

- OCI側`status-ingest API`の実装・デプロイ
- `stats.ivrm.jp`の画面実装
- OCI DatabaseやObject Storageの構築
- インシデント履歴の保存
- CPU・メモリなどのインフラメトリクス送信

OCI側APIが未完成でも、`STATUS_DRY_RUN=true`で抽出payloadまで安全に確認できます。

## ファイル

| ファイル | 用途 |
| --- | --- |
| `deploy/scripts/ivrm-status-agent.sh` | ヘルス取得・最小化・署名・送信 |
| `deploy/scripts/ivrm-status-agent.test.sh` | 外部依存をモックした回帰テスト |
| `deploy/systemd/herta-status-agent.service` | 非特権oneshot service |
| `deploy/systemd/herta-status-agent.timer` | 1分間隔の定期実行 |
| `deploy/systemd/status-agent.env.example` | 本番環境変数例 |
| `.github/workflows/status-agent-ci.yml` | Shell・署名・systemd・安全設定の検証 |

## 送信する情報

内部`/healthz`から次だけを送ります。

- `schema_version`
- `service_id`
- `source`
- `observed_at`
- `sent_at`
- サービス全体の`status`
- Hertaの`version`
- 以下5項目の状態値
  - process
  - discord
  - database
  - redis
  - worker

送信例:

```json
{
  "checks": {
    "database": "ok",
    "discord": "ok",
    "process": "ok",
    "redis": "ok",
    "worker": "ok"
  },
  "observed_at": "2026-07-27T00:00:00.000Z",
  "schema_version": 1,
  "sent_at": "2026-07-27T00:00:01Z",
  "service_id": "herta-discord-bot",
  "source": "herta-production",
  "status": "operational",
  "version": "0.1.0"
}
```

payloadは`jq -cS`でキー順を固定した1行JSONにします。

## 送信しない情報

次の値は内部ヘルスに存在しても公開payloadへ含めません。

- Guild数
- Guild ID
- ユーザー・チャンネル情報
- 稼働時間
- Discord Gatewayの詳細状態
- heartbeat時刻
- DB・Redis・Workerのレイテンシ
- DB・Redis URL
- ホスト名・内部IP
- AWS・OCIの認証情報
- Discord Bot Token
- 例外メッセージ
- スタックトレース
- 環境変数一覧

エージェントは内部JSONをそのまま転送せず、許可フィールドから新しいJSONを生成します。

## 内部ヘルスの検証

送信前に以下を確認します。

- HTTPコードが`200`または`503`
- 応答本文が空ではない
- 応答サイズが既定`65536 bytes`以下
- `service.id`が`STATUS_SERVICE_ID`と一致
- `status`が既知の値
- `checked_at`が空ではない文字列
- 5つのcheckが既知の状態値

`/healthz`は`outage`または`unknown`でHTTP 503を返すため、503のJSONも正常にstatus-ingestへ転送します。

## HTTPS制約

`STATUS_INGEST_URL`は通常運用で`https://`だけを許可します。

HTTPは次の両方を満たすローカルテスト時だけ許可されます。

- `STATUS_ALLOW_HTTP_FOR_TESTS=true`
- URLが`http://127.0.0.1:*`または`http://localhost:*`

内部ヘルスも既定ではloopback URLだけを許可します。誤設定による任意URL取得を防ぐため、非loopback URLは拒否します。

## 署名仕様

### Headers

```http
Content-Type: application/json
X-IVRM-Signature-Version: v1
X-IVRM-Timestamp: 1785110401
X-IVRM-Nonce: 0123456789abcdef0123456789abcdef
X-IVRM-Signature: sha256=<64文字のhex>
```

### Canonical message

次のbyte列をHMAC対象にします。

```text
{X-IVRM-Timestamp}\n{X-IVRM-Nonce}\n{raw request body}
```

末尾に追加改行は付けません。

### Algorithm

```text
HMAC-SHA256(shared_secret, canonical_message)
```

署名は小文字hexで表し、Headerでは`sha256=`を付けます。

### 受信API側の必須検証

OCI側APIは最低限、次を実装してください。

1. `X-IVRM-Signature-Version`が`v1`
2. Timestampと現在時刻の差が既定5分以内
3. Nonceが32文字のhex
4. 同一Service・Nonceを再受信していない
5. raw bodyを使ってHMACを再計算
6. timing-safe compareで署名比較
7. `schema_version=1`
8. 登録済み`service_id`と`source`
9. payloadサイズ上限
10. 成功時だけ2xxを返す

Nonceは少なくとも10分保存し、同じNonceを拒否してください。

署名SecretはService単位で分離し、ログ・レスポンス・画面へ表示しないでください。

## エージェントの再送方針

1回の起動中は`curl --retry`で接続失敗や一時障害を再試行します。

既定値:

- 接続タイムアウト: 5秒
- 全体タイムアウト: 15秒
- 再試行: 2回
- timer間隔: 1分

送信に失敗したpayloadをディスクへ永続保存しません。理由は次の通りです。

- ステータス情報は最新観測値が重要
- 古いoutage payloadを遅延送信すると状態を逆戻りさせる可能性がある
- ディスクqueueの暗号化・上限・順序制御が不要になる

失敗時は非0終了し、次のtimer実行で最新状態を再取得します。

## 同時実行防止

`flock -n`で前回実行との重複を防ぎます。

前回処理が残っている場合、今回実行は正常終了扱いで省略します。

## systemd hardening

Serviceは専用の`herta-status-agent`ユーザーで実行します。

主な制限:

- `NoNewPrivileges=true`
- Capabilityなし
- Device非公開
- Home非公開
- System領域read-only
- Kernel・Control Group変更禁止
- Namespace作成禁止
- `/proc`情報を制限
- 実行可能address familyをUNIX・IPv4・IPv6へ限定
- メモリ128MB
- Tasks 32
- Secretファイルは`root:root 0600`

## ローカル・CIテスト

```bash
bash -n deploy/scripts/ivrm-status-agent.sh
bash -n deploy/scripts/ivrm-status-agent.test.sh
bash deploy/scripts/ivrm-status-agent.test.sh
```

テスト項目:

- operationalの送信
- outageのHTTP 503本文送信
- HMAC署名の再計算一致
- Guild数・Token・内部URL・レイテンシの非送信
- 不正JSON・別Service IDの拒否
- status-ingest非2xxの検出
- dry-runでPOSTしないこと
- HTTP ingestの拒否
- Secretを標準出力・標準エラーへ出さないこと

systemd unit:

```bash
systemd-analyze verify \
  deploy/systemd/herta-status-agent.service \
  deploy/systemd/herta-status-agent.timer
```

# マージ後の本番導入

## 0. 推奨マージ順

未マージの機能PRがある場合、次の順で1件ずつ本番確認してください。

1. Bot利用状況ダッシュボード
2. Guild監査ログビューア
3. ivrm-status-agent

`ivrm-status-agent`はアプリDBを変更しませんが、複数PRを連続マージするとDeploy Production失敗時の切り分けが難しくなります。

## 1. Deploy Productionを確認

`main`へのマージで通常の`Deploy Production`が起動します。

GitHubで次を確認します。

```text
Actions
→ Deploy Production
→ 最新Run
```

確認対象:

- Build and push production image
- SSH Deploy to Lightsail
- Cloudflare経由の外部Health check

今回の変更にPrisma migrationとアプリ環境変数追加はありません。

systemd unitはDeploy Productionでは自動配置・有効化されません。以下の手順をLightsail上で実行します。

## 2. 本番commitを確認

```bash
cd /app/herta

git log -1 --oneline
git status --short
```

マージcommitが反映され、tracked fileに変更がないことを確認します。

## 3. 必要コマンドを確認

```bash
for command_name in curl jq python3 flock systemctl; do
  command -v "${command_name}" || echo "missing: ${command_name}"
done
```

不足している場合:

```bash
sudo apt-get update
sudo apt-get install -y curl jq python3 util-linux
```

`flock`は`util-linux`に含まれます。

## 4. 内部ヘルスを確認

HTTP 200だけでなくoutage時の503本文も確認できる形式で実行します。

```bash
curl -sS \
  --output /tmp/herta-health.json \
  --write-out 'HTTP %{http_code}\n' \
  http://127.0.0.1:3000/healthz

jq . /tmp/herta-health.json
rm -f /tmp/herta-health.json
```

確認項目:

- JSONである
- `service.id`が`herta-discord-bot`
- `status`が既知の値
- `checks.process`から`checks.worker`まで存在

## 5. 専用ユーザーを作成

```bash
if ! id herta-status-agent >/dev/null 2>&1; then
  sudo useradd \
    --system \
    --no-create-home \
    --home-dir /nonexistent \
    --shell /usr/sbin/nologin \
    herta-status-agent
fi

id herta-status-agent
```

sudo権限、Docker group、ログインShellは付与しません。

## 6. 環境ファイルを作成

```bash
sudo install -d \
  --owner root \
  --group root \
  --mode 0700 \
  /etc/herta

sudo install \
  --owner root \
  --group root \
  --mode 0600 \
  /app/herta/deploy/systemd/status-agent.env.example \
  /etc/herta/status-agent.env
```

編集:

```bash
sudoedit /etc/herta/status-agent.env
```

最低限、次を実値へ変更します。

```dotenv
STATUS_INGEST_URL=https://OCI側の実URL/v1/observations
STATUS_SIGNING_SECRET=受信APIと共有する32文字以上のSecret
STATUS_SERVICE_ID=herta-discord-bot
STATUS_SOURCE=herta-production
```

Secret生成例:

```bash
openssl rand -hex 32
```

生成値はパスワードマネージャーなど安全な経路でOCI受信側へ設定します。Issue、PR、Slack、Shell履歴へ貼り付けないでください。

権限確認:

```bash
sudo stat -c '%U:%G %a %n' /etc/herta/status-agent.env
```

期待値:

```text
root:root 600 /etc/herta/status-agent.env
```

## 7. systemd unitを配置

```bash
sudo install \
  --owner root \
  --group root \
  --mode 0644 \
  /app/herta/deploy/systemd/herta-status-agent.service \
  /etc/systemd/system/herta-status-agent.service

sudo install \
  --owner root \
  --group root \
  --mode 0644 \
  /app/herta/deploy/systemd/herta-status-agent.timer \
  /etc/systemd/system/herta-status-agent.timer

sudo systemctl daemon-reload
sudo systemd-analyze verify \
  /etc/systemd/system/herta-status-agent.service \
  /etc/systemd/system/herta-status-agent.timer
```

## 8. dry-runを実行

OCI側APIが未完成でも実行できます。

```bash
sudo sed -i 's/^STATUS_DRY_RUN=.*/STATUS_DRY_RUN=true/' \
  /etc/herta/status-agent.env

sudo systemctl start herta-status-agent.service
sudo systemctl status herta-status-agent.service --no-pager
sudo journalctl -u herta-status-agent.service -n 50 --no-pager
```

期待するログ:

```text
dry-runのため外部送信を行いません
```

表示payloadに以下がないことを確認します。

- `guild_count`
- `uptime_seconds`
- `latency_ms`
- `connected`
- `gateway_status`
- URL、Token、Secret

## 9. 実送信を手動確認

OCI側API、TLS、Secret、Service登録が完了してから実施します。

```bash
sudo sed -i 's/^STATUS_DRY_RUN=.*/STATUS_DRY_RUN=false/' \
  /etc/herta/status-agent.env

sudo systemctl start herta-status-agent.service
sudo systemctl status herta-status-agent.service --no-pager
sudo journalctl -u herta-status-agent.service -n 50 --no-pager
```

期待するログ:

```text
ステータス送信に成功しました。HTTP 2xx
```

受信側で次を確認します。

- HMAC検証成功
- `service_id=herta-discord-bot`
- `source=herta-production`
- `observed_at`が内部ヘルスの確認時刻
- `sent_at`が送信時刻
- statusと5つのcheckだけが保存される
- Nonceが再利用されていない

## 10. timerを有効化

手動送信成功後だけ有効化します。

```bash
sudo systemctl enable --now herta-status-agent.timer

systemctl list-timers herta-status-agent.timer --all
systemctl status herta-status-agent.timer --no-pager
```

1〜2分待って確認します。

```bash
sudo journalctl \
  -u herta-status-agent.service \
  --since '5 minutes ago' \
  --no-pager
```

受信API側でも1分間隔で最新観測が更新されることを確認します。

## 11. Hardeningを確認

```bash
systemd-analyze security herta-status-agent.service

systemctl show herta-status-agent.service \
  -p User \
  -p Group \
  -p NoNewPrivileges \
  -p ProtectSystem \
  -p ProtectHome \
  -p CapabilityBoundingSet \
  -p MemoryMax \
  -p TasksMax
```

確認値:

```text
User=herta-status-agent
Group=herta-status-agent
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
CapabilityBoundingSet=
MemoryMax=134217728
TasksMax=32
```

## 12. 最終確認

```bash
systemctl is-enabled herta-status-agent.timer
systemctl is-active herta-status-agent.timer
systemctl list-timers herta-status-agent.timer --all
sudo journalctl -u herta-status-agent.service -n 100 --no-pager
```

期待値:

- timer: enabled
- timer: active
- serviceの直近実行: exit code 0
- status-ingest: 2xx
- stats側の最終更新: 2分以内

# 運用

## ログ確認

```bash
sudo journalctl -u herta-status-agent.service -n 100 --no-pager
```

リアルタイム:

```bash
sudo journalctl -u herta-status-agent.service -f
```

失敗だけ:

```bash
sudo journalctl \
  -u herta-status-agent.service \
  --since today \
  -p warning \
  --no-pager
```

## 手動再送

```bash
sudo systemctl start herta-status-agent.service
```

古いpayloadは再送せず、毎回内部ヘルスを再取得します。

## 設定変更

```bash
sudoedit /etc/herta/status-agent.env
sudo systemctl start herta-status-agent.service
```

oneshot serviceのため、設定変更後の`restart`は不要です。次回実行から新設定を読みます。

## Secretローテーション

推奨順序:

1. OCI受信側で新旧2つのSecretを一時許可
2. Lightsailの`STATUS_SIGNING_SECRET`を新Secretへ更新
3. 手動送信して2xxを確認
4. timerの次回送信を確認
5. OCI側から旧Secretを削除

新旧併用時間は短くしてください。

# トラブルシューティング

## exit code 2

設定・依存コマンドエラーです。

主な原因:

- 必須環境変数なし
- Secretが32文字未満
- Service ID・Sourceの形式不正
- ingest URLがHTTPSではない
- health URLがloopbackではない
- 数値設定が不正
- curl、jq、python3、flock不足

```bash
sudo systemctl status herta-status-agent.service --no-pager
sudo journalctl -u herta-status-agent.service -n 100 --no-pager
```

## exit code 3

内部ヘルス取得・検証エラーです。

```bash
curl -sS \
  -o /tmp/herta-health.json \
  -w '%{http_code}\n' \
  http://127.0.0.1:3000/healthz
jq . /tmp/herta-health.json
```

Botコンテナ:

```bash
cd /app/herta

docker compose \
  --env-file .env.production \
  -f docker-compose.prod.yml \
  ps bot

docker compose \
  --env-file .env.production \
  -f docker-compose.prod.yml \
  logs --tail=100 bot
```

## exit code 4

OCI側への送信エラーです。

主な原因:

- DNS・TLS・Firewall
- Endpoint誤り
- Timestamp許容差
- Secret不一致
- Signature canonicalization不一致
- Nonce重複判定
- Schema・Service未登録
- rate limit

エージェントは受信レスポンス本文をログへ出さず、HTTPコードだけを記録します。詳細はOCI側の安全なrequest ID付きログで確認してください。

## 前回実行中で省略される

```text
前回のstatus-agentが実行中のため今回の送信を省略します
```

タイムアウト既定は15秒、timer間隔は1分なので、通常は重複しません。

長時間残る場合:

```bash
systemctl status herta-status-agent.service --no-pager
ps -ef | grep '[i]vrm-status-agent'
```

# 停止

```bash
sudo systemctl disable --now herta-status-agent.timer
sudo systemctl stop herta-status-agent.service || true
```

停止確認:

```bash
systemctl is-enabled herta-status-agent.timer || true
systemctl is-active herta-status-agent.timer || true
```

# ロールバック・削除

この実装にはDB migration、Docker Compose変更、アプリ環境変数変更がありません。

問題時はtimerを停止するだけで外部送信を止められます。

完全削除:

```bash
sudo systemctl disable --now herta-status-agent.timer || true
sudo rm -f \
  /etc/systemd/system/herta-status-agent.service \
  /etc/systemd/system/herta-status-agent.timer
sudo systemctl daemon-reload
sudo systemctl reset-failed
sudo rm -f /etc/herta/status-agent.env
sudo userdel herta-status-agent || true
```

Repositoryのcode/imageを戻す必要はありません。

main自体を戻す場合もDB rollbackは不要です。
