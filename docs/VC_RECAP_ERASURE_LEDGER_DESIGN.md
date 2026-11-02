# VC Recap：独立削除要求Ledgerの段階導入設計（#694）

> **状態: 設計・合成テストのみ。未デプロイ、未接続、実際の削除要求は受け付けない。**
> #646 の運営決定: 追加変動費の暫定上限は月3,000円、固定費は見積り後に判断。AWS Root/本番GitHub管理設定の正式切替は全プロダクト運用準備後に保留。**課金リソース作成/IAM変更/本番本人データ操作への包括承認ではない**。

## 問題と受入条件

DBが復元されると、そのバックアップ取得後に本人が行った「撤回・削除依頼」のレコードも巻き戻る。
削除依頼をPostgreSQLのバックアップやVC生音声保存Bucketと**別の正本**で永続化し、
古いDBを戻しても本人データを再開示させない。

- 運用受入は **外部Ledger write-first → DB内owner-fenceの取得・適用**。
- 外部に永続化できないときは成功/完全削除を返さない。本人の新録音/長期保存・閲覧を安全側へ遮断する。
- 合成データで削除→古いDBのRestore後も本文/S3全版/multipart/共有要約/索引/キャッシュの再出現 **0件**（#695/#617）。
- 外部Ledger照合失敗・不完全列挙・復旧中はVC Recapの出力/書込みを**全体停止**して解除しない。
- 本ドキュメントだけでは現行の30日処理/録音機能や本番版を変更しない。

## 台帳媒体の候補（いずれも本番未承認）

| 候補                                                                                 | 長所                                                                           | 注意点                                                                                                         |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| **専用S3 Bucket**（Versioning + 厳密なwrite-only IAM + Object Lockの適用要否を判断） | 既存AWS運用に近い。1要求1オブジェクトの追記型、監査/取得を別Roleへ分離しやすい | 操作費、Listの完全性、Bucket policy、保護期限と本人削除請求の関係。Object Lock有効化/保持期間/法的適合は別承認 |
| **専用DynamoDB Table**（PITR等、復元独立性を確認）                                   | 条件付き書込み・冪等性に向く                                                   | 専用テーブルとバックアップ費用、データ欠落検証、管理者による削除の耐性、IAMの新設                              |
| **PostgreSQL内だけのテーブル**                                                       | 実装は容易                                                                     | **不採用**。同一DBの旧Backupに戻ると要求を失う                                                                 |

**推奨検討順**：専用S3の独立Bucketで1要求1オブジェクトを最小設計候補とし、稼働実績/完全性検証/保持期限/費用を別途評価する。通常VC BucketやPostgreSQLのバックアップBucketは使わない。実リソース名・リージョン・費用・権限・Retentionは承認前に仮決定しない。

## 書込み受理プロトコル（実装前レビューが必要）

1. 入力: 本人ID、本人確認済み操作、重複を識別するランダムrequestId（再送時同一）、受理時刻。元の会話本文や音声は台帳に含めない。
2. APIは「処理停止/削除要求中」のローカル障壁をまず確保し、同じownerのアップロード予約・同意付与と排他的に扱う。保留中に既存データを配信し続けない。※この境界は #695 の共通read/write gateと合わせて設計する。
3. 既存DBとは独立なストレージへ、上書き不可の要求1件1Objectを**先にPut**する（専用IAM/条件付き作成、再試行時の同一requestId/内容一致）。永続受領が確認できなければ、削除成功を応答せずfail-closed。障害を記録し再試行可能にする。
4. 独立台帳の永続受領後に、本人所有ロックとDBトランザクションで`vc_recap_erasure_requests`を冪等Upsertし、すべての将来同意/予約を無効化。DBが失敗しても外部受領は失われない。次回リプレイで補正する。
5. 本人には「削除依頼受付」と「全保存コピーの完全削除」を**別の状態**で表示する。削除済みと宣言するのは #617 が全版/multipart/共有要約/キャッシュを確認した後のみ。
6. 監査・アラートには状態/件数/処理時間だけを残し、本人IDやオブジェクトKeyを標準ログやIssueに出さない。

**未解決の設計リスク**：外部Put前のプロセスクラッシュ/遅延、DB内の処理停止と外部Putの分散トランザクション境界、同時S3 Putや再認可、許可付き通信の遮断、受付の監査件数を独立に証明する方法。実装はこれらの競合/障害テスト合格までDraftのみ。

## データ形式・復元照合

1件ごとの追記専用受領形式（合成例、非公開保管）:

```json
{
  "kind": "vc-recap-erasure-request-event-v1",
  "requestId": "00000000-0000-4000-8000-000000000001",
  "userId": "123456789012345678",
  "requestedAt": "2026-11-01T09:01:00Z"
}
```

- `deploy/scripts/vc-recap-erasure-ledger-contract.mjs` は形式/重複ID/UTC日時/完全列挙件数を**合成入力だけ**で検証し、本人IDごとの最後の要求時刻を `vc-recap-independent-erasure-ledger-v1` スナップショット形式に集約する。
- `deploy/scripts/verify-vc-recap-restore-fences.py` が利用するのは**後者のスナップショット**。生成するだけでは署名/改ざん防止/完全性の証明ではない。
- 外部ストレージの全オブジェクト・全ページ列挙、独立の監査件数/署名またはハッシュ、安全な取得時刻、再適用、権限分離は**未実装**。スクリプトの「件数一致」は安全な外部監査に置き換わらない。
- 独立台帳中のUser IDも個人データになり得る。収集目的、保持期限、アクセス/削除手順と法令への整合を定義する。

## Write-firstの合成受付オーケストレーション

- `deploy/scripts/vc-recap-erasure-write-first.mjs` は **本番未接続の制御順序** を検証する。本人確認・用途別権限判定・新しい同意取得を代行しない。
- 必須の3操作をすべてDIで受ける: `quarantineOwner`（全インスタンス/復元後も継続する配信・書込停止）、`appendImmutableReceipt`（独立永続ストレージの追記のみ）、`applyDatabaseFence`（owner排他/同意失効とDB内削除障壁）。
- 同一要求IDのリトライは、独立ストレージに既存オブジェクトがあれば**完全な同一バイト列**を読み直して照合できた場合のみ `verified-existing` とする。単純なS3 HTTP 412やmetadataの自己申告だけでは成功扱いしない。
- 本人別ID/Request IDは標準ログや例外文に出さない。消去受付と完全消去は別の状態。台帳が永続化された後にDB書込に失敗した場合は本人の配信停止を維持し、独立台帳からの再適用を要求する。
- 合成テストは遮断→台帳→DBの順序、遮断失敗、台帳失敗、破損/競合、DB失敗と同一要求リトライを検証する。
- **未実装**: Quarantineの本物の分散永続化、AWS S3等の`appendImmutableReceipt`の実装/完全性監査、DBの実際のロック付きアップサート、利用者の全削除API/Discord操作との接続、復元時自動再適用。いずれも現在は本番に入れない。

## S3 SDK v3形式の台帳書込Port（合成テストのみ、実サービス未接続）

- `deploy/scripts/vc-recap-erasure-s3-v3-adapter.mjs` は、`createS3ErasureLedgerReceiptPort(client, commands)` でAWS SDK v3互換 `PutObjectCommand` / `GetObjectCommand` を受け取り、既存の `appendImmutableReceipt` Portに接続できる。SDK・実資格情報・実本番APIの初期化は行わない。
- 環境変数 `VC_RECAP_ERASURE_LEDGER_BUCKET` が**明示設定**され、`VC_RECAP_STORAGE_BUCKET` と `VC_RECAP_POSTGRES_BACKUP_BUCKET` に一致しない場合だけ進む。ただし環境変数の比較のみで、**実際に別の復元・管理境界を持つ独立Bucketであることは証明できない**。IaC・CloudTrail・IAM・実Bucketの監査が必要。
- `erasure-ledger/v1/<UUIDv4>.json` の正規化した要求Bodyだけを受け付け、SHA256（`ChecksumSHA256`）付き `IfNoneMatch:'*'` で条件付きPut。その後、**GetObjectでBodyのバイト列を再読取**し、要求との完全一致を確認する。単なるETag/HTTP200は成功の証拠にしない。
- `412 PreconditionFailed` は、既存オブジェクトを実読取して同一バイト列の場合のみ `verified-existing`。内容が違う場合はfail-closed。`409 ConditionalRequestConflict` / AccessDenied / 欠損 / 長さ不一致 / 再読取失敗は受付失敗とし、呼出元のQuarantineを解除しない。Put成功時もreadbackが失敗したら不受理扱いで同じrequestIdを再試行する。
- **AWS公式の制約**: Versioningが有効でも、最新Versionが削除マーカーの場合、`If-None-Match:*` は新たなPutを許す。従って**これだけで耐改ざん・append-onlyは保証できない**。専用Bucketの削除禁止IAM/バケットポリシー、Object Lockの適用・保持期限（本人削除権との整合）、Version監査、独立保全/監査件数、復元時Quarantineが別途必要。通常のVC音声BucketやPGバックアップBucketを流用しない。
- 4KiBを超えるLedgerレコードは拒否し、GetObjectの`ContentLength`と実読み取りBytesを突合。本人ID・S3 Key・SDKエラーを例外文に出さない。**Clientに対して実AWS呼出しが可能なのは将来実Credentialを注入した場合のみ**で、現時点では合成Clientを注入するテストしか存在しない。
- ソース: [S3公式条件付き書込仕様](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html)、[PutObject API](https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html)。

**未実装・No-Go**: 独立Bucket/IAMの承認と実配備、Audit/list全ページ完全性、リクエスト/版IDの耐久保持、復元後の全経路読書遮断、DB連携・S3全版削除・人間による最終Release承認。本Portの合成テスト成功を公開のGo根拠にしない。

## S3 Version履歴を含む独立Ledger Inventoryのローカル照合（#694）

`deploy/scripts/vc-recap-erasure-s3-inventory.mjs` はAWS SDK v3互換コマンドを注入する**本番未配線・読取のみ**の検査Port。

- `ListObjectVersions` を `KeyMarker`/`VersionIdMarker` 付きで全ページ走査。空のtruncated page、marker循環、想定外Prefix、複数Version、null VersionId、`IsLatest=false`、削除マーカー、件数超過を**全て失敗扱い**とする。ページ/レコード数の上限は、無限列挙や予期しない課金を避ける安全弁。
- 各Objectを明示した`VersionId`で`GetObject`し、`ContentLength`・4KiB上限・正規JSON・Request IDとObject Keyの一致を照合する。VersionごとのHashとKeyの整列リストから決定的fingerprintを計算。
- **外部の認証済み監査から別途受け取る**件数・fingerprintが必須。値そのものを引数で渡せる仕組みは外部監査の真正性・署名を検証しない。テストでは合成値で動作のみを確認し、無条件の復旧再開を認可しない。結果は常に `canResumeTraffic:false`。
- 正常時のみ既存`assembleErasureSnapshot`でRestore照合形式へ集約。Ledgerが空の場合は明示された`allowEmpty`と外部の独立0件証明が必須。キャッシュ・並行Put・失われたオブジェクト・越境コピー・監査の主体はこのチェックだけでは証明できない。
- SDK実Credential、AWS実Bucket、完全性を保証する署名済み外部manifest/独立監査サービス、Versioning/Object Lock/IAM、分散Quarantine、本当のPG Replay/全版消去は**いずれも未実装**。実Storage/IAMの適用は#646の個別承認後のみ。
- AWS公式仕様: [ListObjectVersions](https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectVersions.html) / [GetObject VersionId](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html)。

## 独立監査の署名・公開鍵Pin照合（#694、合成専用）

- `deploy/scripts/vc-recap-erasure-signed-audit.mjs` は、台帳とPostgreSQLとは**別の信頼経路で配布した** Ed25519公開鍵（PEM）と、別経路でピンしたSPKI SHA256 fingerprintを照合して監査manifestの署名を確認する。署名用秘密鍵をWorker/Bot/Studio/CIに配らない。
- manifest payloadは `kind`, `auditId`, `restoreRunId`, `ledgerBucket`, `generatedAt`, `objectCount`, `manifestSha256` の厳密な7フィールドのみを受け付ける。UTC時刻の正当性、別復元Runとの混入、未来/古い署名、Bucket差替、署名改変/鍵差替/件数/指紋改変を拒否する。Ed25519は正規化JSONバイトの署名。
- 署名検証後の `expectedCount`, `expectedManifestSha256`, `generatedAt` のみを既存 `inspectVcRecapErasureLedgerVersions` に渡し、S3 Version完全列挙・各実VersionのGet・SHA256が一致することを合成Portで検証する。成功しても常に `canResumeTraffic:false`。
- `restoreRunId` と公開鍵Pinは「復元されたPostgreSQL/同じS3 bucketのmanifest」から取得してはならない。台帳そのものに格納された鍵や署名を一緒に信用する構成は不適。CIは使い捨てテスト鍵を生成して署名を検証するが、本番の監査鍵/署名Service/署名済manifestの独立保存先は**未作成**。
- **重要な残存脅威**: 署名は「誰がどのmanifestに署名したか」の真正性確認に過ぎず、署名者による全レコードの独立数え上げ・永続完全性・最後のmanifest以降のPut・既知の最新manifestへのanti-rollback保護を保証しない。正しい署名済古いmanifestの再利用、署名鍵漏洩、S3 Versioningのdelete marker、削除されたobjectの見落とし等を防ぐには **独立監査の生成・配布・単調増加チェックポイント・IAM/Object Lock/別管理境界** が必須。
- 結果が成功しても新録音/長期保持の本番ON、実個人削除受理、隔離解除のGo判断に使わない。新AWSリソース/IAM/課金の変更は#646で別途承認を得る。

## 監査manifestのanti-rollback checkpoint Pin（#708、合成専用）

署名が有効でも、攻撃者が**過去の真正な署名済manifest**を提示できるため、監査の最新性は保証されない。独立に保全された「現在採用すべき監査」のチェックポイントが必要になる。

- `verifyPinnedVcRecapAudit(envelope, trust, checkpoint)` は Ed25519署名・公開鍵Pin/有効期限を検証してから、**別の信頼経路で取得したcheckpoint** の7項目（`kind`・`auditId`・`restoreRunId`・`ledgerBucket`・`generatedAt`・`objectCount`・`manifestSha256`）の完全一致を要求する。部分一致、欠損、追加フィールド、古い正しい署名も拒否する。
- `inspectVcRecapLedgerWithPinnedCheckpoint` は署名とcheckpoint双方の照合に成功した場合に限り、既存S3 Version Inventoryの合成照合へ進む。照合に失敗した場合は**S3 List/Getを開始しない**。返却値は常に `canResumeTraffic:false`。
- **checkpointの正本は未実装**。その保存場所、署名/管理主体、単調増加した最新checkpointであることの保証、更新の原子性、署名鍵ローテーション、複数復元Runとの紐付け、最後のmanifest以降のPutの検出は別途設計・承認が必要。**checkpointを監査対象S3、復元済みPostgreSQL、監査envelope自体から作って渡す設計は安全ではない**。checkpointと署名済manifestを一緒に巻き戻された場合も検出できない。
- **本番有効化禁止**: 合成検証の成功は、台帳監査の独立性/完全性、本人の全データ消去、実VC Quarantineや配信再開の承認ではない。外部checkpoint正本設置・IAM/費用・運用は #694 / #646 の個別承認に従う。PG16→PG17移行は対象外。

## 次のIssue依存

- #694: 認可済み外部Bucket/Role/IAM設計と見積りレビュー → write-first永続化 → 障害・同時操作テスト。**外部作成は別承認**。
- #695: 全サービス配信/保存の`quarantine`ゲート → 旧バックアップ復元時の台帳リプレイ。
- #617: SDKによるS3全Version/delete marker/multipart/共有要約等の削除証明。
- #518: 新3用途別の本人同意を得た検証Guildの実機テスト。
- #646: 1 Guild・7日Canary、違反0件、月追加変動費3,000円を上限案とする運営受入。

**No-Go**：本DraftはAWS/DB/Discordへのネットワーク接続を持たず、実ユーザーデータ/実Ledger/S3への操作はない。長期本文保持・録音・Whisperを有効化しない。

## Restore Quarantineと独立署名・Checkpoint/Inventory監査の合成連動（#714 / #695）

- `deploy/scripts/vc-recap-restore-pinned-audit.mjs` は **本番未接続の合成検証専用**。既存の `reconcileVcRecapRestoreUnderQuarantine`（#695）を使い、耐久隔離の受理後に限定して独立監査を読み込む。Ed25519署名・別経路で固定したcheckpoint・S3全Version/全Byte照合にすべて合格するまで、復元DBの削除障壁の再適用も試みない。
- 認証済みS3 Inventoryから組み立てた本人削除要求snapshotだけを、注入された `replayErasureFences` → `verifyDatabaseFences` → `verifyAllCopiesPurged` に渡す。runIdと各結果を照合し、不一致・期限超過・不完全列挙・SDKエラー・DB再適用失敗・全コピー未消去は常にfail-closed。返り値は `{status:'review-required',canResumeTraffic:false}` のみ。
- **独立性は未実証**: 注入されるcheckpointや公開鍵が本当にDB・S3と異なる保護境界で保全されていること、単調更新されること、台帳の全件を監査したこと、Quarantineが全サービスを実際に遮断することは、この合成テストでは証明できない。実AWS IAM・S3/Object Lock、Bot/API/Studio/Export/Workerへの起動前ガード、復元したPGへの実replay、S3/Backup/Cacheの全コピー消去は #694/#695/#617の未完了P0。
- 本実装の追加テスト: `node --test deploy/scripts/vc-recap-restore-pinned-audit.test.mjs`。Backup Restore Verification CIへ登録。**AWS credentials / 本人データ / 本番PG16→PG17 / IaC / 新録音・長期保持のフラグには触れない**。現行30日・AWS Transcribe維持、新録音/長期保持/WhisperはOFF。公開は #646 で No-Go のまま。

## 単一S3 Keyの全Version / Multipart消去Port（#716、合成のみ）

- `deploy/scripts/vc-recap-erasure-s3-purge.mjs` はSDK v3互換のClient/Commandを注入する**本番未接続の合成検証専用**。実Credentialを作成・取得せず、本番の削除APIやWorker/Restoreには配線していない。
- 対象は`vc-recap/`配下の**厳密に指定した1つのKey**に限る。Prefixが一致する隣接Keyは列挙され得るが削除しない。ListObjectVersionsでVersion/DeleteMarkerを全ページ列挙、ListMultipartUploadsで未完了Uploadを列挙し、すべての列挙が成立してからAbortMultipartUploadとVersionId指定DeleteObjectを実行する。
- 欠損/重複VersionId・`null` VersionId・重複Upload、ページングの欠損/循環、Unexpected Prefix、SDK失敗、部分成功、再列挙で残存があればfail-closed。対象本人のID/Key/SDKエラーはエラーメッセージに含めない。削除後には各一覧を再列挙し、ローカルで0件かを確認する。
- 成功結果も`{ status: 'single-key-local-list-empty-only', canDeclareErased: false, canResumeTraffic: false }`。**単一Keyの一時点での局所確認**であり、別Key・DB・共有要約・索引・キャッシュ・別Backup/レプリカ・将来の同時Putを含む「本人完全消去」の証明ではない。別運用主体による独立監査、書込禁止の持続、全コピー確認、Quarantine解除承認は依然未完成。
- `null` VersionId（非Versioned状態の可能性）は、無条件Deleteにより削除マーカーを新設しないよう拒否。安全な特例処理は設計・実Bucket調査と承認が必要。実S3や本人データでは実行しない。
- 合成テスト: `node --test deploy/scripts/vc-recap-erasure-s3-purge.test.mjs`。Backup Restore Verification CIに登録。PG16→PG17移行・AWS/IAM/Object Lock・課金・本番データ削除・録音/長期保持/Whisper ONには触れない。新機能公開は #646 No-Go、#617/#694/#695 はOpen継続。
