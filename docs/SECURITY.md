# Herta. セキュリティ運用

## 基本方針

- Secret、Token、秘密鍵をGitへコミットしない
- 本番APIは必要最小限の経路・権限だけを公開する
- Discord Guildの管理権限は操作ごとにDiscord APIで再確認する
- Plugin設定やDB値をJavaScript / TypeScriptとして評価しない
- 1つのPlugin障害をBot全体へ波及させない

## Secretローテーション

Secretがチャット、ログ、Issue、画面共有などへ露出した可能性がある場合は、削除だけでなく必ず再発行する。

優先してローテーションするもの:

1. Cloudflare Origin Certificateと秘密鍵
2. Discord Bot Token
3. Discord OAuth Client Secret
4. `NEXTAUTH_SECRET` / `AUTH_SECRET`
5. PostgreSQLパスワードと`DATABASE_URL`
6. `JWT_SECRET` / `JWT_REFRESH_SECRET` / `INTERNAL_JWT_SECRET`
7. Lightsail SSH鍵

ローテーション後は、旧Credentialが無効であることと、Botログイン・OAuth・DB接続・Health checkが成功することを確認する。

## CloudflareとOrigin保護

`Full (strict)`とCloudflare Origin Certificateは、CloudflareからOriginまでのTLSを検証するための構成であり、Originへの直接アクセスを自動的に禁止するものではない。

本番では次を併用する。

- Cloudflare Authenticated Origin Pullsを有効化し、CaddyでCloudflareのクライアント証明書を検証する
- Lightsail / OS FirewallでCloudflareの公開IPレンジだけを80/443へ許可する

リポジトリには以下を用意している。

- `deploy/docker/caddy/Caddyfile.aop`: AOPのクライアント証明書検証設定
- `deploy/scripts/enable-origin-protection.sh`: CA取得、設定検証、有効化、ロールバック
- `docs/ORIGIN_PROTECTION.md`: 導入・検証・復旧手順

Cloudflare管理画面とFirewall側の設定が完了するまでは、通常の`Caddyfile`から自動切替しない。順序を誤るとCloudflare経由の通信も停止するためである。

Origin制限が完了するまでは、`CF-Connecting-IP`やそれを転送した`X-Real-IP`を認証・認可・厳密なレート制限の根拠にしない。Originへ直接到達できる攻撃者がヘッダーを偽装できるためである。

Cloudflare側では以下も確認する。

- SSL/TLS mode: `Full (strict)`
- Always Use HTTPS
- Minimum TLS Version
- Authenticated Origin Pulls
- Managed WAF Rules
- Bot / Rate Limiting Rules
- DNSレコードがProxy有効になっていること
- Origin IPが不要な場所へ公開されていないこと

## API

- 本番CORSは`CORS_ORIGINS`へ明示したOriginだけを許可する
- Credentials付きCORSで`*`を使用しない
- Swaggerは本番でデフォルト無効。調査時だけ`ENABLE_SWAGGER=true`にし、終了後に戻す
- 入力値はDTO / Zod / JSON Schema等で検証する
- 内部例外・Stack Trace・Tokenを利用者向けレスポンスへ含めない
- Graceful shutdown時にDB・Redis・Queueを安全に閉じる

## Studio / Discord OAuth

- Discord access tokenとrefresh tokenはクライアントSessionへ含めない
- Guild管理APIはログイン確認だけでなく、対象GuildのAdministrator / Manage Guild権限を毎回再確認する
- 権限確認レスポンスを共有Cacheへ保存しない
- OAuth Redirect URIは開発・本番で明示的に登録する
- 本番CookieはSecure / HttpOnly / SameSite設定を維持する

## Discord Bot

- 現在のSlash Command Runtimeでは`Guilds` Intentだけを要求する
- Guild Members、Message Content等のPrivileged Intentは、必要なPluginを実装し、用途・保持データ・権限をレビューした後に限定して追加する
- Plugin CommandはGuild単位の有効化状態を確認する
- Plugin無効化時はCommand同期とRuntime lifecycleを更新する
- Bot Tokenをログへ出さない

## Docker / Lightsail

実装済み:

- builder / runtimeのmulti-stage構成
- API、Studio、Bot、Workerをbuild時にcompile
- Bot / Workerは本番で`tsx`を使わずcompiled JavaScriptを実行
- Runtime imageはproduction依存、build成果物、Prisma migrationだけを保持
- Runtime imageからworkspace source、test、docs、examples、開発設定を除外
- アプリコンテナはnode公式imageの非rootユーザーで実行
- `no-new-privileges`と`cap_drop: ALL`をアプリコンテナへ適用
- `/tmp`だけをtmpfsとして提供
- API / Studio / Bot / Worker / Migratorへ必要な環境変数だけを注入
- Compose実行時に`.env.production`を明示し、必須値不足をbuild前に検出
- PostgreSQL / Redisはホストへポート公開しない

運用上の注意:

- `.env.production`はLightsail上だけに置き、権限を管理ユーザーのみに制限する
- Composeを手動実行する場合も`--env-file .env.production`を必ず付ける
- アプリが永続書込みを必要とする場合、root化せず専用volumeと所有権を追加する
- Caddy / nginx / PostgreSQL / Redisの権限削減は各公式imageの要件を確認して別途行う

残課題:

- read-only root filesystemの適用可否をサービスごとに検証する
- base imageのdigest pinning
- 定期バックアップと復元訓練

## CI / Supply chain

CIで以下を必須とする。

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
node --test .github/scripts/*.test.mjs
pnpm build
docker compose --env-file .env.production.example -f docker-compose.prod.yml config --quiet
docker build --tag herta-app:ci .
```

CIはさらに、以下を検証する。

- AOP用Caddyfileと有効化スクリプトの構文
- Runtime UIDが0ではないこと
- API / Bot / Worker / Studioのbuild成果物がimage内に存在すること
- Prisma CLIとQuery EngineがRuntime image内で利用できること
- workspace source、test、docsがRuntime imageへ含まれないこと
- Runtime packageをcompiled JavaScriptからimportできること
- CycloneDX SBOMを本番用imageから生成できること
- SBOMにCredentialや既知のCI用ダミーSecretが含まれないこと
- Grypeが既知のHigh / Critical脆弱性で失敗すること
- 本番用imageにHigh / Critical脆弱性が残っていないこと

GitHub Actionsの`permissions`はジョブに必要な最小権限だけを明示する。

### SBOM

CIでbuildした`herta-app:ci`をSyftでscanし、CycloneDX JSONを生成する。

- ファイル名: `herta-app.cdx.json`
- 対象: CIでbuildした本番用コンテナimage
- Artifact保持期間: 30日
- ArtifactにはGrypeのJSON reportとscanner version情報も含める
- `.env.production`、証明書、秘密鍵、Token、Credential値をArtifactへ含めない

SBOMは一時ディレクトリへ生成し、形式とSecret非包含の検証が成功した後だけArtifact用ディレクトリへ移動する。検証に失敗したSBOMはuploadしない。

### Scannerの固定と更新

SyftとGrypeはGitHub Actions内でversionを明示し、同じversionの公式release assetとchecksum fileを取得してSHA-256を検証してから実行する。

現在の固定version:

- Syft: `1.44.0`
- Grype: `0.112.0`

version変更時は以下を確認する。

1. 公式release noteとSecurity Advisory
2. SBOM形式の互換性
3. Grype DB schemaの互換性
4. 既知脆弱SBOMを使ったfailure gate自己テスト
5. 本番image scan結果の差分
6. Artifactの内容とSecret非包含

固定versionは月1回、またはSyft / GrypeのSecurity Advisory公開時に見直す。

### CVE failure gate

本番用imageのGrype scanは、修正版の有無にかかわらず`High`以上をfailure対象とする。

```bash
grype herta-app:ci \
  --config .ci/grype.yaml \
  --fail-on high \
  --output json \
  --file security-artifacts/grype-report.json
```

検出結果は次の順序で対応する。

1. 直接依存、base image、OS packageの更新で解消する
2. 実際に到達可能か、使用される機能か、代替策があるかを確認する
3. 直ちに解消できない場合だけ期限付き例外を申請する
4. 解消後は同じPRでallowlistから削除する

### 期限付きallowlist

例外は`.github/security/grype-allowlist.json`で管理する。初期状態は空配列とする。

```json
[
  {
    "id": "CVE-2026-12345",
    "reason": "修正版が未公開で、該当機能を本番では使用していないため一時的に許可する",
    "expires": "2026-08-15",
    "issue": "https://github.com/ivRooom/Herta/issues/123",
    "package": {
      "name": "example-package",
      "type": "npm"
    }
  }
]
```

必須条件:

- `id`: `CVE-*`または`GHSA-*`
- `reason`: 10文字以上の具体的な理由
- `expires`: 登録時点から90日以内の未来日
- `issue`: `ivRooom/Herta`内の追跡Issue URL
- `package`: 同名packageへの過剰な除外を避ける場合に指定する

CIはallowlistを検証し、有効な項目だけから`.ci/grype.yaml`を生成する。期限切れ、90日超過、理由不足、Issue URL不足、重複、未対応fieldがある場合はscan前にfailureとする。

追跡Issueには以下を記載する。

- 検出IDと対象package
- 影響するimage / service
- 現時点で修正できない理由
- 到達可能性と想定される影響
- 暫定緩和策
- 対応担当者
- 解消予定日
- 再確認結果

延長する場合はIssueへ再評価結果を追記し、新しい期限を設定する。理由なく期限だけを延長しない。

### Dependabotとの役割分担

Dependabotは次を担当する。

- npm依存のversion更新PR
- GitHub Actionsのversion更新PR
- manifest / lockfile上で判明する依存更新

SBOM / Grypeは次を担当する。

- 実際にbuildされたRuntime imageの構成要素一覧
- base imageとOS packageを含む既知脆弱性検出
- transitive dependencyとcompiled artifactの継続監視
- High / Criticalのmerge gate

Dependabot PRが作成されていないことは、Runtime imageに脆弱性がないことを意味しない。反対にGrypeの検出だけで自動更新は行わず、Dependabotまたは修正PRで依存を更新する。

## インシデント時の初動

1. 影響範囲を特定する
2. 露出したSecretを失効・再発行する
3. 不審なログイン、OAuth、DB操作、Discord操作を確認する
4. 必要に応じてBot / APIを一時停止する
5. Audit LogとCloudflare / Caddy / nginx / Appログを保全する
6. 原因を修正して再デプロイする
7. Health checkと主要操作を再確認する
8. 再発防止Issueを作成する
