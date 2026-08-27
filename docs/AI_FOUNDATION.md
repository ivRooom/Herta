# AI Foundation v1

Hertaの生成AI機能をDiscord/RAG機能から分離し、provider呼び出し前に共通の安全境界を提供するserver-side foundationです。

## Rollout state

- production既定: `HERTA_AI_ENABLED=false`
- implemented provider: `openai` only
- provider credential: Studio Runtime Secret Store `openai.api_key` をprimary source
- `OPENAI_API_KEY`: migration fallback only (secret未登録時のみ)
- model profile / reasoning: Studio global admin向けnon-secret Runtime Settings。未登録時のみallowlisted env defaultを使用
- Guild Plugin configへprovider secret/model/quotaは保存しない
- Discord mention/Q&A surfaceとRAG corpusは後続PR

## Model allowlist

| Profile  | Model           | Standard input / 1M | Standard output / 1M |
| -------- | --------------- | ------------------: | -------------------: |
| quality  | `gpt-5.6-sol`   |               $4.00 |               $20.00 |
| balanced | `gpt-5.6-terra` |               $2.00 |               $12.00 |
| economy  | `gpt-5.6-luna`  |               $0.20 |                $1.20 |

2026-08-26時点のOpenAI standard short-context text token価格をcode-reviewed cost guardとして保持します。Studioへ返すpricing metadataも同じdeterministic cost計算から導出し、UI表示とpreflight/settlementで価格がdriftしないようにします。Herta v1の入力上限は24,000 bytesのため、272K tokens超リクエスト向けの高倍率価格帯には到達しません。cost guardはcached-input割引を前提にせず標準価格で保守的に見積もります。

`gpt-5.6-sol` の $4 / $20 はOpenAIが **2026-11-21まで少なくとも利用可能** と案内しているpromotional pricingです。価格変更後も古い安価な定数で課金を過小評価しないため、Hertaは2026-11-22 UTC以降、pricing constantがcode reviewで更新されるまでSol/quality provider callをfail closedします。期限延長だけでこのguardを無効化しません。

## Runtime model / reasoning settings

Model / reasoningはsecretではないため`runtime_secrets`へ保存せず、typed `runtime_configurations` storeの`ai.runtime`へ保存します。credentialは引き続きRuntime Secret Storeへ分離します。

解決順序は以下です。

1. valid Studio console runtime setting
2. allowlisted env default: `HERTA_AI_PROVIDER` / `HERTA_AI_MODEL_PROFILE` / `HERTA_AI_REASONING_EFFORT`
3. hard-coded safe default: `openai / balanced / low`

server-side policyがprovider、`quality / balanced / economy`、concrete model、modelごとのreasoning allowlist、pricing metadataをSource of Truthとして管理します。clientからarbitrary provider/model/reasoning stringは受け付けません。unsupported combinationや保存済みinvalid valueはsilently downgradeせずfail closedします。non-secret store自体のread failureだけはallowlisted env/defaultへfallbackします。

Botはinstanceごとに5秒TTLのbounded-stale resolverを持ち、request開始時に1つのimmutable runtime snapshotを解決します。同一requestではprovider/model/reasoning/pricingの選択を途中変更せず、複数Bot instanceもTTL内で同じ永続設定へ収束します。Console保存後にproduction deployやBot restartは不要です。

Studio Admin API `/api/admin/runtime-config/ai` はHerta global admin only、mutation Same-Origin、4 KiB bounded body、`Cache-Control: no-store`、server allowlist validationを必須とします。

`HERTA_AI_ENABLED`、kill switch、rate/quota/cost/concurrency等のsecurity guardはConsoleへ移さずserver-side gateとして維持します。

## Default guards

- max input: 8,000 chars / 24,000 bytes
- max output: 800 tokens / 6,000 chars
- timeout: 12s
- provider response body: 512 KiB
- per-user: 6 req / 60s
- per-Guild: 30 req / 60s
- per-Guild budget: $1 / fixed 24h window
- global concurrency: 4
- per-request preflight cost cap: $0.12
- global kill switch: `HERTA_AI_KILL_SWITCH`

preflightの入力token予約はtokenizerの平均圧縮率を仮定せず、UTF-8 byte長を保守的なproxyとして使用します。provider完了後はResponseのauthoritative usageで実コストへsettleします。

現在の価格で24,000-byte input + 800-token outputを最大予約した場合、qualityは $0.112、balancedは $0.0576、economyは $0.00576 です。既定 $0.12 cap は公開済みinput/output boundを全profileで到達可能にしつつ、1 requestの異常な費用をserver-sideで制限します。管理者がenvで既定より低いcapを明示した場合は、そのcost policyが優先されます。

Guild quotaはwindow開始時にだけTTLを設定します。2回目以降のaccepted reservationで期限を延長せず、reservation hashもquota total keyの残TTLへ合わせます。settle後にtotalが0になっても既存TTLを維持し、quota超過時の`retryAfterMs`は現在のfixed window残時間を返します。

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
11. provider/model/reasoning allowlist
12. current code-reviewed pricing guard

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

Redis rate/quota keyではraw Guild ID / User IDをSHA-256由来の短いprivacy keyへ変換します。telemetry sinkはuser-facing response/errorの完了をblockしないbest-effort deliveryとし、sink failureやstallをprovider requestの成功/失敗へ伝播させません。

## OpenAI Responses API

- endpoint: `/v1/responses`
- `store:false`
- `truncation:'disabled'`
- `reasoning.effort`: request開始時に解決したserver-side runtime snapshotのallowlisted値
- `max_output_tokens` server-side bound
- AbortController timeoutをHTTP headers受信だけでなくresponse body完読まで適用
- bounded provider response parsing
- top-level `status=incomplete` を成功扱いせず、`max_output_tokens`は`output_too_large`、その他のincomplete/non-completed statusはprovider rejectionとして扱う

`store:false`はHerta側のprivacy方針の一部ですが、provider側のabuse-monitoring retention等をゼロにする保証として扱いません。

## Production rollout

Gate 0 / AOPとCredential Consoleを先に完了します。

1. #328/#333等のorigin protection deployment pathをproductionへ反映
2. Cloudflare Global AOPを有効化しCloudflare経由200 / direct-origin TLS拒否を確認
3. Credential Console migrationと`runtime_configurations` migrationをproduction手順に従って適用
4. `HERTA_RUNTIME_SECRET_KEY` をserver-sideへ一度設定
5. Studio SettingsからOpenAI API keyを登録
6. AI Runtime Settingsのread/saveとBot bounded-stale refreshを確認
7. Semantic Search等でconsole credentialを確認
8. AI Foundation自体は `HERTA_AI_ENABLED=false` のままdeploy
9. Discord Q&A/RAG surface完成後、限定Guildでopt-inして段階有効化

## Emergency response

Provider障害・予算異常・abuse疑い時は最優先で `HERTA_AI_KILL_SWITCH=true`。非AI機能は継続できる設計を維持します。
