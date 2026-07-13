# Cloudflare Origin保護

Herta本番環境はCloudflareからAWS Lightsail上のCaddyへ接続します。`Full (strict)`とOrigin CertificateだけではOrigin IPへの直接アクセスを防げないため、Authenticated Origin Pulls（AOP）とネットワークallowlistを併用します。

## 採用方針

1. Cloudflareは`Full (strict)`を維持する
2. CaddyでCloudflareのクライアント証明書を検証する
3. Lightsail / OS Firewallでは80・443をCloudflare公開IPレンジだけに限定する
4. SSHは管理元IPまたは別の安全な管理経路だけに限定する
5. Origin制限完了前は`CF-Connecting-IP`を認証・認可の根拠に使用しない

AOPのGlobal証明書はCloudflareネットワークから来たことを証明します。アカウント固有性が必要になった場合は、Zone-levelまたはPer-hostname AOPへ移行します。

## 事前準備

本番サーバーで次を確認します。

```bash
cd /app/herta

test -f .env.production
test -f certs/origin.pem
test -f certs/origin-key.pem

docker compose --env-file .env.production -f docker-compose.prod.yml ps
```

## AOP用CAとCaddy設定の準備

```bash
cd /app/herta
bash deploy/scripts/enable-origin-protection.sh --prepare
```

この処理は以下を行います。

- Cloudflare公式のAuthenticated Origin Pull CAを取得
- X.509証明書として解析できることを確認
- `certs/cloudflare-origin-pull-ca.pem`へ権限制限付きで配置
- `deploy/docker/caddy/Caddyfile.aop`をCaddyで検証

CA証明書は公開情報であり秘密鍵ではありません。ただし、取得元URLを変更する場合は信頼できる配布元だけを使用してください。

## 有効化順序

順序を逆にするとCloudflare経由のアクセスまで停止します。

1. `--prepare`を完了
2. Cloudflare管理画面で対象ゾーンのAuthenticated Origin Pullsを有効化
3. Cloudflare経由の現行health checkが成功していることを確認
4. 本番サーバーでAOP対応Caddyfileを有効化
5. Cloudflare経由・Origin直アクセス・OAuthを確認

```bash
cd /app/herta
bash deploy/scripts/enable-origin-protection.sh --activate
```

## 動作確認

### Cloudflare経由

```bash
curl --fail --show-error --silent https://herta.ivrm.jp/api/v1/health
curl -I https://herta.ivrm.jp/login
```

期待結果は`200`です。

### Origin直アクセス

Cloudflareのクライアント証明書を持たない接続はTLS handshakeで拒否される必要があります。

```bash
curl -vk --resolve herta.ivrm.jp:443:ORIGIN_IP https://herta.ivrm.jp/api/v1/health
```

期待結果はTLS client certificate関連の失敗です。HTTP `200`が返る場合は保護が有効ではありません。

### アプリ内部health check

AOP有効後、Origin上の通常curlはクライアント証明書を持たないためCaddyのHTTPS経路を通せません。内部確認はDocker network内のAPI health endpointを使います。

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml \
  exec -T api curl -fsS http://127.0.0.1:3001/api/v1/health
```

## Firewall

AOPに加えて、Lightsail NetworkingとOS Firewallで80・443の送信元をCloudflare公開IPレンジへ限定します。

作業時の注意:

- SSH許可ルールを先に固定する
- 現在のSSHセッションを維持したまま別セッションで接続確認する
- CloudflareのIPv4・IPv6レンジを両方反映する
- Cloudflareの公開レンジ更新を定期確認する
- 変更前のルールを保存し、即時復旧できるようにする

Firewall変更は接続不能を引き起こす可能性があるため、このリポジトリの自動デプロイからは実行しません。

## Cloudflare側の確認項目

- DNSレコードがProxy有効
- SSL/TLS modeが`Full (strict)`
- Always Use HTTPS有効
- Minimum TLS Version確認
- Authenticated Origin Pulls有効
- Managed WAF Rules有効
- `/api/auth/*`、`/api/guilds/*`、`/api/v1/*`のRate Limiting検討
- `/api/v1/health`を過剰制限しない

## ロールバック

Cloudflare経由で接続できなくなった場合は、Lightsailの管理接続から次を実行します。

```bash
cd /app/herta
bash deploy/scripts/enable-origin-protection.sh --rollback
```

その後、Cloudflare側のAOPを無効化し、次を確認します。

```bash
curl --fail --show-error --silent https://herta.ivrm.jp/api/v1/health
docker compose --env-file .env.production -f docker-compose.prod.yml logs --tail=100 caddy
```

`Caddyfile.rollback`には切替直前の設定が保存されます。Origin Certificateや秘密鍵は変更しません。

## 証明書更新

Cloudflare AOP CAまたはアカウント固有クライアント証明書を更新する場合は、旧証明書を削除する前に新旧両方を信頼する移行期間を設けます。更新後は以下を確認します。

- Cloudflare経由でhealth check成功
- Origin直アクセス失敗
- OAuth callback成功
- Discord Bot・Worker・APIに異常ログがない
- HTTP/2・HTTP/3が維持されている
