# AWS Bedrock移行 / RAG導入 検討メモ

Herta AI Foundationを AWS Bedrock 経由へ移行すべきか、将来のRAG機能をどう作るべきかの調査メモです。実装のscope決めではなく、意思決定材料としての整理を目的とします。

## 結論（要約）

- **現状（4プロバイダ直接API・利用量ほぼゼロ）でのBedrock全面移行は推奨しない**。トークン単価はほぼ変わらず、OpenAI/Google/Moonshotは移行できないため恩恵が薄い
- **RAGを本格的に作るタイミングでは、Bedrock Knowledge Basesの部分採用を検討する価値がある**。埋め込み生成・ベクトル検索・引用付き応答をマネージドで組める
- Knowledge Basesを使う場合、**ベクトルストアの選択がコストを大きく左右する**（後述）。既定のOpenSearch Serverlessは小規模利用では固定費が重い

## 1. 現状のAI Foundation構成（前提の整理）

`docs/AI_FOUNDATION.md` の通り、Hertaは以下の構成です。

- provider抽象化: `AiRuntimeGenerationService`インターフェースに対し、OpenAI/Anthropic/Google/Moonshotそれぞれの`*RuntimeGenerationService`実装がある（`apps/bot/src/ai/runtime-service.ts`）
- credential: Studio Runtime Secret Store優先、env fallback。provider追加時もこの二重構成に合わせる必要がある
- pricing: `packages/plugin-catalog/src/ai-service.ts`の`*_STANDARD_PRICING`定数がcost guard・quota計算のsource of truth
- RAG / web retrievalは`AI_FOUNDATION.md`に明記の通り「後続scope」で、現状は未実装
- 本番のAI利用実績は現時点で0件（`ai_generation_events`確認済み）

この抽象化のおかげで、Bedrockを追加するとしても「新しい`BedrockRuntimeGenerationService`を1つ実装し、`services`マップに登録する」だけで既存コードへの侵襲は小さい設計になっている。

## 2. Bedrockで何が変わるか

### 対応・非対応モデル

| プロバイダ            | Bedrock対応 | 備考                                               |
| --------------------- | :---------: | -------------------------------------------------- |
| Anthropic (Claude)    |     ✅      | Bedrock経由でも直接APIとほぼ同一モデルラインナップ |
| Meta (Llama)          |     ✅      | Herta未使用                                        |
| Amazon (Nova / Titan) |     ✅      | Herta未使用                                        |
| Mistral               |     ✅      | Herta未使用                                        |
| **OpenAI**            |     ❌      | Bedrock非対応。移行するとOpenAI providerを失う     |
| **Google (Gemini)**   |     ❌      | 同上                                               |
| **Moonshot (Kimi)**   |     ❌      | 同上                                               |

→ 「Bedrockへ全面移行」は実質「Claude系のみ残し、OpenAI/Google/Moonshotを切り捨てる」ことを意味する。4プロバイダ対応を維持したいなら、**Bedrock(Claude) + 既存3プロバイダ直接APIのハイブリッド構成**にしかならない。

### 料金

BedrockのClaudeは、Anthropic直接APIとほぼ同一の入出力トークン単価で提供される（Bedrock側が別建てのディスカウント価格を用意しているわけではない）。つまり、**トークン単価の引き下げを目的にした移行効果はほぼ無い**。

Bedrockに乗り換えるメリットは単価ではなく、以下の運用面にある。

- 認証がAPIキー管理からIAMロールベースに変わる（今回のバックアップ障害対応で経験したような「APIキーのローテーション忘れ・漏洩リスク」がAWS内で完結する）
- 請求がAWS請求に統合される
- Bedrock Guardrails（コンテンツフィルタ）・Bedrock Knowledge Bases（RAG）など周辺マネージドサービスとの統合が容易

### Fine-tuning

- Claude: Bedrock経由でも**ファインチューニング非対応**（Anthropicがこの機能自体を提供していない）
- Titan / Llama / Mistral系: Bedrockでファインチューニング・継続事前学習に対応

Herta用途で「学習（fine-tuning）をちゃんとやりたい」なら、Claudeを使い続ける限りBedrockに移行してもこの点は変わらない。Titan/Llama系への切り替えが前提になる。

## 3. RAGについて: Bedrock Knowledge Basesの価値

自前でRAGを組む場合、最低限以下が必要になる。

1. 文書の取り込み・チャンク分割
2. 埋め込み生成（embedding API呼び出し）
3. ベクトルストアへの格納・インデックス管理
4. クエリ時の類似検索
5. 検索結果をプロンプトへ組み込む処理・引用管理

Bedrock Knowledge Basesは1〜5をマネージドで提供する（データソースをS3等に置くと自動で取り込み・埋め込み・インデックス更新まで面倒を見る）。**自前実装と比べて設計・運用コストは明確に下がる**。これは「RAGちゃんとできそう」というユーザーの直感は正しい。

### 重要な注意: ベクトルストアの選択でコストが大きく変わる

Bedrock Knowledge Basesは裏側のベクトルストアを選べる。

| ベクトルストア                                                      | 小規模利用時の特徴                                                                                                                             |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Amazon OpenSearch Serverless**（既定でよく案内される）            | 最小課金ユニット(OCU)が存在し、**使わなくても最低限の固定費が発生**する。目安として月$700前後からになりやすく、Hertaのような低頻度利用には過剰 |
| **Amazon Aurora PostgreSQL (pgvector) Serverless v2**               | ACU単位の従量課金で、アイドル時は最小容量まで縮小できる。低頻度利用なら大幅に安い                                                              |
| Pinecone / MongoDB Atlas / Redis Enterprise Cloud（サードパーティ） | Bedrock外の別サービス契約が必要。無料枠があるプランも存在                                                                                      |

→ 実装する場合は**Aurora Serverless v2 (pgvector) をベクトルストアに選ぶ**のが、Herta の利用規模（Discord Bot、断続的なAI利用）には現実的。OpenSearch Serverlessをそのまま使うと「RAGのために毎月$700以上の固定費」という本末転倒になりやすい。

## 4. 概算コスト（目安）

**重要**: 以下はAWS公開価格の一般的な水準に基づく概算であり、このセッションではAWS Pricing API連携が一時的に切断されていたため最新価格の直接照会はできていません。実施判断の直前に AWS Pricing Calculator で再確認してください。

### ケースA: 現状維持（直接API、4プロバイダ）

- Herta既存の`AI_DEFAULTS`のGuild quota（$1 = 1,000,000 micro USD）が示す通り、1 Guildあたり月$1相当を上限にする設計。低〜中利用なら**月数ドル〜数十ドル**で収まる想定（実利用ゼロの現状はこれ未満）
- 固定費なし（従量課金のみ）

### ケースB: Bedrock(Claude)へ一部移行、RAGなし

- トークン単価は現状とほぼ同額のため、**追加コストはほぼ無い**（AWS請求へ移るだけ）
- 実装工数（新Runtime Service 1つ分）が主なコスト

### ケースC: Bedrock Knowledge Basesを追加（RAG導入）

- Aurora Serverless v2 (pgvector) 選択時: アイドル時最小容量(0.5 ACU程度)であれば**月$40〜$60程度**からが目安（使用量に応じて増加）
- OpenSearch Serverless選択時: 最小構成でも**月$700前後**が固定で発生（利用量に関わらず）
- 埋め込み生成コスト: 取り込む文書量次第だが、Titan Embeddings等は$0.0001/1K tokens前後と安価。文書量が少なければ無視できる水準
- Bedrock Knowledge Basesのクエリ実行自体には追加のBedrock側手数料は無く、裏側のベクトルストア＋通常のモデル呼び出し課金のみ

→ **RAGをやるなら、ベクトルストアにAurora Serverless v2を選ぶ前提で月$50〜$100程度からのスモールスタートが現実的**。OpenSearch Serverlessを既定のまま使うと固定費だけで一桁跳ね上がる点に要注意。

## 5. 推奨ロードマップ

1. （今回はここまで）調査・設計方針の共有のみ。コード変更なし
2. RAGで扱いたい具体的なユースケース（例: サーバー独自のFAQ・ルール文書を参照して回答する、等）が固まったら、Bedrock Knowledge Bases + Aurora Serverless v2(pgvector) を前提に小規模PoCを設計する
3. PoCが機能要件を満たせば、`BedrockRuntimeGenerationService`を`AiRuntimeGenerationService`実装として追加し、既存のマルチプロバイダ構成に統合する（OpenAI/Google/Moonshotは維持したまま、Claude呼び出し経路だけBedrock経由に切り替え可能にする設計が無理なく可能）
4. 全面移行は行わず、既存4プロバイダ構成 + Bedrock(RAG用途) のハイブリッドを基本方針とする
