# VALORANT: 本番追加migrationの事前バックアップ・隔離復元ゲート

Issue [#767](https://github.com/ivRooom/Herta/issues/767) / Release [#757](https://github.com/ivRooom/Herta/issues/757) / 機能PR [#758](https://github.com/ivRooom/Herta/pull/758)。
この資料は**手順と保護条件**であり、実機実行の成功記録ではありません。

## 発動条件

- 本番GitHub Actions `Deploy Production` のSSH処理中、`docker compose config --quiet`成功後、image pull / service up / Prisma migratorの**前**に起動。
- `packages/db/prisma/migrations/20261103160000_valorant_voice_participants/migration.sql`を含まないmainでは副作用なしで終了。
- migrationが既に完了済みならread-onlyで2列の型・NULL・defaultを検証して終了。再度ALTER/履歴修正しない。
- migration未適用のときのみ、**local PostgreSQL16**を対象としてバックアップと隔離復元を行う。external PostgreSQL17 cutover（#675）は未承認なので拒否。

## 操作と事故防止

1. 稼働中の本番Composeで、サーバーバージョン16とmigration状態をread-onlyで確認。異常や不足があれば停止。
2. 展開先のdeployユーザー専用権限（0700）ディレクトリに `pg_dump -Fc` の新規ダンプ（0600）とSHA-256 sidecar（0600）を取得。サイズ・**バックアップ先およびDockerデータルートの両方**の空き容量・SHA-256を検証。不明・不足の場合は隔離復元を開始しない。
3. `docker run --network none --memory 256m --pids-limit 128 postgres:16-alpine` の一時コンテナを**新規**起動。稼働中のPG volume、host port、秘密情報を渡さない。
4. 同じダンプを隔離PGへ `pg_restore --no-owner --no-acl --exit-on-error` で復元。適用前履歴に新migrationが存在しないことを確認。
5. 新しいmigration.sqlの**そのままのSQL**を隔離DBだけに適用。 `voice_channel_id TEXT NULL` / `opted_out_user_ids TEXT[] NOT NULL DEFAULT empty` の型・defaultを検証。
6. 一時DBのみでTEMP table・INSERT・SELECT・ROLLBACKを検証。成功・失敗時とも**その実行で作成した一時コンテナと匿名ボリュームのみ**を削除し、本番の名前付きボリュームは触らない。取得済みバックアップとSHA sidecarは保持。

**禁止**：本番への手動ALTER/RESET/resolve、旧migrationの書き換え、既存のDB・volumeの削除、S3 uploader（削除/retention副作用）での代替、root IAM経由の操作、個人情報やdumpのIssue/ログへの投稿。

## 最新mainの同一SHA検証（#767）

GitHub `VALORANT predeploy restore rehearsal` は **すべてのmain push SHA** で合成PG16の復元・exact SQL rehearsalを行う。Pull Requestは従来通り対象ファイルだけの実行とし、一般的なPRの負荷を抑える。

本番品質ゲートは **直近の証跡付き実配備SHA → 今回のSHA** の累積差分を検査する。例えばmigrationを含むmainがまだ本番配備されず、その次にNginxだけ変更しても、最新main SHAに同じRehearsal成功結果が必要。Workflowがcommit-onlyの`push.paths`指定で起動しないと誤ったNo-Run状態になるため、main pushのpath filterは意図的に除去する。

このGitHub Actions実行は**使い捨ての合成データのみ**で、本番PG16のバックアップ/Restore成功を意味しない。本番デプロイでは後述のfresh dump→独立隔離Restore→SQL rehearsalのfail-closedゲートを別途通す。外部host鍵不一致 #770 の解消と運営者の承認がなければ配備は止める。

## 運用確認

- 必要なチェック：GitHub PR CI全成功、独立レビュー、稼働main/戻し先SHA確定、production environment承認、freshバックアップと隔離復元の本番実行ログ、migrator exit=0、Bot/API/Studio/Worker/Cloudflareのhealth、Discord有人E2E。
- 対象PRをmainへマージしてもDeployが起動するとは限らない。手動配備後のSHA証拠と自動再開のfail-closed境界は #762 / #765 / #759で管理。
- バックアップの正確な保存先・中身・機密値はGitHubに掲載しない。ダンプ保護/保存・復元実績の概要（日時、SHA一致結果、対象DBの識別種別、成功/失敗のみ）を #757/#767へ記録。
- バックアップ保持先とホスト上の容量について人間の運用レビューが必要。自動消去は行わないため、ディスク圧迫を監視し保管期限を別途決定する。

## Rollback

DDLは追加2列であり、通常のアプリimage rollbackではDROPしない。**移行前の承認済みSHAに戻す場合、そのSHAに追加migrationも事前復元ゲートも存在しなければゲートをスキップできる。ただしmigrationだけ存在しゲートが欠ける不完全なSHAでは停止する。**変更前の確実なimage SHAへ承認済みDeploy Productionの明示rollbackを使用。アプリ再起動後のAPI/Auth/Bot/Studio/Workerを検査し、**バックアップを上書きしない**。データ消失を伴う復元は通常rollback手順に含めず、障害時の個別承認を要求する。

## 実機検証の状態

- 新規ゲートのCI静的検証と合成PostgreSQL検証は実施対象。
- **本番のfresh dump/isolated restore/新migration適用の成功は、実機ログが得られるまで未確認**。
