# VC Recap専用S3 — 合成データ削除E2Eと安全設定監査

## 実施日・Issue

2026-10-31 / #625（合成S3 E2E）、#626（設定監査）、#617（本番S3・IAM安全性）

## 本番S3で実施した合成データE2E（実証）

AWSリージョン `ap-northeast-1` の**VC Recap専用バケットだけ**で、実利用者とは無関係の合成prefixを利用した。

`vc-recap/users/999999999999999999/e2e/issue625-20261031-exclusive/`

S3 API（PutObject×2、DeleteObjectによるdelete-marker生成、CreateMultipartUpload、ListObjectVersions、ListMultipartUploads、AbortMultipartUpload、DeleteObjectsのVersionId指定、最終一覧照合）を使った。**本番WorkerのJavaScriptアダプターとAWS SDKを接続する実機テストではない**。AWS APIの実際のversioning/multipart/削除挙動を確認したテストである。

| 項目 | 削除前 | 削除後 |
|---|---:|---:|
| オブジェクト版（現行・旧版） | 2 | 0 |
| Delete Marker | 1 | 0 |
| 未完了Multipart Upload | 1 | 0 |
| 合成prefixの最終確認 | — | 0版 |

結果: **passed**。異なるユーザーprefix・既存バックアップbucket・VC Recapの実利用者データは対象外。APIの個別エラーがある場合は失敗扱いとし、`finally` で合成prefixの残版を再消去する設計で試験した。

## 環境設定のドリフトチェック（#626）

リポジトリの `deploy/scripts/verify-vc-recap-s3-safety.py` は**read-only**で、以下を検証する。

- STS上のAWS Account IDと実行時のAccount IDが一致
- バケット名が `herta-vc-recap-private-<12桁Account ID>-<Region>` と**完全一致**（バックアップbucketの流用拒否）
- S3 Bucket Region、Versioning=Enabled
- BlockPublicAccess 4設定すべてtrue
- SSE-S3 AES256、BucketOwnerEnforced
- Bucket/Objects両方に適用するHTTP接続の明示Deny

実行（認可された最小権限の読み取り専用AWS資格情報を利用し、秘密鍵は保存しない）:

```bash
python3 deploy/scripts/verify-vc-recap-s3-safety.py \
  --account-id 911291529944 \
  --region ap-northeast-1 \
  --bucket herta-vc-recap-private-911291529944-ap-northeast-1
```

スクリプトは `aws sts get-caller-identity` と `aws s3api get-...` **だけ**を呼び出し、オブジェクトを保存・削除しない。IAM権限不足、レスポンス異常、設定逸脱のいずれでもexit 1になる（fail closed）。CIは外部AWS認証を利用せず、モック結果で危険な設定が成功と誤判定されないことを検証する。

```bash
python3 deploy/scripts/verify-vc-recap-s3-safety.test.py
```

**注意:** AWS実機側のテストは接続されたAWS権限で行ったが、これはSDKの実Writer/Worker、IAM最小権限ロールによる認証・削除、進行中PUTとの競合、DB backupからの復旧と消去障壁の再適用を証明しない。この試験結果だけで `storageDeletionVerifiedAt` を更新したり、長期録音・保存・自動削除をONにしてはならない。

## 次のP0 / 中止・ロールバック

- #617: 作成済みバケットへの書き込み・版削除のIAM最小権限ロールを検証してから接続する。現時点ではWorkerへのAWS SDK・本番S3自動消去接続なし
- #582/#580: 復元前の外部削除要求台帳を正本にしたtombstone再適用・復元時アクセス遮断を実装し、実機検証が完了するまで全コピー削除済みを宣言しない
- 監査失敗時は**設定を自動修復しない**。書き込み・長期録音・削除JobはOFFのまま、CloudFormation変更履歴とIAM権限を読み取り調査し、安全に変更を戻す。バケットはDeletionPolicy=Retainのためスタック削除はストレージ削除を意味しない
