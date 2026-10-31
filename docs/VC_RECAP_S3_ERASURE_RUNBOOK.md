# VC Recap — 本人削除：S3 User Prefix消去処理（段階実装）

> 2026-10-31時点：**実S3への接続・本番削除は未実装/無効**。`apps/worker/src/vc-recap-s3-erasure.ts` はテスト可能な消去コア。今回、保存前の所有者予約テーブルと削除対象スキャン関数を追加したが、本番Workerは未接続で、実際のS3消去は一度も実行しない。

## 保証する範囲と保証できない範囲

- 許容prefixは `vc-recap/users/<Discord user ID>/` のみ（任意prefix指定を受けない）。
- バージョニング済みの全オブジェクト版（非現行版を含む）とdelete markerを`VersionId`指定で削除する。単純`DeleteObject`や単なる404を削除証跡としない。
- 未完了Multipart Uploadを中止し、二重のオブジェクト/アップロード一覧照合を行う。
- API結果の「HTTP 200だが個別削除エラー」、空のtruncatedページ、prefix外オブジェクト、進捗上限は**失敗**。途中削除後も再実行可能な形にする。
- 結果はこのprefixでのS3削除試行結果に過ぎず、**本人データ全コピーの完全消去とは見なさない**。特にDB/検索索引・Guild共有要約・他prefixのアーカイブmanifest・キャッシュ・復元コピー・S3バックアップ/DBスナップショットは対象外。
- この関数は`storageDeletionVerifiedAt`を設定しない。監査・復旧検証によってはじめて最終判定できる。

## 運用ゲート（本番呼び出し前に全て必要）

1. **保存前の本人同意と利用者別所有関係**をDBとS3オブジェクトの両方へ記録する。共有manifestや混合音声で個人データが消せない構造にしない。後からのprefix推測で削除対象を決定しない。
2. DB `vc_recap_erasure_requests` に削除障壁を永続化し、録音バッファ・アップロード予約・アーカイブ・ダウンロード・エクスポートまで書き込み/参照を禁止したことを確認する。ユーザー間の同時処理競合も検証する。
3. **別用途のバックアップbucketでは実行しない。** 録音用の限定した専用bucket、S3 BucketVersioning/BlockPublicAccess/IAM least privilege/KMS・Object Lock制約と、`s3:ListBucketVersions`, `s3:DeleteObjectVersion`, multipart操作に必要な権限を確認する。
4. 低レベルSDKアダプター・冪等ジョブ・再試行/Dead Letter Queue・監査イベント・権限境界・上限/レート制限・監視を実装する。
5. マルチパートアップロードの停止と進行中PUT完了のレースを含む実S3テストを、**本番データ以外**の隔離bucketで実施する。
6. バックアップ復元時に本人削除障壁を**復元前の正本から再適用**する仕組みを実装する。復元された古いDBに依頼レコードが無い可能性を想定し、再適用確認までWeb/Bot経由でデータを配信しない。
7. 完全削除の確認結果はユーザーへの通知と紐付け、削除未完了の間は完了通知を出さない。S3のObject Lock／保持義務／クロスリージョン複製による残存がある場合は別途扱う。

## コスト/リスク

ListObjectVersionsはオブジェクト・旧版を返し、バージョニング有効なbucketの単純DELETEでは完全削除できない。多数の版/チャンクでは API課金、リクエスト上限、早期削除料金に注意する。消去処理は上限到達時にエラーとし、サイレント成功にしない。

AWS公式: [Deleting object versions](https://docs.aws.amazon.com/AmazonS3/latest/userguide/DeletingObjectVersions.html), [ListObjectVersions API](https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectVersions.html), [Object Lock](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html)

## 次の実装責務

- #583: 話者単位の保存先命名・S3/DB owner-indexと、アップロード開始/完了時の削除障壁の検証。
- #582/#580: ユーザー削除要求→削除ジョブ→全コピー監査→バックアップ復元ガードを統合。既存30日機能と録音なしの方針は変更しない。
- #584: S3アーカイブで利用者データを一括消去できる分割形式/manifestを設計し、共有要約の削除を連動させる。

## 2026-10-31: 所有者索引と削除要求スキャンの段階実装

- `VcRecapStorageObject` はS3書き込みの**前**に `reserved` 行を作り、PUT成功後に `committed` に変更する設計。キーをbucket内で一意にし、ユーザー間で上書き・移譲しない。音声と本文の2種類だけを受け付け、30日の旧同意を長期同意へ変換しない。
- 書き込み予約は公開ポリシー版・個別同意・従来の文字起こし同意・削除要求障壁を検査する。本人の削除要求、長期同意の撤回、旧同意の撤回と、新しい保存予約はPostgreSQLの同一ユーザーアドバイザリロックを共有する。
- `sweepPendingVcRecapErasureRequests` は `storageDeletionVerifiedAt IS NULL` の削除要求を小さなbatchで取得し、所有者索引に未完了の `reserved` 行があれば処理を拒否する。設定 `VC_RECAP_ERASURE_SWEEP_ENABLED=true` と専用 `VC_RECAP_STORAGE_BUCKET` の一致が必須。**実行関数はWorker mainから呼び出さない**。
- このスキャンが成功しても `storageDeletionVerifiedAt` を更新・削除しない。S3の旧version、削除marker、マルチパートの一覧が消えていても、外部バックアップの検証が済むまでは完全削除と見なさない。
- `reserved` の孤立行は強制的に削除しない。アップロード完了/中止を外部オブジェクト版と照合し、残存が無いことを確認してから安全な回収処理を別途実装する。誤った完了判定を避けるため、このPRでは実装しない。
- **未実装の必須条件:** S3 SDKアダプター、専用bucket/IAM、実アップロードと録音の停止、予約と実S3 versionの突合・復旧、削除ジョブの定期実行/失敗通知、既存のDB/共有要約/他prefix、バックアップスナップショット復元時の削除障壁再適用。未対応の間は長期保存・録音をOFFのまま維持する。
