# Discord AI Q&A Limited Guild Rollout Runbook

Issue #350で追加したDiscord会話Q&A surfaceとIssue #345で完成したTool / Artifact Runtimeを、production既定OFFのまま限定Guildで受入確認するためのRunbookです。Issue #354のproduction E2E acceptanceではこの手順を基準にします。

このRunbookはOpenAI credentialの値を読み出したり、Issue / PR / logへ記録したりしません。`HERTA_AI_ENABLED`を有効化しても、AI PluginとGuild configの両方が有効なGuildだけがprovider callへ進みます。

## Production acceptance target

Issue #354 の production acceptance は次の1 Guild / 1 channelだけで実施します。

- Target Guild: `いゔる。ーむ`
- Guild ID: `964326043420872704`
- E2E Channel: `#コンソール`
- Channel ID: `1175075504940908635`

production E2E messageとartifact生成は必ずこのchannelだけで実施します。対象外GuildへAI Plugin / AI configを有効化せず、全Guild enableは行いません。

## 1. Production preflight

実施前に以下をすべて満たしてください。

- rollout対象revisionがmainへmerge済み
- main CI / Production Docker runtime / SBOM / Grype High-Critical gateがGREEN
- Deploy ProductionがGREEN
- deploy image SHAとmain HEADが一致
- production migrationが成功し、pending migrationがない
- Cloudflare経由のexternal health checkがGREEN
- `HERTA_AI_ENABLED=false` のproduction既定値がRepository上で維持されている
- rollout対象Guildを1つに限定している
- rollback担当者がproduction envとStudioのGuild Plugin設定を変更できる
- rollback前状態をSecret値なしで記録済み

Repository上の既定値を`true`へ変更してglobal rolloutしないでください。限定rolloutで必要なglobal gate変更はproduction runtime envだけで行います。

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

## 3. AI Runtime Settingsをserver-side allowlistとして確認

安全確認用API:

```text
GET /api/admin/runtime-config/ai
```

以下を確認します。

- `providerAvailability`の`openai`がavailable
- `resolved.provider`がserver policy上のallowlistに含まれる
- `resolved.model` / model profileが返却`policy`と一致する
- `resolved.reasoningEffort`が対象modelのallowlistに含まれる
- provider capability resolutionがserver-side policyと一致する
- 保存済み設定が不正な場合に503となり、silent downgradeしていない

Discord messageからprovider / concrete model ID / reasoning / capability / tool名を指定してこのselectionを変更できないことが前提です。

## 4. Rollout前状態を記録

Secret値を含めず、最低限以下の変更前状態をIssue #354へ記録します。

- deployed main SHA / image SHA
- global AI gate
- kill switch
- rollout対象Guild名または運用上識別できる名称
- rollout対象GuildのAI Plugin enabled状態
- rollout対象GuildのAI config enabled状態
- provider / model profile / reasoningのsafe metadata
- credential `configured` metadata
- quota / rate / concurrency / timeout / per-request cost設定

対象外GuildでAI PluginまたはAI configが有効になっていないことも確認します。

## 5. Global AI gateを限定rollout用に有効化

production envの現在値をSecret値なしで記録してから次を設定します。

```dotenv
HERTA_AI_ENABLED=true
HERTA_AI_KILL_SWITCH=false
```

`OPENAI_API_KEY`の値をshell history、Issue、PR、Runbook、chatへ貼り付けないでください。Runtime Secret Storeを利用している場合は、このrolloutでOpenAI API key自体を変更する必要はありません。

既存deployment pathでBotをrecreateします。起動後に確認してよいmetadata:

- AI runtime status
- credential source (`runtime_secret` / migration fallback)
- code execution / image generation capability availability
- provider / modelのrequest telemetry
- safe error category

Secret値、raw prompt、raw provider responseは確認対象にしません。

## 6. 対象GuildだけAI Pluginをopt-in

Studioの対象Guild Plugin画面で`ai` Pluginを開きます。

1. Plugin自体を`enabled=true`にする
2. AI Plugin configの`enabled=true`を保存する
3. rollout対象外GuildではAI Plugin / AI configを無効のまま維持する

Studio APIを利用する場合は既存のGuild Plugin endpointを使用します。

```text
GET   /api/guilds/{guildId}/plugins/ai
PATCH /api/guilds/{guildId}/plugins/ai
```

mutationはStudio認証・Guild access・Same-Origin・Plugin permission validationを通します。外部スクリプトから認証を迂回して直接DBを書き換えないでください。

Global gateをONにしても、Guild opt-inがないGuildからprovider callが発生しないことを最初に確認します。

## 7. Discord production E2E

対象Guild `964326043420872704` の `#コンソール` (`1175075504940908635`) で各ケースを別messageとして確認します。同一messageへartifact replyとchat replyが二重送信されないことも確認してください。

### Conversation

1. ordinary chat: `@Herta TypeScriptって何？` → `chat` policyで1回だけtext reply
2. detailed: `@Herta ReactとVueを詳しく比較して` → `detailed` policyで1回だけtext reply
3. Herta direct reply: ordinary mentionで得たHertaの返答へ、mentionなしで `それをもう少し詳しく` と直接reply → 同一channelのHerta自身のmessageをserver-side検証した場合だけ、boundedな参照contextを使って継続応答
4. mention + direct reply: Hertaの返答へ `<@Herta> その内容で続けて` と直接reply → mentionがあっても参照Herta本文を失わず、bounded user-input contextとして継続
5. normal mentionless: Hertaへのdirect replyではない通常のmentionなしmessage → AI処理しない
6. mentionless other-user / other-bot reply: Hertaへのreal mentionなしで他userまたは他Botのmessageへreply → AI処理しない
7. Herta mention + other-user / other-bot reply: 他userまたは他Botのmessageへreplyしながら `<@Herta> TypeScriptって何？` とreal mention → mentionによるAI candidateとして処理する。ただし他user / 他Botの参照本文をHerta direct-reply contextとして取り込まない
8. persona / continuity: casual Japaneseの雑談で、Herta persona・自然な会話温度・直前の検証済みreply contextを維持する。案内Bot調の定型敬語やprovider固有personaへ戻らない
9. source-dependent: `@Herta GitHubの最新PR状態を確認して` → retrieval sourceがない場合は`insufficient`。確認した/citation取得済みと捏造しない

Direct replyの参照本文はtrusted instructionへ昇格させません。通常のmentionなしmessageを会話候補へ拡張する5分間sessionはIssue #358のacceptance対象外です。

### Direct reply channel boundary — automated test evidence

Discordネイティブのdirect replyは別channelのmessageを参照できないため、`#コンソール`だけを使うproduction E2Eでcross-channel referenceを再現しません。same-channel fail-closed境界はcurrent automated testをSource of Truthとし、incoming / referenced messageのchannel IDが一致しない場合にAI candidate化せず、参照contextを取り込まないことを確認します。

この項目はIssue #354へ `automated test evidence` と明記し、production E2E成功として記録しません。

### Artifact generation

1. code artifact: `@Herta Pythonコードを書いて` → code attachmentを生成するだけでexecutionしない
2. CSV artifact: allowlisted CSV生成要求 → validated text attachment
3. image generation: image生成要求 → validated PNG / WebP attachment
4. unsupported artifact: 非対応format → safe failure。成果物を生成したと主張しない
5. malformed artifact: validationで壊れたartifactを検出した場合 → attachmentせずsafe failure
6. direct-reply artifact continuity: Hertaの返答へ `その内容でREADMEをMarkdownで作って` と直接reply → 検証済み参照contextをuser-input planeとしてArtifact Runtimeへ渡す

### Explicit Code Interpreter execution

1. Python execution: 明示的な実行要求 → sandboxed Code Interpreter runtimeを通す
2. PNG execution artifact: Python実行でPNGを生成 → strict binary validation後にattachment
3. WebP execution artifact: Python実行でWebPを生成 → strict binary validation後にattachment
4. direct-reply execution continuity: Hertaのコード返答へ `そのコードを実行して` と直接reply → 検証済み参照contextをCode Interpreter requestへ渡す

Code artifact生成だけのrequestでCode Interpreterが実行されないことを必ず確認します。

### Image generation continuity

Hertaの直前返答を前提に `その内容で画像を作って` と直接replyした場合も、検証済み参照contextをimage generation requestへ渡し、参照contextなしの新規promptとして扱わないことを確認します。

### Failure honesty

以下はprovider/tool/validationの成功として説明しないことを確認します。

- provider timeout
- provider failure
- tool failure
- artifact validation failure
- quota exceeded
- rate exceeded
- Discord delivery failure

fake success、架空のfilename、架空のattachment、架空のtool resultを返してはいけません。

### Artifact evidence

生成した各artifactについて次を記録します。binary bytesそのものは記録しません。

- filename
- MIME
- file size
- Discord attachment成功/失敗
- validation result / safe error category

## 8. Security / Reliability acceptance

### Server-side authority

以下をDiscord入力から任意指定できないことを確認します。

- provider
- concrete model ID
- reasoning policy
- capability
- privileged tool

Runtime Secretがclient response / Discord / normal logへ露出しないことも確認します。

### Sandbox boundary

Code Interpreter経路で以下をHerta host上の成功として扱わないことを確認します。

- host shell execution
- host filesystem access
- unrestricted host network access

provider-managed sandboxの実行結果とHerta host executionを混同しません。

### Guards

最低限以下のguardが有効であることをsafe metadata / test / E2Eで確認します。

- per-user rate limit
- per-Guild rate limit
- Guild quota
- per-request cost limit
- global concurrency
- timeout
- artifact size / dimensions / pixel limits

productionで危険な負荷試験や高額requestを行いません。安全にproduction再現できないguardはautomated testをSource of Truthとしてよいですが、Issue #354の記録では `production E2E` と `automated test` を明確に区別します。

### Rate limit

対象Guild `964326043420872704` の `#コンソール` (`1175075504940908635`) だけで既定のper-user windowを超える軽量requestを行い、safe rate-limit replyへ移行することを確認します。通常利用者へ負荷を与えない時間帯で行い、provider raw errorをlogへ出さないでください。

per-Guild rate limitのために30件超のproduction requestを意図的に発生させる必要はありません。per-Guild rate / quota / concurrencyなどproductionで負荷・課金を増やすguardはautomated testをSource of Truthとし、productionでは通常E2E中のsafe telemetryだけ確認します。

### Quota

quota guardそのものは自動testを正本とします。production E2Eで閾値到達を再現する必要がある場合は、対象Guild以外のAI Plugin / Guild opt-inが無効であることを事前に確認し、限定Guild・短いmaintenance windowで現行値をバックアップしてからserver-side quotaを安全な低い検証値へ一時変更します。

対象外Guildのopt-in状態を確認できない場合は共有production環境のquotaを変更せず、隔離したverification configurationで検証してください。実課金を増やす方向へ閾値を緩和して検証しません。

### Timeout

provider応答を意図的に長時間化させるunbounded prompt/tool requestは禁止です。timeout contractは自動testを正本とし、productionでは実際のtimeout発生時にsafe timeout messageとなり、raw provider bodyが出ないことを確認します。

## 9. Observability確認

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

## 10. Rollback acceptance

production acceptance中に、実際にprovider callを停止できることを順番に確認します。各操作の前後状態をIssue #354へ記録します。

### 10.1 Guild opt-out

対象GuildのAI PluginまたはAI configをdisabledにします。

- 対象GuildのAI requestでprovider callが発生しない
- 対象外Guildの状態を変更しない
- 非AI Pluginは継続する

確認後、E2E継続に必要な場合だけ対象Guild opt-inを元へ戻します。

### 10.2 Global AI gate OFF

```dotenv
HERTA_AI_ENABLED=false
HERTA_AI_KILL_SWITCH=false
```

Botをrecreateし、AI requestでprovider callが発生しないことを確認します。Repositoryの`.env.production.example`は常に`HERTA_AI_ENABLED=false`を維持します。

### 10.3 Kill switch

Provider障害、予算異常、abuse、予期しない出力が発生した場合の最優先停止経路です。

```dotenv
HERTA_AI_KILL_SWITCH=true
```

Botをrecreate後、provider callが停止し、非AI Pluginが継続稼働していることを確認します。

復旧時は原因とguardを確認してから`HERTA_AI_KILL_SWITCH=false`へ戻します。原因未確認のまま再開しません。

## 11. RAG / retrieval境界

現時点のDiscord AI Q&A surfaceでは、source-dependentな質問を回答するための一般web / repository retrievalを自動実行しません。

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

## 12. Issue #345 / #358との現在の境界

Issue #345 Tool & Artifact Runtimeはcompletedです。Code Interpreter generated PNG / WebP binary execution artifactもmainに実装済みで、strict filename / extension / MIME / byte / dimensions / pixel count / full decode validationを通してDiscord attachmentへ渡します。

Issue #358もcompletedです。AI candidateはreal mentionまたはserver-sideで検証済みのHerta direct replyだけです。direct reply contextは同一Guild / 同一channelのHerta自身のmessageに限定し、最大1,900 UTF-16 unitsのuser-input contextとしてgeneration / Artifact Runtime / Code Interpreter / Image Generationへ渡します。通常のmentionなしmessageはAI処理しません。real Herta mentionがあるmessageは、他user / 他Botへのreplyであってもmentionによるcandidate eligibilityを維持しますが、その参照本文をHerta direct-reply contextとして採用しません。

Issue #354では新しいArtifact Runtime機能やconversation sessionを追加するのではなく、現在のmainがproduction Discord上でも同じsecurity / conversation boundaryを維持することをE2Eとautomated-test evidenceの組み合わせで受け入れます。

## 13. Issue #354 completion record

Acceptance完了時はIssue #354へ最低限以下を記録します。

- deployed main SHA / image SHA
- 対象Guild / E2E channel
- 実施したE2E一覧と成功/失敗
- direct reply / mention+reply / mentionless ignore / mentionless other-user・other-bot ignore / Herta mention + other-user・other-bot reply eligibility / Herta personaのproduction E2E結果
- same-channel fail-closed boundaryのautomated-test evidence
- artifact filename / MIME / size / attachment / validation結果
- Security確認結果
- rate / quota / cost / concurrency / timeout確認結果と、各項目がproduction E2Eかautomated testかの区別
- Guild opt-out / global gate OFF / kill switch rollback結果
- 最終production state
- unresolvedな残課題

Acceptance Criteriaをすべて満たした場合のみIssue #354をcompletedとしてcloseします。未確認項目を推測で成功扱いしません。
