# RAG(検索拡張生成)ロードマップ

`docs/BEDROCK_RAG_EVALUATION.md`(Bedrock/RAGの技術・コスト評価)を踏まえ、Discord内のコミュニケーションデータ(VC発言・chat発言・AI利用意図等)を知識ソースとしたRAG機能の全体ロードマップを記す。本ドキュメントはコード変更を伴わない方針共有であり、各Phaseの実装可否は別途スコープする。

## 背景

ユーザーから「VC発言・chat発言・各々の興味関心・AI利用意図等、様々なデータをRAG対象にしたい」という要望があった。調査の結果、VC発言を扱う機能(音声取得・文字起こし)は実装前は一切存在しなかった。また、個人データの同意・削除に関する仕組み(`docs/PRIVACY_POLICY.md`参照)も本ロードマップの検討に合わせて新設した。

## Phase構成

| Phase | 内容                                                                | 状態                              |
| ----- | ------------------------------------------------------------------- | --------------------------------- |
| 0     | 同意・プライバシー基盤(`UserDataConsent`、`/herta-privacy`コマンド) | 実装済み                          |
| 1     | VC音声取得・文字起こし基盤                                          | 実装済み                          |
| 2     | VC要約振り返り機能(`/vc-recap`)                                     | 実装済み(Discord上の簡易一覧のみ) |
| 2.5   | Studio側のタイムラインUI                                            | 未着手(次のPRへ分離)              |
| 3     | chat発言・AI利用意図のRAG化(opt-in)                                 | 未着手                            |
| 4     | embedding・ベクトルストア・Bedrock Knowledge Base統合               | 未着手                            |
| 5     | データ削除のベクトルストアへの伝播・RAGクエリの監査ログ             | 未着手                            |

Phase 0は`UserDataConsent`/`VcRecapSession`/`VcRecapTranscriptSegment`テーブルと`/herta-privacy`コマンド(voice-consent/delete-voice-data/export)として実装済み。Phase 1-2は`apps/bot/src/voice/`配下と`/vc-recap`プラグイン(`apps/bot/src/plugins/vc-recap.ts`)として実装済み:

- **音声取得**(`vc-recap-session-manager.ts`): `@discordjs/voice`の`VoiceReceiver`でユーザーごとのOpus音声ストリームを購読(Discordはユーザーごとに別ストリームを渡すため話者分離は不要)。`/herta-privacy voice-consent`で同意したメンバーのSSRCのみ購読し、同意していないメンバーの音声は取得しない。
- **文字起こし**(`vc-recap-transcriber.ts`): AWS Transcribe Streaming。ユーザーごとのPCMストリームを個別のTranscribeセッションへ流す。認証情報はRuntime Secret Store(`aws.transcribe_access_key_id`/`aws.transcribe_secret_access_key`)優先、`AWS_TRANSCRIBE_*`環境変数はfallback。
- **要約生成**(`vc-recap-summarizer.ts`): `VcRecapSession`の`consentingUserIds`のみの発言を対象に、既存のAI生成パイプラインとは独立した軽量なOpenAI直接呼び出しで要約を作る(既存の`AiFoundationService`はチャット機能向けのguild opt-in・ガード・レート制限の仕組みと密結合しているため、VC要約という別用途には`resolveAiOpenAiCredential`のcredential解決のみ再利用する設計とした)。

Phase 2.5(Studio側のタイムラインUI)はレビュー単位を適切に保つため次のPRへ分離した。実際の音声I/O・AWS Transcribeとの結合テストはこの開発環境では実機検証ができない(Discord音声接続が無い)ため、単体テスト(同意フィルタリング・認証情報解決・要約パース)のみ実施し、実音声での結合テストは開発Guildでの実機確認が必要(PR本文の「Productionで未確認の項目」参照)。

## Phase 3-5(未着手)

- **chat発言のRAG化**: 既存の`activity-log`プラグインの`message_create`は本文を保存しない設計のため、本文を保存する専用パイプラインを新設する必要がある(本人opt-in必須、`UserDataConsent`を拡張)。activity-logのモデレーション目的とは混在させない。
- **AI利用意図のRAG化**: 現状`ai_generation_events`テーブルにはプロンプト・応答本文が一切保存されていない(トークン数・コスト等のメタデータのみ)。本文を保存する場合は新規テーブルとopt-inフローが必要。
- **embedding・ベクトルストア**: `docs/BEDROCK_RAG_EVALUATION.md`の推奨通りAurora Serverless v2 (pgvector) + Bedrock Knowledge Basesを軸に検討する。AWS側のインフラプロビジョニングが必要なため別途スコープする。
- **削除の伝播**: DBから削除してもベクトルストア側のインデックスには残り得るため、ソースオブジェクト削除+再同期トリガーの設計が必須。
- **RAG検索のguildスコープ**: 自作MCPツール(`apps/bot/src/ai/mcp/herta-tools-server.ts`)が使っている「`guildId`をinput schemaに含めずclosureで固定する」パターンを踏襲し、RAG検索ツールも必ずguild外・opt-outユーザーのデータへ到達できない設計にする。
