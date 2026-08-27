# AI Tool & Artifact Runtime — Phase 1 / Phase 2

Issue #345 の Tool & Artifact Runtimeとして、Herta AIが生成したコード/テキスト成果物と、明示的に要求されたPython実行結果をproviderやDiscordから独立したArtifactとして検証し、Discordへ安全に返す基盤を定義する。

## Scope

実動作するintent:

- `code_artifact`
- `file_artifact`
- `code_execution` — Phase 2で追加

型として定義するが、このPhaseでは実行しない:

- `image_generation`

通常会話/詳細回答のrouteもartifact runtime側では保持するが、既存会話surfaceを奪わない。

- `chat`
- `detailed_answer`

## Request flow

### Artifact generation

```text
Discord @mention
  -> Guild AI Plugin enabled + config.enabled=true
  -> server-side intent resolution
  -> existing AiFoundation / runtime snapshot
  -> responseMode=artifact
  -> server-authored artifact capability instructions
  -> strict artifact envelope parse
  -> Artifact validation
  -> Discord attachment delivery
```

### Python execution

```text
Discord @mention
  -> server-side explicit execution intent
  -> existing runtime snapshot / rate limits / Guild quota / cost guard / concurrency / timeout
  -> OpenAI explicit 1 GB Code Interpreter container
  -> verify memory=1g + network_policy=disabled
  -> Responses API with Code Interpreter as the only required tool
  -> verify actual code_interpreter_call
  -> collect container_file_citation entries only
  -> bounded container file download
  -> existing Artifact validation
  -> explicit container DELETE
  -> only then return execution success / Discord attachments
```

provider/model/reasoning、rate limit、Guild quota、per-request cost guard、concurrency、timeoutは既存AiFoundation経路を維持する。Phase 2はBot/Lightsail host上のPython/shell実行を追加しない。

## Artifact domain

Artifact modelはprovider/Discord型に依存しない。

- `filename`
- `mimeType`
- `bytes`
- `size`
- `kind`
- optional safe metadata

任意filesystem pathは持たない。`size`はdeclared metadataではなく実bytesから計算する。

## Allowlist

Phase 2 execution outputもPhase 1と同じallowlistへ必ず通す。

| Extension | MIME               |
| --------- | ------------------ |
| `.py`     | `text/x-python`    |
| `.md`     | `text/markdown`    |
| `.txt`    | `text/plain`       |
| `.json`   | `application/json` |
| `.yaml`   | `application/yaml` |
| `.yml`    | `application/yaml` |
| `.csv`    | `text/csv`         |

filenameはNFKC正規化後にbasenameとして検証し、`/`、`\\`、`..`、control characters、NUL、Windows reserved characters/names、encoded separatorを拒否する。

Execution file downloadでは、providerのContent-Typeが具体的なMIMEを返した場合にextension由来のallowlist MIMEと一致することを確認する。`application/octet-stream`はtransport用generic MIMEとしてのみ許容し、最終Artifact MIMEはallowlistから決定する。現在のexecution outputはtext系allowlistだけなのでUTF-8としても検証する。

## Bounded configuration

Artifact既定値:

- max artifact bytes: `524288` (512 KiB)
- max artifact files: `3`

optional server-side overrides:

- `HERTA_AI_ARTIFACT_MAX_BYTES`
  - min: 1024
  - max: 8388608
- `HERTA_AI_ARTIFACT_MAX_FILES`
  - min: 1
  - max: 5

invalid overrideはdefaultへsilent fallbackせずfail closedする。

Phase 2 executionでHertaが追加で固定するbound:

- Code Interpreter memory: `1g`
- outbound network: `disabled`
- max built-in tool calls: `8`
- provider response bytes: existing `HERTA_AI_PROVIDER_RESPONSE_MAX_BYTES`
- wall-clock timeout: existing `HERTA_AI_TIMEOUT_MS`
- execution file count: existing Artifact max files
- each execution file bytes: existing Artifact max bytes
- global concurrency: existing AI Foundation guard

## Python code artifact

`PythonでFizzBuzzのコードを書いて` は `code_artifact` へrouteし、実行しない。

Python code artifactは次を満たす。

- `.py`
- `text/x-python`
- `kind=code`
- source全文をartifact bytesとして保持
- Discord本文へsource全文を重複しない
- attachmentを成果物の正本とする

Discord本文の成功文言はprovider responseから信用せず、validation済みArtifact metadataからのみ生成する。

## Explicit execution contract

`code_artifact` と `code_execution` は別intent。

- `Pythonコードを書いて` → `code_artifact`、実行しない
- `Pythonコードを書いて。実行しないで` → executionしない
- `Pythonコードの実行方法を教えて` → `chat`、executionしない
- `このPythonコードを実行して` → `code_execution`

Phase 2の`code_execution`はprovider-native OpenAI Code Interpreterを使用する。Responses API requestではCode Interpreterを唯一のtoolとして`tool_choice=required`にし、response内に実際の`code_interpreter_call`が存在することを確認する。toolが呼ばれていないresponseは成功扱いにしない。

### Sandbox security contract

Hertaが明示的に設定/確認するもの:

- explicit ephemeral container
- `memory_limit=1g`
- `network_policy.type=disabled`
- containerへRuntime Secret / production envを渡さない
- containerへhost filesystemを渡さない
- Docker socketを渡さない
- privileged executionを使わない
- Responsesへraw Code Interpreter output includeを要求しない
- execution終了時にexplicit DELETE
- DELETE完了前にsuccessを返さない

provider仕様として隔離されるが、Herta APIから数値指定できないもの:

- CPU quota
- process count quota
- container disk quota

これらはOpenAI provider-managed isolation/resource controlであり、Herta側が指定した保証としては扱わない。Herta側ではwall-clock timeout、memory tier、tool call count、response bytes、file count/bytes、rate/quota/concurrencyで追加のboundを設ける。

OpenAI側の20分idle expiryはcleanupのbackupであり、Hertaの正常終了条件ではない。正常成功にはexplicit DELETE成功を要求する。

### Network

Hosted containerはoutbound networkなしを前提とし、Hertaはcontainer create時に`network_policy={type:"disabled"}`を明示する。create responseでもdisabledを確認し、確認できなければfail closedする。allowlist networkはPhase 2では使用しない。

### Secret / environment isolation

OpenAI API keyはOpenAI control-plane APIのAuthorizationにのみ使用する。container create body、Responses tool definition、file内容、sandbox envへAPI keyやRuntime Secretを注入しない。

production environment variablesをsandboxへ継承する仕組みも追加しない。

## Execution output collection

Raw Code Interpreter stdout/stderrを取得するための`include`は指定しない。

成果物はassistant messageの`container_file_citation`だけから収集する。

- citation container IDが今回作成したcontainer IDと一致すること
- file IDがbounded provider IDであること
- filenameが既存Artifact filename validationを通ること
- extensionがallowlistにあること
- downloadがmax bytes以内であること
- specific Content-Typeがallowlist MIMEと一致すること
- downloaded bytesを既存`validateAiArtifactBatch`へ再投入すること

citation数がArtifact max filesを超えた場合はdownload前に拒否する。

PNG等のbinary image outputはこのPhaseではallowlistへ追加しない。画像生成・binary sniffing・dimensions/pixel limitsは後続Phaseで扱う。

## Cost contract

Code Interpreterの1 GB container session価格は2026-08-27時点のOpenAI公式pricingに基づき、`$0.03 / 20-minute session`としてserver-side code-reviewed policyへ固定する。

- tool cost reservation: `30000 microUSD`
- model token cost: existing AI Foundation pricing/cost guard
- tool costも同じGuild quota storeへ予約/settleする
- token最大見積 + tool固定費がper-request cost limitを超える場合、container作成前に拒否する

Provider pricingの変更を推測して継続しないため、Code Interpreter pricingにはfreshness deadlineを設ける。現在のreview-afterは`2026-09-27T00:00:00Z`で、期限後は価格を再確認してcode-reviewed valueを更新するまでexecutionをfail closedする。

AI Foundationの既存token telemetry/cost settlementはtoken分を表し、execution-specific result/telemetryではtool session costを加味する。Guild quotaにはtool固定費を別reservationとして含める。

## Failure contract

次をfake successしない。

- Code Interpreter toolが呼ばれていない
- Foundation timeout
- provider/container failure
- sandbox policy confirmation failure
- execution output count/size超過
- malformed response/citation
- unsafe filename
- MIME mismatch
- file download failure
- Artifact validation failure
- container DELETE failure
- Discord delivery failure

`実行が完了しました`は、tool実行確認・output validation・container cleanup完了後の結果からのみ生成する。

## Discord delivery

Artifact validationとDiscord deliveryを分離する。

```text
Execution/provider file
  -> bounded download
  -> validate
  -> validated Artifact bytes
  -> sandbox DELETE
  -> Discord attachment adapter
```

Discord SDK delivery errorはattachment bytesを含む可能性があるため、AI Pluginのログへraw error objectを渡さずsafe error name/categoryだけを記録する。delivery failure時に二重返信で成功を装わない。

## Logging / privacy

telemetryへ出してよいもの:

- intent
- result category
- execution status
- duration
- provider/model
- artifact count
- total bytes
- artifact kind
- MIME
- size
- safe error category

出さないもの:

- raw user prompt
- raw source code
- raw stdout/stderr
- generated file content
- provider raw response
- Runtime Secret / API key / credentials
- user/model derived filename

## Production impact

Phase 2でも次を行わない。

- DB migration
- production deployの手動実行
- secret追加/変更
- `HERTA_AI_ENABLED=true` への変更
- AOP変更
- Discord slash command sync

Production defaultは引き続きAI OFFで、AI PluginのGuild opt-inも必要。

## Remaining Issue #345 scope

Phase 2完了後もIssue #345はcloseしない。

- image generation adapter
- image binary validation / MIME sniffing
- dimensions / pixel limits
- richer artifact/tool orchestration and UX
