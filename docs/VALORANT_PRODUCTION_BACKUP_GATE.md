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

**自動デプロイ（`workflow_run`）**では、品質ゲートが **直近の証跡付き実配備SHA → 今回のSHA** の累積差分を検査する。例えばmigrationを含むmainがまだ本番配備されず、その次にNginxだけ変更しても、最新main SHAに同じRehearsal成功結果が必要。Workflowがcommit-onlyの`push.paths`指定で起動しないとNo-Run状態になるため、main pushのpath filterは意図的に除去する。

**通常の手動mainデプロイ（`workflow_dispatch`, `ref=main`）**でも、#765の安全修正後は自動デプロイと同じ**直近の本番SSH配備証跡SHA→今回のmain SHA**の累積差分を使用する。直前コミットがdocs-onlyでも、最後に本番配備されたSHA以降にDB/API/Bot変更が含まれればその分も検出する。加えて、手動mainでは累積差分の有無を問わず同一SHAの`CI`・`Database topology contracts`・`VALORANT PostgreSQL integration`・`VALORANT predeploy restore rehearsal`を全て要求する。同じSHAを意図的に再デプロイする場合も品質ゲートを通す。GitHub Deploymentの証跡欠損・破損・前回SSH失敗・読取エラーは自動的に第一親へフォールバックせず、build/OIDC/SSH前にfail-closed。

### 運営者用：初回bootstrapと手動rollbackの境界（#765）

- **通常の本番反映・同SHA再デプロイ**：GitHub → Herta → Actions → Deploy Production → Run workflow → branch=`main`、`ref=main`、`bootstrap_without_proof=false`（**初期値のまま**）。最新mainに対する同SHAチェック成功と本番証跡を照合する。トラブルで手動実行してもCI/Environment approvalを無効化しない。
- **本番への初回bootstrapのみ**：独立のLightsail運営確認で**過去の成功した本番SSHデプロイが無い**と確認した場合だけ、production reviewerの承認を得て`ref=main`、`bootstrap_without_proof=true`を明示する。quality gateは「過去の成功SSHが存在しない」という検証済みエラーのとき**だけ**第一親で最初の境界を定め、同SHA全4品質Workflowを確認する。過去のDeployが失敗した場合、GitHub APIが読めない場合、証跡だけ失われた場合、現在の本番に成功SSHがある場合はこの例外で救済**不可**。理由不明のとき値を`true`にしてはいけない。
- **明示過去SHA rollback（平常時）**：`ref`へmain履歴中の承認済み**40桁SHA**を入力、`bootstrap_without_proof=false`、`emergency_rollback_without_proof=false`のまま。直近の本番SSH証跡を照合。rollback先はmain祖先かつ当該SHAのmain-push CI/Topology等を要求するが、比較差分は**rollback先コミットの第一親→rollback先**を使う。旧版に存在しない新しいMigration/Workflowを必須化しないため、正常な旧版rollbackを妨げない。rollbackでDB列や利用者データを自動削除しない。
- **直近のSSHが失敗した後の緊急rollback**：最新SSHの部分失敗・GitHub本番証跡の不一致を運営者が調査し、**前回正常稼働imageとDB変更の互換性、復旧責任者、バックアップ**を確認した場合のみ、`ref`へ確認済みの**過去40桁main祖先SHA**を入力して`emergency_rollback_without_proof=true`にする。過去に成功SSHが無い場合も、運営側が正当な緊急戻しであると明示承認したときだけ許可する。通常main配備や自動Deployには例外適用しない。quality gateが許可する例外は**直近SSH失敗／成功証跡の欠損・不一致**等の限定された状態のみで、API/ネットワーク障害、実行中SSH、権限拒否、pagination不足は不可。古いSHAのmain-push CI/Topology・GitHub`production` Environment保護・Lightsailのホスト鍵固定・本番4image SHAの読み戻し・Cloudflare Health・rollback後の新しい保護証跡発行は引き続き必須。2つの緊急フラグを同時ONにしてはいけない。
- **失敗時の判断**：unknown/missing proof、直近SSHの部分失敗、GitHub API障害、比較ファイル数の上限超過、旧SHAのCI記録欠損等は**自動配備では必ずfail-closed**。人間が復旧責任者となる明示的な緊急旧SHA rollbackでのみ上記限定例外を使える。operatorは権限/証跡/実稼働4image/バックアップを調査し、#765に**機密を含まない**原因を記録。原因を不明のままfirst-parentやSSH host-key pinを迂回しない。明示rollbackには事前に最新保護証跡と復旧責任者を確認する。

実本番SSHのfresh PG16 backup＋offline isolated restore＋exact SQL rehearsalはimage pull/migrator前に必須であり、失敗時はfail-closed。旧コミットにMigrationが無ければ従来通り前処理は無変更。

このGitHub Actions実行は**使い捨ての合成データのみ**で、本番PG16のバックアップ/Restore成功を意味しない。本番デプロイでは後述のfresh dump→独立隔離Restore→SQL rehearsalのfail-closedゲートを別途通す。外部host鍵不一致 #770 の解消と運営者の承認がなければ配備は止める。

## 運用確認

- 必要なチェック：GitHub PR CI全成功、独立レビュー、稼働main/戻し先SHA確定、production environment承認、freshバックアップと隔離復元の本番実行ログ、migrator exit=0、Bot/API/Studio/Worker/Cloudflareのhealth、Discord有人E2E。
- 対象PRをmainへマージしてもDeployが起動するとは限らない。手動配備後のSHA証拠と自動再開のfail-closed境界は #762 / #765 / #759で管理。
- バックアップの正確な保存先・中身・機密値はGitHubに掲載しない。ダンプ保護/保存・復元実績の概要（日時、SHA一致結果、対象DBの識別種別、成功/失敗のみ）を #757/#767へ記録。
- バックアップ保持先とホスト上の容量について人間の運用レビューが必要。自動消去は行わないため、ディスク圧迫を監視し保管期限を別途決定する。

## Rollback

DDLは追加2列であり、通常のアプリimage rollbackではDROPしない。**移行前の承認済みSHAに戻す場合、そのSHAに追加migrationも事前復元ゲートも存在しなければゲートをスキップできる。ただしmigrationだけ存在しゲートが欠ける不完全なSHAでは停止する。**変更前の確実なimage SHAへ承認済みDeploy Productionの明示rollbackを使用。アプリ再起動後のAPI/Auth/Bot/Studio/Workerを検査し、**バックアップを上書きしない**。データ消失を伴う復元は通常rollback手順に含めず、障害時の個別承認を要求する。

## 実機検証の状態（2026-11-04時点）

- [PR #768](https://github.com/ivRooom/Herta/pull/768)の本番PG16保護ゲートと[PR #775](https://github.com/ivRooom/Herta/pull/775)のmain毎SHA合成Restoreは導入済み。最新main `5f491f239579ee632a1a260ccbcc7ddd72c47815` の [CI #41674889839](https://github.com/ivRooom/Herta/actions/runs/41674889839)・[合成Restore #41674889694](https://github.com/ivRooom/Herta/actions/runs/41674889694)成功。
- **本番データのfresh dump/sha256/network-none隔離Restore/exact SQL rehearsal**は先行[Deploy #41648606171](https://github.com/ivRooom/Herta/actions/runs/41648606171)で実証済み。最新 [自動Deploy #41676773820](https://github.com/ivRooom/Herta/actions/runs/41676773820) は対象migration適用済み・schema read-only・新規DDLなし・migrator exit0、4サービス同SHA/image ID readback＋外部Health成功、証跡ID`7524993936`。バックアップ保持期限・コスト/容量・復元責任者は #767 の運営レビューで確認する。
- **本手動ゲート改善PR**は#765のレビュー/CI/本番配備成功をもって運用有効と扱う。それまでは従来のfirst-parent問題が残る。実本番の意図的rollbackは未実施であり、ユーザーの明示承認なく試さない。
