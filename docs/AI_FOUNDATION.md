# AI Foundation v1

Hertaの生成AI機能をDiscord/RAG機能から分離し、provider呼び出し前に共通の安全境界を提供するserver-side foundationです。

## Rollout state

- production既定: `HERTA_AI_ENABLED=false`
- provider: `openai` only
- provider credential: Studio Runtime Secret Store `openai.api_key` をprimary source
- `OPENAI_API_KEY`: migration fallback only (secret未登録時のみ)
- Guild Plugin configへprovider secret/model/quotaは保存しない
- Discord mention/Q&A surfaceとRAG corpusは後続PR

## Model allowlist

| Profile  | Model           | Standard input / 1M | Standard output / 1M |
| -------- | --------------- | ------------------: | -------------------: |
| quality  | `gpt-5.6-sol`   |               $4.00 |               $20.00 |
| balanced | `gpt-5.6-terra` |               $2.00 |               $12.00 |
| economy  | `gpt-5.6-luna`  |               $0.20 |                $1.20 |

2026-08-26時点のOpenAI標準text token価格をcode-reviewed constantとして保持します。Herta v1の入力上限は24,000 bytesのため、272K tokens超リクエスト向けの高倍率価格帯には到達しません。cost guardはcached-input割引を前提にせず標準価格で保守的に見積もります。

## Default guards

- max input: 8,000 chars / 24,000 bytes
- max output: 800 tokens / 6,000 chars
- timeout: 12s
- provider response body: 512 KiB
- per-user: 6 req / 60s
- per-Guild: 30 req / 60s
- per-Guild budget: $1 / 24h
- global concurrency: 4
- per-request preflight cost cap: $0.03
- global kill switch: `HERTA_AI_KILL_SWITCH`

preflightの入力token予約はtokenizerの平均圧縮率を仮定せず、UTF-8 byte長を保守的なproxyとして使用します。provider完了後はResponseのauthoritative usageで実コストへsettleします。

`quality` profileの最大入力+最大出力は既定$0.03 request capを超え得ます。これは意図したcost guardで、qualityを使う場合も無条件にcapを広げず、利用実績を確認してserver-side envで明示調整します。

## Enablement gates

Provider callにはすべて必要です。

1. global `HERTA_AI_ENABLED=true`
2. kill switch OFF
3. server-side authorization OK
4. request Guild scope一致
5. AI Plugin enabled
6. Guild config `enabled=true` opt-in
7. bounded input
8. per-user / per-Guild rate limit
9. per-Guild quota reservation
10. global concurrency lease
11. provider/model allowlist

## Credential resolution

Bot-side factory `apps/bot/src/ai/factory.ts` は次の順でOpenAI credentialを解決します。

1. encrypted Runtime Secret Store `openai.api_key`
2. secret-store readが成功しsecret未登録の場合のみ `OPENAI_API_KEY`
3. DB/master key/decrypt等のsecret-store read障害はfail closed

Runtime Secret Storeのreadに失敗した場合はcredentialの有無を安全に判定できないため、legacy env fallbackへ逃がしません。credential値はstructured log、telemetry、Plugin configへ出しません。

## Error taxonomy

外部surfaceへ流すcategoryは以下だけです。

- `disabled`
- `unauthorized`
- `rate_limited`
- `quota_exceeded`
- `invalid_input`
- `timeout`
- `provider_unavailable`
- `provider_rejected`
- `malformed_response`
- `output_too_large`
- `internal_error`

Provider本文/error bodyをそのまま利用者やlogへ返しません。

## Privacy / observability

raw prompt / raw responseはdefaultで永続保存・structured loggingしません。許可するAI telemetry metadataは以下です。

- requestId
- feature
- provider
- model
- latency
- input/output/total tokens
- estimated cost
- result category
- error category

Redis rate/quota keyではraw Guild ID / User IDをSHA-256由来の短いprivacy keyへ変換します。

## OpenAI Responses API

- endpoint: `/v1/responses`
- `store:false`
- `truncation:'disabled'`
- `reasoning.effort:'low'`
- `max_output_tokens` server-side bound
- AbortController timeoutをHTTP headers受信だけでなくresponse body完読まで適用
- bounded provider response parsing

`store:false`はHerta側のprivacy方針の一部ですが、provider側のabuse-monitoring retention等をゼロにする保証として扱いません。

## Production rollout

Gate 0 / AOPとCredential Consoleを先に完了します。

1. #328/#333等のorigin protection deployment pathをproductionへ反映
2. Cloudflare Global AOPを有効化しCloudflare経由200 / direct-origin TLS拒否を確認
3. Credential Console migrationを適用
4. `HERTA_RUNTIME_SECRET_KEY` をserver-sideへ一度設定
5. Studio SettingsからOpenAI API keyを登録
6. Semantic Search等でconsole credentialを確認
7. AI Foundation自体は `HERTA_AI_ENABLED=false` のままdeploy
8. Discord Q&A/RAG surface完成後、限定Guildでopt-inして段階有効化

## Emergency response

Provider障害・予算異常・abuse疑い時は最優先で `HERTA_AI_KILL_SWITCH=true`。非AI機能は継続できる設計を維持します。
