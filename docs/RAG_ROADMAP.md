# RAG(検索拡張生成)ロードマップ

`docs/BEDROCK_RAG_EVALUATION.md`(Bedrock/RAGの技術・コスト評価)を踏まえ、Discord内のコミュニケーションデータ(VC発言・chat発言・AI利用意図等)を知識ソースとしたRAG機能の全体ロードマップを記す。本ドキュメントはコード変更を伴わない方針共有であり、各Phaseの実装可否は別途スコープする。

## 背景

ユーザーから「VC発言・chat発言・各々の興味関心・AI利用意図等、様々なデータをRAG対象にしたい」という要望があった。調査の結果、VC発言を扱う機能(音声取得・文字起こし)は実装前は一切存在しなかった。また、個人データの同意・削除に関する仕組み(`docs/PRIVACY_POLICY.md`参照)も本ロードマップの検討に合わせて新設した。

## Phase構成

| Phase | 内容                                                                | 状態                       |
| ----- | ------------------------------------------------------------------- | -------------------------- |
| 0     | 同意・プライバシー基盤(`UserDataConsent`、`/herta-privacy`コマンド) | 実装済み                   |
| 1     | VC音声取得・文字起こし基盤                                          | 設計のみ(未実装、下記参照) |
| 2     | VC要約振り返り機能(`/vc-recap`、Studioタイムライン)                 | 設計のみ(未実装、下記参照) |
| 3     | chat発言・AI利用意図のRAG化(opt-in)                                 | 未着手                     |
| 4     | embedding・ベクトルストア・Bedrock Knowledge Base統合               | 未着手                     |
| 5     | データ削除のベクトルストアへの伝播・RAGクエリの監査ログ             | 未着手                     |

Phase 0は`UserDataConsent`/`VcRecapSession`/`VcRecapTranscriptSegment`テーブルと`/herta-privacy`コマンド(voice-consent/delete-voice-data/export)として実装済み。Phase 1-2(実際の音声取得・文字起こし・要約生成)は、以下の技術設計はこのPRの計画段階で固めたが、実装は見送った:

- **音声取得**: `@discordjs/voice`の`VoiceReceiver`でユーザーごとのOpus音声ストリームを購読(Discordはユーザーごとに別ストリームを渡すため話者分離は不要)。
- **文字起こし**: AWS Transcribe Streaming。ユーザーごとのPCMストリームを個別のTranscribeセッションへ流す。
- **要約生成**: `VcRecapSession`の`consentingUserIds`のみの発言を対象に、既存のAI生成パイプラインとは独立した軽量なLLM呼び出しで要約を作る(既存の`AiFoundationService`はチャット機能向けのguild opt-in・ガード・レート制限の仕組みと密結合しているため、VC要約という別用途に流用するには別途設計判断が必要と判断し、見送った)。

実装を見送った理由: 実際の音声I/O・AWS Transcribeとの統合はこの開発環境では実機検証ができず(Discord音声接続・AWS資格情報のいずれも利用不可)、動作未検証のまま大量のコードをマージするリスクが高いと判断したため。Phase 1-2の実装は、実機検証が可能な環境・タイミングで別途スコープする。

## Phase 3-5(未着手)

- **chat発言のRAG化**: 既存の`activity-log`プラグインの`message_create`は本文を保存しない設計のため、本文を保存する専用パイプラインを新設する必要がある(本人opt-in必須、`UserDataConsent`を拡張)。activity-logのモデレーション目的とは混在させない。
- **AI利用意図のRAG化**: 現状`ai_generation_events`テーブルにはプロンプト・応答本文が一切保存されていない(トークン数・コスト等のメタデータのみ)。本文を保存する場合は新規テーブルとopt-inフローが必要。
- **embedding・ベクトルストア**: `docs/BEDROCK_RAG_EVALUATION.md`の推奨通りAurora Serverless v2 (pgvector) + Bedrock Knowledge Basesを軸に検討する。AWS側のインフラプロビジョニングが必要なため別途スコープする。
- **削除の伝播**: DBから削除してもベクトルストア側のインデックスには残り得るため、ソースオブジェクト削除+再同期トリガーの設計が必須。
- **RAG検索のguildスコープ**: 自作MCPツール(`apps/bot/src/ai/mcp/herta-tools-server.ts`)が使っている「`guildId`をinput schemaに含めずclosureで固定する」パターンを踏襲し、RAG検索ツールも必ずguild外・opt-outユーザーのデータへ到達できない設計にする。
