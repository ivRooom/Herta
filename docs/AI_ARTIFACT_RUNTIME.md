# AI Tool & Artifact Runtime — Phase 1 / Phase 2 / Phase 3

Issue #345 の Tool & Artifact Runtimeとして、Herta AIが生成したコード/テキスト成果物、明示的なPython実行結果、画像生成結果をproviderやDiscordから独立したArtifactとして検証し、安全にDiscordへ返す基盤を定義する。

## Scope

実動作するintent:

- `code_artifact`
- `file_artifact`
- `code_execution` — Phase 2
- `image_generation` — Phase 3

通常会話/詳細回答のrouteもartifact runtime側では保持するが、既存会話surfaceを奪わない。

- `chat`
- `detailed_answer`

## Common request flow

```text
Discord @mention
  -> Guild AI Plugin enabled + config.enabled=true
  -> server-side intent resolution
  -> existing AiFoundation / request-time runtime snapshot
  -> existing user/guild rate limit + Guild quota + per-request cost + concurrency + timeout
  -> capability-specific provider adapter
  -> capability-specific validation
  -> validated Artifact bytes
  -> Discord attachment delivery
```

`provider/model/reasoning`、rate limit、Guild quota、per-request cost guard、global concurrency、timeout、hallucination/grounding policyは既存AiFoundation経路を維持する。加えてImage GenerationはRedis別scopeでtool concurrency=2を強制する。Phase 3も別の無制限provider pathを追加しない。

## Artifact domain

Artifact modelはprovider/Discord型に依存しない。

- `filename`
- `mimeType`
- `bytes`
- `size`
- `kind`
- optional safe metadata

任意filesystem pathは持たない。`size`はdeclared metadataではなく実bytesから計算する。

## Text allowlist

| Extension | MIME               |
| --------- | ------------------ |
| `.py`     | `text/x-python`    |
| `.md`     | `text/markdown`    |
| `.txt`    | `text/plain`       |
| `.json`   | `application/json` |
| `.yaml`   | `application/yaml` |
| `.yml`    | `application/yaml` |
| `.csv`    | `text/csv`         |

filenameはNFKC正規化後にbasenameとして検証し、path separator、`..`、control characters、NUL、Windows reserved characters/names、encoded separatorを拒否する。

既存text Artifact既定値はmax 512 KiB / 3 files。server-side override `HERTA_AI_ARTIFACT_MAX_BYTES` / `HERTA_AI_ARTIFACT_MAX_FILES`は従来どおりで、invalid overrideはfail closedする。

## Phase 2 — Python code execution

`code_artifact` と `code_execution` は別intent。

- `Pythonコードを書いて` → source artifactのみ
- `Pythonコードを書いて。実行しないで` → executionしない
- `Pythonコードの実行方法を教えて` → chat
- `このPythonコードを実行して` → `code_execution`

Phase 2はOpenAI Code Interpreterをprovider-native sandboxとして使用する。1 GB memory、outbound network disabled、tool call count、bounded response/file bytes、explicit container DELETEをHerta側で強制し、実際の`code_interpreter_call`、output validation、cleanupが完了するまで成功扱いにしない。

Code Interpreter 1 GB session costは2026-08-27確認のcode-reviewed policy `30000 microUSD`。review-afterは`2026-09-27T00:00:00Z`で、期限後は再確認までfail closedする。

## Phase 3 — Image generation

### Provider contract

Phase 3は既存`OpenAiRuntimeGenerationService`のResponses API requestをcapability adapterで拡張する。

```text
AiFoundation
  -> Responses API
  -> tools=[image_generation]
  -> tool_choice={type:image_generation}
  -> max_tool_calls=1
  -> quality=low / size=1024x1024
  -> require actual image_generation_call
  -> bounded JSON read
  -> strict inline base64 decode
  -> binary validation
  -> Discord attachment
```

OpenAI公式Image Generation guideでは、Responses APIの`image_generation` built-in toolが`image_generation_call.result`としてbase64 imageを返す。Hertaはこのinline resultだけを受理する。

Phase 3ではprovider URLを一切downloadしない。`url`返却、またはHTTP(S) URLをresultとして返すresponseは`provider_url_rejected`としてfail closedする。このためprovider生成URLをDiscordへ永続URLとして渡さず、SSRF/download redirect/private-network surfaceも作らない。

### Server-side image policy

Phase 3 Herta policy:

- output files: max `1`
- generated format expected from Responses default: PNG
- validator allowlist: PNG / WebP
- max encoded/decoded image bytes: `4 MiB`
- max width: `2048`
- max height: `2048`
- max total pixels: `4,194,304`
- zero/unknown dimensions: reject
- multi-page/animated payload: reject
- safe filename: existing basename/NFKC policy

Provider result filenameは信用せず、Phase 3 adapterはserver-defined `generated-image.png`を使用する。

### Binary validation order

```text
non-empty + max bytes
  -> safe filename
  -> extension / declared MIME allowlist
  -> PNG/WebP magic-byte sniff
  -> declared MIME / extension / sniffed MIME equality
  -> sharp metadata under pixel/channel limit
  -> width / height / total pixel checks
  -> single-page check
  -> decoder format check
  -> full raw decode under the same bounds
  -> validated AiArtifact(kind=image)
```

`metadata()`だけではtruncated compressed streamを検出できないため、delivery前にfull decodeまで行う。Sharp/libvipsのinput pixel/channel limitとHerta側のdimension/pixel checksを重ね、pathological dimension/decompression bombをbounded memoryでfail closedする。

### Base64 / provider response bounds

`Buffer.from(value, "base64")`だけに依存しない。

- canonical base64 alphabet/padding
- length multiple of 4
- encoded length preflight
- decoded bytes max 4 MiB
- decode後re-encode一致
- empty result reject
- image_generation_call 0件/2件以上 reject
- raw provider JSON自体もbase64上限に対応したbounded read

画像bytes/base64を通常application logやtelemetryへ渡さない。AiFoundationへ返すprovider responseは、actual image tool callとstrict base64取得が確認できた後にusage + short synthetic textだけへsanitizeし、既存の小さいprovider-response guardを維持する。synthetic textはDiscord成功文言には使用しない。

## Image pricing / quota contract

2026-08-27にOpenAI公式pricing / image generation guideで再確認したcode-reviewed policy:

- billing policy model: `gpt-image-2`
- image text input: `$5 / 1M tokens`
- image output: `$30 / 1M tokens`
- `1024x1024`, `quality=low`: approximately `$0.006` image output
- Herta fixed image-output reservation: `6000 microUSD`
- tool-specific concurrency: `2`（Redis prefix `herta:ai:image-generation`）
- image text input reservation: conservative estimated input tokens × `5 microUSD/token`
- existing mainline Responses model token reservation/costは別途AiFoundationが管理

Responses image toolはGPT Image model selectionをprovider側で行うため、Hertaはmodel aliasをrequestで偽装固定しない。pricing policyは現在のGPT Image 2 pricingを明示的にreview対象とし、review-after `2026-09-27T00:00:00Z`以降は再確認・code reviewされるまでimage generationをfail closedする。

image tool costも既存と同じprivacy-preserving Guild quota key/storeへ追加reservationする。mainline modelの最大token見積 + image tool reservationが`perRequestCostLimitMicroUsd`を超える場合はprovider image generation前に拒否する。

## Failure contract

次をfake successしない。

- image/code tool未実行
- provider failure / provider rejection / timeout
- empty image result
- invalid/non-canonical base64
- provider URL return
- multiple image results
- bad magic bytes
- MIME / extension mismatch
- malformed / truncated image
- oversized bytes
- zero/unknown dimension
- dimension / total pixel limit超過
- Artifact validation failure
- Python sandbox policy / output / cleanup failure
- Discord attachment delivery failure

`作成しました` / `実行が完了しました`は、capability実行とvalidationを通過したArtifactからのみ生成する。Discord SDK delivery errorはcallerへ伝播し、成功の二重返信を行わない。

## Logging / privacy

telemetryへ出してよいもの:

- intent
- safe result/error category
- execution/image status
- duration
- provider/mainline model
- artifact count / total bytes
- artifact kind / MIME / size

出さないもの:

- raw user prompt
- raw source code / stdout / stderr
- image bytes / base64
- generated file content
- provider raw response
- Runtime Secret / OpenAI API key / credentials
- provider/user-derived filename

AI Pluginのouter delivery catchでもDiscord error objectをstructured logへ直接渡さず、safe error name/categoryのみ記録する。

## Production impact

Phase 3でも次は変更しない。

- DB migration
- production secret
- `HERTA_AI_ENABLED` default (`false`のまま)
- AOP
- Discord command sync
- production deployの手動実行

Productionではserver-side AI gate + Guild opt-inが引き続き必要。Image GenerationのOpenAI organization verificationがprovider側で必要な場合、その4xxはfake successせずprovider rejectionとして返す。

## Issue #345 acceptance reevaluation

Phase 3でImage Generation / binary validation / Discord attachment / cost-quota-concurrency-timeout-telemetry integrationが完了する。

Issue #345全体のclose可否はPRのfull CI/security/review hardening後に再評価する。Issue bodyに残るartifact UX/orchestration等がAcceptance Criteria外のfollow-up scopeであればclose candidate、未達ACが残る場合はopen維持とする。
