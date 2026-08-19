# Studio Command Palette Search

Herta Studio の Command Palette は、ローカルの lexical / intent ranking を常に基準にし、任意で server-side semantic score を第二 signal として追加します。

## 検索順序

1. label exact
2. keyword exact
3. label prefix
4. keyword prefix
5. lexical phrase / token match
6. static intent match
7. semantic similarity

Semantic候補はlexical結果の後ろにだけ追加します。Providerが高いscoreを返しても、既存のexact / prefix / lexical結果を追い越しません。非空検索の最終結果は20件までです。

## Provider

`STUDIO_SEMANTIC_SEARCH_PROVIDER=disabled` が既定です。この状態では外部providerを使用せず、従来のlexical / intent検索だけで動作します。

`openai` を設定した場合、Studio serverからOpenAI Embeddings APIを利用します。API keyは`OPENAI_API_KEY`としてStudio serverだけへ渡し、Client Componentや`NEXT_PUBLIC_*`へ公開しません。モデルは`OPENAI_EMBEDDING_MODEL`で変更でき、未設定時は`text-embedding-3-small`です。

現Phaseではnavigation corpusが小さく更新頻度も低いため、DB migrationやpgvector indexを先に導入せず、request時にserver-side providerでscoreを計算します。永続vector storeを導入する場合は、model / dimension / version / reindex手順をDB metadataとして管理する別Phaseにします。

## Privacy boundary

Providerへ送るCommand documentは次の静的navigation metadataだけです。

- label
- keywords
- intents
- command group
- Guild IDを`{guildId}`へ置換したroute

次の情報はdocumentへ含めません。

- Discord message本文
- Moderation検知本文
- Guild名
- 実Guild ID
- Bot Token / Secret
- ユーザー生成コンテンツ

Semantic Searchを有効化した場合、ユーザーがCommand Paletteへ入力した検索query自体はsemantic rankingのためproviderへ送信されます。query本文はHertaのstructured logへ保存せず、provider failure logにはfailure種別、candidate数、Guild contextの有無、処理時間だけを記録します。

## Security / authorization

`POST /api/search/semantic` は以下をserver-sideで強制します。

- NextAuth session必須
- Same-Origin必須
- `application/json`必須
- request body 2 KiB上限
- query 100文字上限
- authenticated user単位20 requests / 60 seconds
- Guild ID形式validation
- Guild context利用時はDiscord OAuth tokenから管理可能Guildを再確認
- provider timeout 1200ms
- provider response 2 MiB上限
- score 0..1 validation
- semantic threshold 0.42

Rate limitは現在Studio process内の固定windowです。複数Studio replicaへ水平分割する場合はRedis等の共有rate limiterへ移行します。

## Failure behavior

Semantic providerのtimeout、network failure、non-2xx、malformed response、設定不足ではHTTP UIを停止させず`fallback`として扱います。Command Paletteは入力直後からlocal lexical結果を表示しており、provider応答を待たずにキーボード操作・Enter遷移を継続できます。

Client側もquery / Guild contextごとにsemantic responseを関連付け、古いrequestの結果を現在の検索へ混ぜません。

## 次Phase

- navigation document embeddingのcache / pre-index化
- pgvector採用時のmodel / dimension / version metadataとreindex設計
- distributed rate limit
- raw queryを保存しないsemantic採用率 / zero-result率 / latency観測
- click-through / selected result rankのprivacy-safe集計
