# Runtime Secrets / Provider Credentials

Herta StudioからOpenAI等のprovider credentialを安全に登録するためのglobal runtime secret storeです。

## 目的

- OpenAI API keyをLightsailの`.env.production`へ都度手作業で書かない
- Herta管理者がStudio Settingsから登録・更新・削除できる
- SecretをGuild Plugin config、ブラウザresponse、structured logへ残さない
- Bot / Worker / Studioのserver-side runtimeだけが必要時に復号できる境界を作る

## Access Control

Provider credentialはGuild単位ではなくHerta全体へ影響するため、Guild IAMでは管理しません。

- `users.is_admin = true` のHerta管理者だけがcredential APIへアクセス可能
- GETも管理者限定
- PUT / DELETEは認証 + Herta管理者 + Same-Originを必須とする
- UIは管理者以外には表示しない

## Storage

`runtime_secrets` tableにはplaintextを保存しません。

- algorithm: AES-256-GCM
- IV: 12 bytes / random per write
- auth tag: 16 bytes
- AAD: secret name + key version
- current key version: `1`
- plaintext最大: 4096 bytes
- `updated_by` と更新時刻だけをmetadataとして保持

OpenAI credential name:

- `openai.api_key`

## Bootstrap Master Key

暗号化・復号には `HERTA_RUNTIME_SECRET_KEY` を使用します。

これはOpenAI API keyではなく、Herta自身のruntime secret master keyです。32 bytesのランダム値をbase64または64桁hexで設定します。

推奨生成例:

```bash
openssl rand -base64 32
```

重要:

- Gitへcommitしない
- ブラウザへ公開しない
- production serverと安全なSecret Manager / password vaultの両方で保管する
- この値を失うとDB内のcredentialを復号できない
- v1ではmaster keyのオンラインrotation/re-encryptionは未実装。安易に値を変更しない

### Production Secret Injection (AWS SSM Parameter Store)

本番の`.env.production`へは手作業で書かず、既存のSpotify runtime secretと同じ
SSM Parameter Store同期経路で注入します。

| SSM parameter (`ap-northeast-1`)         | type         | 注入先 env variable        |
| ---------------------------------------- | ------------ | -------------------------- |
| `/ivrm/runtime/herta/runtime-secret-key` | SecureString | `HERTA_RUNTIME_SECRET_KEY` |

- `Deploy Production` workflow (`.github/workflows/deploy-production.yml`) が deploy 時に
  `aws ssm get-parameter --with-decryption` で取得し、`::add-mask::` した上でSSH経由の
  `upsert_env` で Lightsail の `.env.production` へ書き込みます。
- 値がCI log / shell outputへ出ないよう、長さ以外は表示しません。
- SSM parameterが未設定の場合、deployは明示的に失敗します（fail closed）。
- `docker-compose.prod.yml` は `studio` / `bot` サービスへ `HERTA_RUNTIME_SECRET_KEY` を渡します。
- `deploy/scripts/{deploy,start,rollback}.sh` は起動前に `assert_runtime_secret_key` で
  `.env.production` にAES-256向けの正しい長さ (32 bytes) で存在することを検証します。

初回のparameter作成。`deploy-production.yml` が assume する deploy role
(`arn:aws:iam::911291529944:role/ivrm-web-github-deploy-role`) と**同じ AWS account
`911291529944` / region `ap-northeast-1`** に作成すること。別 account に作ると deploy は
fail closed する。値は生成後に安全に保管し、logへ残さない。

```bash
# 先に対象 account を確認する
aws sts get-caller-identity --query Account --output text   # => 911291529944 であること

MASTER_KEY="$(openssl rand -base64 32)"
aws ssm put-parameter \
  --region ap-northeast-1 \
  --name '/ivrm/runtime/herta/runtime-secret-key' \
  --type SecureString \
  --value "${MASTER_KEY}" \
  --no-overwrite
unset MASTER_KEY
```

既に本番 `.env.production` へ手動で値を注入済みの場合は、その同一値を SSM へ登録すること
(異なる値だと次回 deploy の `upsert_env` が上書きし、登録済み runtime secret が復号不能になる)。

## Studio UX

`Dashboard > Settings > AI Provider Credentials` からOpenAI API keyを設定します。

- 保存済みkeyの再表示はしない
- Console credentialの設定状態、`OPENAI_API_KEY` migration fallbackの有無、最終更新時刻を表示する
- 更新時は新しいkeyで置き換える
- 削除するとDBのencrypted credential自体を削除する
- `OPENAI_API_KEY` migration fallbackが残っている状態で削除した場合、Runtime Secret Storeのreadが正常に完了する場合だけfallbackが再び使用され得ることを削除前後に明示する
- store障害、master key未設定・不正、decrypt failureではfail closedし、`OPENAI_API_KEY`へfallbackしない
- AI provider accessを完全に停止する場合はConsole credentialだけでなくproductionの`OPENAI_API_KEY`も削除する
- password inputの値をURL/query stringへ入れない

## Existing Semantic Search

Studio Command Palette Semantic Searchは次の優先順位でOpenAI credentialを解決します。

1. encrypted runtime secret `openai.api_key`
2. `OPENAI_API_KEY` environment variable（migration fallback）

`OPENAI_API_KEY` fallbackへ進むのは、runtime secret storeへの読み取りが正常に完了し、master keyが有効で、`openai.api_key` recordが存在しない場合だけです。

runtime secretの復号失敗、master key未設定・不正、DB read failureなどcredential store自体の失敗時はfail closedし、env fallbackで障害を隠しません。

`OPENAI_API_KEY`はsecret-store障害時のbypassではありません。既存productionから即削除する必要はなく、console登録と動作確認後にmigration fallbackを段階的に外します。

## Privacy / Logging

禁止:

- raw provider credentialのlogging
- raw credentialをAPI responseへ含める
- Plugin config / audit metadataへcredentialを入れる
- key末尾などのfingerprintを不要に表示する

ログへ残してよいのはprovider名、configured状態、safe error category等のmetadataだけです。

## Failure Behavior

- master key未設定 / 不正: console保存APIは503。credential resolverはfail closedし、env fallbackへ切り替えない。既存非AI機能は継続
- credential未設定かつenv fallbackなし: AI provider機能はdisabled/fallbackとして扱う
- ciphertext改ざん / master key不一致: AES-GCM認証で復号失敗し、credentialを返さずenv fallbackへ切り替えない
- DB unavailable: credential store failureとしてfail closedし、env fallbackへ切り替えない
- Console credential削除後にenv fallbackが残る場合: UI/API statusはそのpresenceだけを明示する。Runtime Secret Store read成功 + master key正常 + secret未登録の場合だけmigration fallbackとして利用する

## Production Rollout

この機能をproductionで利用する前に以下を満たします。

1. DB migration `20260826102000_runtime_secrets` を適用
2. SSM parameter `/ivrm/runtime/herta/runtime-secret-key` (SecureString) を一度だけ作成
   （[Production Secret Injection](#production-secret-injection-aws-ssm-parameter-store) 参照）
3. `Deploy Production` workflowを実行し、`HERTA_RUNTIME_SECRET_KEY` を `.env.production` へ注入して
   `studio` / `bot` を再作成する
4. Herta管理者でSettingsを開く
5. OpenAI API keyをconsoleから登録
6. 保存後もkey本体が再表示されないことを確認
7. Semantic Search / AI Foundationからcredentialを利用できることを確認
8. Console credentialをprimary sourceとして確認できたら旧 `OPENAI_API_KEY` migration fallbackを削除する
9. fallback削除後にSettingsがenvironment fallbackなしと表示することを確認する

## Future

- master key rotation / re-encryption workflow
- provider credential connection test
- credential changeのglobal security audit event
- OpenAI以外のprovider credential追加
- Bot / Worker側のshort TTL decrypted-key cache（raw valueは永続化しない）
