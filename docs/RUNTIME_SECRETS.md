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

## Studio UX

`Dashboard > Settings > AI Provider Credentials` からOpenAI API keyを設定します。

- 保存済みkeyの再表示はしない
- Console credentialの設定状態、`OPENAI_API_KEY` environment fallbackの有無、最終更新時刻を表示する
- 更新時は新しいkeyで置き換える
- 削除するとDBのencrypted credential自体を削除する
- `OPENAI_API_KEY` environment fallbackが残っている状態で削除した場合、fallbackが再び使われることを削除前後に明示する
- AI provider accessを完全に停止する場合はConsole credentialだけでなくproductionの`OPENAI_API_KEY`も削除する
- password inputの値をURL/query stringへ入れない

## Existing Semantic Search

Studio Command Palette Semantic Searchは次の優先順位でOpenAI credentialを解決します。

1. encrypted runtime secret `openai.api_key`
2. `OPENAI_API_KEY` environment variable（migration / emergency fallback）

`OPENAI_API_KEY` fallbackへ進むのは、runtime secret storeへの読み取りが正常に完了し、`openai.api_key` recordが存在しない場合だけです。

runtime secretの復号失敗、master key異常、DB read failureなどcredential store自体の失敗時はfail closedし、env fallbackで障害を隠しません。

`OPENAI_API_KEY`は既存productionから即削除する必要はありません。console登録と動作確認後にfallbackを段階的に外せます。

## Privacy / Logging

禁止:

- raw provider credentialのlogging
- raw credentialをAPI responseへ含める
- Plugin config / audit metadataへcredentialを入れる
- key末尾などのfingerprintを不要に表示する

ログへ残してよいのはprovider名、configured状態、safe error category等のmetadataだけです。

## Failure Behavior

- master key未設定 / 不正: console保存APIは503。既存非AI機能は継続
- credential未設定かつenv fallbackなし: AI provider機能はdisabled/fallbackとして扱う
- ciphertext改ざん / master key不一致: AES-GCM認証で復号失敗し、credentialを返さない
- DB unavailable: credential store failureとしてfail closedし、env fallbackへ切り替えない
- Console credential削除後にenv fallbackが残る場合: UI/API statusでその状態を明示し、AI accessは継続する

## Production Rollout

この機能をproductionで利用する前に以下を満たします。

1. DB migration `20260826102000_runtime_secrets` を適用
2. `HERTA_RUNTIME_SECRET_KEY` をproductionへ一度だけ設定
3. Studioを再作成してmaster key envを反映
4. Herta管理者でSettingsを開く
5. OpenAI API keyをconsoleから登録
6. 保存後もkey本体が再表示されないことを確認
7. Semantic Search / AI Foundationからcredentialを利用できることを確認
8. Console credentialをprimary sourceとして確認できたら旧 `OPENAI_API_KEY` env fallbackを削除する
9. fallback削除後にSettingsがenvironment fallbackなしと表示することを確認する

## Future

- master key rotation / re-encryption workflow
- provider credential connection test
- credential changeのglobal security audit event
- OpenAI以外のprovider credential追加
- Bot / Worker側のshort TTL decrypted-key cache（raw valueは永続化しない）
