# Discord AI Q&A Limited Guild Rollout Runbook

Issue #350で追加するDiscord会話Q&A surfaceを、production既定OFFのまま限定Guildへ段階導入するためのRunbookです。

このRunbookはOpenAI credentialの値を読み出したり、Issue / PR / logへ記録したりしません。`HERTA_AI_ENABLED`を有効化しても、AI PluginとGuild configの両方が有効なGuildだけがprovider callへ進みます。

## 1. 前提

実施前に以下を満たしてください。

- 対象PRがmainへmerge済みで、main CI / Production Docker runtime / SBOM / Grype High-Critical gateがGREEN
- Deploy ProductionがGREEN
- Cloudflare経由のexternal health checkがGREEN
- `HERTA_AI_ENABLED=false` のproduction既定値はRepository上で維持されている
- rollout対象Guildを1つに限定している
- rollback担当者がLightsailのproduction envとStudioのGuild Plugin設定を変更できる

Repository上の既定値を`true`へ変更してglobal rolloutしないでください。限定rolloutで必要なglobal gate変更はLightsail上の未コミット`/app/herta/.env.production`だけで行います。

## 2. Credential availabilityをsafe metadataだけで確認

StudioへHerta global adminとしてログインし、OpenAI Runtime Secret設定を確認します。

安全確認用API:

```text
GET /api/admin/runtime-secrets/openai
```

確認する項目:

```text
provider = openai
configured = true
```

`configured=false`でも`environmentFallbackConfigured=true`ならmigration fallbackは存在しますが、通常rolloutではRuntime Secret Store登録を優先します。

レスポンスにAPI key値は含まれません。`updatedAt` / `keyVersion`はsafe metadataとして確認できます。Secret値のread-back、DB直接select、log出力は行わないでください。

## 3. AI Runtime Settingsをallowlistとして確認

安全確認用API:

```text
GET /api/admin/runtime-config/ai
```

以下を確認します。

- `providerAvailability`の`openai`がavailable
- `resolved.provider`がserver policy上のallowlistに含まれる
- `resolved.model` / model profileが返却`policy`と一致する
- `resolved.reasoningEffort`が対象modelのallowlistに含まれる
- 保存済み設定が不正な場合に503となり、silent downgradeしていない

Discord messageからprovider / concrete model ID / reasoning / tool名を指定してこのselectionを変更できないことが前提です。

## 4. Global AI gateを限定rollout用に有効化

Lightsail上で、現在値をSecret値を含めずに作業記録へ残したうえで`/app/herta/.env.production`を編集します。

```dotenv
HERTA_AI_ENABLED=true
HERTA_AI_KILL_SWITCH=false
```

`OPENAI_API_KEY`の値をshell history、Issue、PR、Runbook、chatへ貼り付けないでください。Runtime Secret Storeを利用している場合は、このrolloutでOpenAI API key自体を変更する必要はありません。

既存deployment pathでBotをrecreateします。main merge後は通常の`Deploy Production` workflowを使用します。envだけを緊急反映する場合も、既存production Docker Compose運用手順に従い、Botが新しいenvを読んだことをsafe startup metadataで確認します。

起動時に確認してよいmetadata:

- AI runtime status
- credential source (`runtime_secret` / migration fallback)
- execution/image capability availability
- provider/modelのrequest telemetry
- safe error category

Secret値、raw prompt、raw provider responseは確認対象にしません。

## 5. 対象GuildだけAI Pluginをopt-in

Studioの対象Guild Plugin画面で`ai` Pluginを開きます。

1. Plugin自体を`enabled=true`にする
2. AI Plugin configの`enabled=true`を保存する
3. rollout対象外のGuildではAI Pluginを無効のまま維持する

Studio APIを利用する場合は既存のGuild Plugin endpointを使用します。

```text
GET   /api/guilds/{guildId}/plugins/ai
PATCH /api/guilds/{guildId}/plugins/ai
```

mutationはStudio認証・Guild access・Same-Origin・Plugin permission validationを通します。外部スクリプトから認証を迂回して直接DBを書き換えないでください。

## 6. Limited Guild E2E

1つの限定Guildで各ケースを別messageとして確認します。同一messageへartifact replyとchat replyが二重送信されないことも確認してください。

- ordinary chat: `@Herta TypeScriptって何？` → `chat` policyで1回だけtext reply
- detailed: `@Herta ReactとVueを詳しく比較して` → `detailed` policyで1回だけtext reply
- code artifact: `@Herta Pythonコードを書いて` → 既存Artifact Runtimeからattachmentのみ
- file artifact: `@Herta READMEを作って` → allowlisted text artifact attachment
- Python execution: `@Herta このPythonを実行して` → 既存Code Interpreter runtime。未実行をfake successしない
- image generation: `@Herta 猫の画像を作って` → validated PNG/WebP attachment
- unsupported: 非対応artifact format等 → safe unsupported reply、成果物を生成したと主張しない
- source-dependent: `@Herta GitHubの最新PR状態を確認して` → `insufficient`。確認した/citation取得済みと捏造しない
- source-dependent artifact: `@Herta https://example.com/project を元にREADMEを作って` → provider callなし。外部参照不可と成果物未生成を明示する
- no mention: 通常message → provider callなし
- bot / webhook / DM: 対象外message → provider callなし

### Rate limit

限定Guildで既定のper-user / per-Guild windowを超える連続requestを行い、safe rate-limit replyへ移行することを確認します。通常利用者へ負荷を与えない時間帯で行い、provider raw errorをlogへ出さないでください。

### Quota

quota guardそのものは自動testで検証します。production E2Eで閾値到達を再現する必要がある場合は、対象Guild以外のAI Plugin / Guild opt-inが無効であることを事前に確認し、限定Guild・短いmaintenance windowでproduction envの現行値をバックアップしてからserver-side quotaを安全な低い検証値へ一時変更します。対象外Guildのopt-in状態を確認できない場合は共有production環境の`HERTA_AI_GUILD_QUOTA_MICRO_USD`を変更せず、隔離したstaging / verification configurationで検証してください。検証後は必ず元の値へ戻してBotをrecreateします。実課金を増やす方向へ閾値を緩和して検証しないでください。

### Timeout

provider応答を意図的に長時間化させるためのunbounded prompt/tool requestは禁止です。timeout contractは自動testを正本とし、productionでは実際のprovider timeoutが発生した場合にsafe timeout messageとなり、raw provider bodyが出ないことを確認します。

## 7. Observability確認

通常application log / telemetryに以下が出ていないことを確認します。

- raw user prompt
- raw provider response
- generated full response
- source code / generated file content
- stdout / stderr
- image bytes / base64
- Runtime Secret / OpenAI API key
- provider error response body
- Discord SDK raw error object

許可するmetadataはGuild ID、intent、response mode、grounding state、provider、model、result/status、safe error category、duration、token usage、estimated cost等に限定します。

## 8. Kill switch rollback

Provider障害、予算異常、abuse、予期しない出力が発生した場合は最優先でglobal kill switchを使用します。

```dotenv
HERTA_AI_KILL_SWITCH=true
```

Botをrecreate後、対象Guildでprovider callが停止し、非AI Pluginが継続稼働していることを確認します。

復旧時は原因とguardを確認してから`HERTA_AI_KILL_SWITCH=false`へ戻します。原因未確認のまま再開しないでください。

## 9. Guild opt-out rollback

問題が特定Guildだけに限定される場合はglobal AIを落とさず、対象GuildのStudio設定で次のどちらかを実行します。

- AI Pluginをdisabled
- AI Plugin configを`enabled=false`

変更後、対象Guildの`@Herta` AI requestでprovider callが発生しないことをsafe telemetryで確認します。

## 10. Global rollback

限定rollout自体を終了する場合はLightsail production envを次へ戻します。

```dotenv
HERTA_AI_ENABLED=false
HERTA_AI_KILL_SWITCH=false
```

Botをrecreateし、AI requestでprovider callが発生しないことを確認します。Repositoryの`.env.production.example`は常に`HERTA_AI_ENABLED=false`を維持します。

## 11. RAG / retrieval境界

Issue #350ではRAG corpus、vector search、web retrievalを実装しません。

`not_required`として回答可能:

- 雑談
- 創作
- 一般的な非source依存説明
- user inputだけで完結する変換

`insufficient`として扱う代表例:

- repositoryの現在状態
- 最新version / release / price
- productionや外部サービスの現在状態
- URL内容やsource確認が必要な具体的事実

`insufficient`ではcitation、tool result、外部確認済み事実を捏造しません。将来のretrieval integrationはこのserver-side grounding境界へ接続します。

## 12. #345との境界

このrolloutでIssue #345をcloseしません。Code Interpreter generated PNG等のbinary execution artifactは、現行text MIME / UTF-8 download validationとは別のfollow-upとして扱います。Issue #350へbinary execution artifact実装を混在させないでください。
