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

### Production Secret Injection (GitHub Environment Secret)

本番の`.env.production`へは手作業で書かず、`Deploy Production` workflow が
`production` GitHub Environment の secret から注入します。Spotify runtime secret は
複数の `ivrm-web` インフラで共有するため SSM Parameter Store にありますが、
`HERTA_RUNTIME_SECRET_KEY` は Herta 専用のため GitHub Environment secret で管理します。

| GitHub secret (Environment `production`) | 注入先 env variable        |
| ---------------------------------------- | -------------------------- |
| `HERTA_RUNTIME_SECRET_KEY`               | `HERTA_RUNTIME_SECRET_KEY` |

- `deploy` job (`environment: production`) が `${{ secrets.HERTA_RUNTIME_SECRET_KEY }}` を
  job env に取り込み、`appleboy/ssh-action` の `envs:` 経由でSSHセッションへ渡し、
  `upsert_env` で Lightsail の `.env.production` へ書き込みます。
- GitHub Actions は `secrets.*` の値をlogから自動的にマスクします。SSHスクリプトも値を出力しません。
- secret が未設定の場合、deployは明示的に失敗します（fail closed）。
- 渡された値は書き込み前に形式を検証します（64桁hex、または長さが4の倍数で復号すると
  32 bytesになるbase64のみ許可）。不正形式ではdeployを中止します。
- `.env.production` に既存の別master keyが入っている状態で渡された値がそれと異なる場合、
  deployは中止します（既存の暗号化済みcredentialを復号不能にしないため）。
- `docker-compose.prod.yml` は `studio` / `bot` サービスへ `HERTA_RUNTIME_SECRET_KEY` を渡します。
- `deploy/scripts/{deploy,start,rollback}.sh` は起動前に `assert_runtime_secret_key` で
  `.env.production` にAES-256向けの正しい長さ (32 bytes) で存在することを検証します。

初回の secret 登録（repo 管理者が実行。値は stdin で渡し、コマンドライン履歴やlogに残さない）:

```bash
# 新規生成する場合
printf '%s' "$(openssl rand -base64 32)" | gh secret set HERTA_RUNTIME_SECRET_KEY \
  --repo ivRooom/Herta --env production

# 既に本番 .env.production へ注入済みの場合は「同一値」を登録する
# (異なる値だと次回 deploy が「既存keyと渡された値が不一致」で中止する)
ssh <lightsail-host> "grep '^HERTA_RUNTIME_SECRET_KEY=' /app/herta/.env.production | tail -1 | cut -d= -f2-" \
  | tr -d '\n' | gh secret set HERTA_RUNTIME_SECRET_KEY --repo ivRooom/Herta --env production
```

### Master Key Rotation (v1: 手動)

v1 はオンライン rotation / 再暗号化に未対応です。やむを得ず master key を変更する場合:

1. 新しい key を生成し、Studio から全 provider credential を再登録できる状態にする
   (旧 key で暗号化済みの `runtime_secrets` は復号不能になる前提)
2. 本番ホストで `.env.production` の `HERTA_RUNTIME_SECRET_KEY` を新値へ更新し、`studio` / `bot` を再作成
3. Studio から OpenAI 等の credential を再登録
4. `production` Environment secret `HERTA_RUNTIME_SECRET_KEY` を新値へ更新
   (`gh secret set HERTA_RUNTIME_SECRET_KEY --env production`。ホストと secret の値を一致させ、
   次回 deploy の不一致チェックを通す)

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
2. `production` GitHub Environment に secret `HERTA_RUNTIME_SECRET_KEY` を一度だけ登録
   （[Production Secret Injection](#production-secret-injection-github-environment-secret) 参照）
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
