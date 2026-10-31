# VC Recap 長期保存・本人削除・Whisper導入設計（実装前ゲート）

作成: 2026-10-30。正本: Herta GitHub main、#577〜#585、#518。本書は**設計仕様**であり本番稼働の説明ではありません。現行の文字起こし本文は30日保持後に削除され、音声ファイルは永続保存されません。既存の同意やプライバシー表示は、新機能リリースまでは現行仕様を適用します。

## 確定方針とリリース禁止条件

- **長期保存はデフォルトOFF。** 本人の新しい明示同意、本人削除の実行・検証、公式ポリシーの適用、Guild IAM/監査、Backup/Restore/削除再適用の検証が完成するまで有効化してはならない。
- **文字起こし本文:** 新たに長期保存同意された個人分のみ、0〜365日はPostgreSQLを第一候補とし、それ以降は検証後S3へアーカイブ。365日は**移行基準であり削除期限ではない**。自動完全削除期限を設けない。本文単体の寿命をセッション要約の寿命と混同しない。
- **音声:** 新しい録音・長期保存同意のある話者のみ、受信時点からS3 Standardに暗号化保存。30日後に低頻度アクセス向けクラスへ移行し、180/365日を理由に削除しない。話者別Ogg/Opus等で一括削除可能な粒度を維持する。
- 既存「文字起こし本文30日保存」同意・文字起こし処理同意・自動同意ロール・管理者付与を、**新しい文字起こし本文長期保存同意や音声録音同意として流用しない**。拒否を最優先にする。
- データ主体からの削除依頼、サービス終了・法令/利用規約の変更、特定の削除法定義務がある場合は長期保存の例外。利用目的を離れた無条件な永続保持ではない。

## データフローと信頼境界

```text
[Discord VC] → [Bot / Guild・本人同意チェック]
                   ├─ [文字起こし処理 / AWS Transcribe 又は private Whisper Worker]
                   │          └─ [本文 / PostgreSQL（365日以下）] → [検証付きArchive Worker] → [専用非公開S3（365日超）]
                   └─ [録音長期同意チェック] → [話者別Opusチャンク] → [専用非公開S3 Standard]
                                                                   └─ S3 Lifecycle（30日経過後、低頻度クラス）
[Studio] → [認証・Guild IAM・アクセス毎に本人削除状態を確認するAPI] → [PG / S3]
[本人削除受付] → [停止・閲覧禁止] → [冪等削除ジョブ] → [PG / S3全Version / 復元コピー / 共有要約]
                                                 ↘ [復元時tombstone再適用・監査]
```

S3長期保存領域は、既存のPostgreSQLバックアップ用S3とは**別バケット・別IAMポリシー**にする。2026-10-30に本番AWS read-only照会した既存Herta PostgreSQLバックアップバケットには `postgres/` 配下に「180日後削除」のLifecycleがあるため、長期音声・本文を混入させない。Block Public Accessを全て有効、SSE-KMS等の暗号化、TLS、最小権限、S3公開禁止、キーに本文・ユーザー名を含めない、監査ログは本文/音声を記録しない。署名付きURLは短寿命・権限再検証付きとし、削除・同意撤回時のURL失効遅延を脅威モデルに含める。

### DBモデル（新しい同意・削除フェンスの基盤はmainに導入済み）

- **実装済みの基盤（PR #601）**: `VcRecapExplicitConsent` は `userId + purpose` の複合主キー、`policyVersion`, `consentedAt`, `revokedAt`, `updatedAt` を保持する。目的値は `transcription`, `transcript_long_term`, `audio_long_term`, `openai_audio_processing`。`VcRecapErasureRequest` は `userId`, `requestedAt`, `storageDeletionVerifiedAt`, `updatedAt` を保持する。旧同意からの自動移行はしない。
- **今後必要**: UIで提示した文書版・本人操作・拒否・撤回の監査証跡と、削除ジョブの詳細状態は現在の同意基盤だけでは足りない。履歴テーブルまたは追記専用監査記録の設計・Migrationを別途実装し、旧ロール付与を本人の新同意と誤認しない。
- `VcRecapAudioAsset`: `id`, `sessionId`, `guildId`, `userId`, `objectKey`, `versionId`, `checksum`, `byteLength`, `codec`, `startOffsetMs`, `endOffsetMs`, `storageClass`, `status`。同一話者の連続小発話はチャンク結合し、発言セグメントは `audioAssetId + offsetMs` で参照。
- `VcRecapArchiveIndex`: `sessionId`, `guildId`, `userId`, `archiveVersion`, `manifestKey`, `objectVersionId`, `segmentCount`, `checksum`, `status`, `archivedAt`。本文オブジェクトはユーザー単位で分け、個人の削除で無関係な人の内容を保持できるようにする。
- **今後必要**: 冪等な削除ワーカーに `requestId`, `userId`, `scope`, `status`, `attempts`, `errorCode` と対象オブジェクト全バージョンの処理記録を追加する。既存 `VcRecapErasureRequest` のフェンスはあるが、S3消去実行・検証とバックアップ復元時の再適用は未実装。Private作業キューと拒否・削除tombstoneは復元対象のバックアップより**独立した耐久領域**に保持する。
- 既存 `VcRecapTranscriptSegment.id` を外部照合用の不変IDとして使う。旧同意に紐づく本文は引き続き30日以内に削除。本文とサマリー/トピックが同一スコープでない場合は本人削除時に要約を全体消去する。

### アーカイブ処理（冪等）

`pending → uploading → uploaded → verified → manifested → indexed → pruned`。候補は365日を超え、かつ**新同意の証跡が存在し削除要求のない**セッション/ユーザー本文だけ。再試行は一意のジョブ/オブジェクトIDとDB CAS/ロックを利用。S3 PUT/HEADと本文SHA-256、件数、スキーマ・バージョン、Object VersionIdを照合し、manifestを確定した後でDB参照を切り替える。取得テストが通った対象だけDB本文をprune。書き込み失敗・不一致・停止時はDB本文を残しエラーを通知。本人削除と競合したジョブは削除優先、アーカイブを公開しない。S3に残った孤児オブジェクトも照合・削除対象。

### 本人削除・同意撤回（本番有効化の必須条件）

1. `/herta-privacy` から本人確認済みの要求を受け、直ちに新規収集・保存を停止し、API/エクスポート/署名URL発行を遮断。Guild横断の本人データを索引とDBから抽出。
2. 発話中のOpus購読、キュー、Whisper処理、未確定multipart、DB insertを取消し、セッション対象データを凍結。
3. ユーザーに紐づくDB本文・音声・アーカイブ索引・検索索引・キャッシュ・一時ファイル、S3現行/Noncurrentバージョン・レプリカ・復元コピーを検証付きで削除。混合要約に本人情報が残り得るなら要約全体を削除。
4. S3 API失敗時は`pending_retry`で監査・再試行し、`completed`と通知しない。全コピー確認後にのみ完了。削除証跡は機密情報を最小限にする。
5. DB/S3バックアップは保存・削除可能範囲・最終消去期限を明示し、復元時は**新規読取/書込再開前**に削除tombstoneを再適用。これが保証できない場合、対象データの復元は禁止する。

法令上の保持義務、既存版の保存不可条件など例外の判断は、プライバシー窓口の公開文書と一致させる。

## Whisper選定（合成音声CIのみ成功、実機は未評価）

`faster-whisper`の導入候補はDraft PR #658で本人同意・書込フェンスを強化済みですが、Pythonベースの本番コンテナに未修正のHigh脆弱性がありマージ・起動禁止です。代替の`whisper.cpp`ネイティブCPUワーカーはDraft PR #674 / Issue #672で独立検証中です。AMD64/ARM64の静的イメージ検査と1/8秒合成無音の推論、HTTP切断時の子プロセス強制終了は専用CI #41211579277で成功しました。ただし本番2GiBホストの最大RSS、日本語CER、実音声と本人同意・削除E2Eは**未検証**であり、現行AWS Transcribe経路を維持します。

最終的な選択は同一の許諾済み音声を用いた日本語CER、固有名詞、雑音、話者別2/5人、RTF、最大RSS、待機時間と運用費で決めます。Botと推論ワーカーを分離し、CPU/RAM/pids/queue制限・private Docker network・健康診断と本人撤回時の推論/DB書込停止を要求します。採用候補はA=Whisper専用（実測合格時に優先）、B=Whisper標準+Studio手動AWS、C=AWS無料枠先行+auto（追加複雑性に見合う場合のみ）。課金方向への自動フォールバックは禁止します。録音S3保存と文字起こし処理は独立させます。

## 音声ストレージクラス評価ゲート

- **Standard:** 小容量・高頻度アクセス・オブジェクト多数に適するがGB単価が高い。
- **Standard-IA:** 即時読取可能。ただし最小128KiB課金、30日最低保存期間、GET取り出し料、移行リクエスト料金に注意。2026年のAWS仕様で30日未満からのLifecycle transition自体は可能だが、当計画は運用方針として30日後を使用する。
- **Intelligent-Tiering:** 128KiB未満は監視/自動階層化の対象外。大きなオブジェクトは監視課金とアクセス頻度に応じて比較する。
- **Glacier Instant Retrieval:** 即時読取だが最小128KiB、90日最低保存期間、取り出し/遷移料金があり、頻繁なStudio再生に不利になり得る。Flexible/Deepは復元遅延があるので即時再生の既定にしない。
- **選択条件:** 東京リージョンのその時点の通常S3価格、1チャンク平均サイズ、チャンク数、アクセス頻度、S3 PUT/GET/遷移リクエスト、SSE-KMS、転送、最低期間を含めた1/3/5年試算で決定。オブジェクトを安易に細分化しない。Standard-IAが不利ならStandard/Intelligent-Tieringを選ぶ。

## Studio・エクスポート

現行mainには、PR #602による話者・時刻・アイコン付き吹き出し、連続発話グループ化、発言者・本文検索が実装されています。PR #603/#606で30日保持中のPostgreSQL本文に対するJSON/CSV出力、複数セッション・期間・VC・発言者指定、専用IAMの明示許可、監査、CSV Formula Injection対策も実装済みです。出力上限は5,000発言です。後続mainの本番デプロイWorkflow成功は確認済みですが、認証済み画面・ダウンロード実機受入は別途必要です。

**未実装の将来機能:** 365日超S3アーカイブ本文の取得・出力、セッション単位の大量ストリーミング出力、話者別音声再生・速度/シーク/発話ハイライト、hot/archive/audio/削除状態、Worker/Whisper/保存容量・料金管理。Guild境界、本人削除障壁、本文/音声別の最小権限、アクセスごとの再認可、短期署名URLまたは認可プロキシ、監査と復元エラー表示を必須条件とします。

## 受入テスト・運用手順

- 単体: 同意バージョン、拒否優先、撤回後の停止、ユーザー別削除/共有要約、Guild ID認可、CSV injection、二重ジョブ・S3エラー・チェックサム不一致。
- 統合: 30日音声transition、180/365日経過後の音声残存、365日本文移行後の本文表示/JSON/CSV、署名URL失効、S3 Versioning全バージョン削除、バックアップ復元→tombstone再適用、Bot/Worker再起動。
- Discord E2E: 許諾済み音声で `/vc-recap start → 発言 → stop → 要約/Studio → 再生 → JSON/CSV → Archive → 本人削除 → DB/S3全コピー検証`。
- リリース順: (1) Studio UI/安全なexport (2) 新ポリシー草案・同意schema/UI (3) 削除基盤+復元受入 (4) Whisper比較+分離Worker (5) S3録音/権限/Lifecycle (6) 365日archive (7) 新ポリシー公開、本人同意取得後canary (8) CI/E2E/監視/コスト実測。テストが不十分ならOFFを維持する。
- ロールバック: 機能フラグと収集停止が第一。S3データ/既存DBの削除を伴うスキーマrollbackはしない。新DB migrationは後方互換で段階導入し、復旧前にバックアップと復元可能性を検証する。

## プライバシーポリシー原稿に必要な項目

文字起こし処理と長期本文保存と音声録音・長期保存を別個の明示同意とし、保存目的（過去のVC閲覧・検索・要約）、保存期間（通常の自動削除期限を設けない）、DB 365日→S3移行、録音初日S3 Standard→30日低頻度階層化、Guild権限・要約/本文/ダウンロード別IAM、CSV/JSON出力、外部AWS/OpenAI送信、本人撤回・削除依頼の受付/確認/完了条件、バックアップ消去・復元時再適用、サービス終了時の処理、第三者と法的例外、法令/Discord/API利用条件との照合を明記。**機能が実装されるまで、本書を「現行で収集/保存中」と説明する文書に流用しない。**

## 現時点の実装差分（2026-10-31 GitHub main確認）

- **チャット型表示:** PR #602 はmainにマージ済み。本番表示とモバイルE2Eは未確認。
- **JSON/CSV:** PR #603 はmainにマージ済み。専用IAM強化はPR #606。大量出力、アーカイブ対応、本番検証は残る。
- **新同意基盤:** PR #601で `VcRecapExplicitConsent` と `VcRecapErasureRequest` がmainに入った。正式ポリシー版、本人同意UI、監査証跡、バックアップ復元安全性は未完成。
- **音声認識切替:** PR #607はAWS既定のままOpenAI音声APIへの明示同意付き切替を追加した。`faster-whisper` の本番移行PR #658はCVE未解決でDraft。代替`whisper.cpp`のDraft PR #674は合成音声・セキュリティCIを通過したが、Bot+Compose統合、本番RSS/RTF/CER、本人撤回E2E未完了で本番OFF。
- **現行本文:** `VC_RECAP_TRANSCRIPT_RETENTION_DAYS = 30` でWorkerが定期削除する。旧同意データの保存期限を延長しないため、新同意データだけを分離管理する必要がある。
- **音声S3・アーカイブ:** 専用非公開S3バケット自体はAWS東京リージョンのread-only検証で存在確認済み（Versioning Enabled、Block Public Access、SSE-S3）。ただしLifecycleルールは未設定で、Draft PR #639は既定OFF。話者別レコーダー、365日本文アーカイブ、完全削除とバックアップ復元への削除要求再適用は本番未完成。

**本番禁止ゲート:** 現行Workerの30日削除を365日へ単純変更しない。旧同意データの保持延長につながる。新保存モデル・同意・削除・バックアップ復元の検証完了まで新長期保存はOFF。#601 のDBスキーマ追加はデータ移行・S3バックアップ消去の完成を意味しない。Studioの計画表示と公式利用者向け文書は現在提供している機能と将来計画を明確に区別する。
