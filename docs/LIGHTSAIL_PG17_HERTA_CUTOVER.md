# Herta: 専用Lightsail PostgreSQL 17 実DB受入・段階切替

Issue: [Herta #675](https://github.com/ivRooom/Herta/issues/675)
(親 [#512](https://github.com/ivRooom/Herta/issues/512)、[Platform #135](https://github.com/ivRooom/ivrm-platform/issues/135))。

この文書は**実運用用の手順/ゲート**であり、実施済みという報告でも、本番へのDDL・接続切替実行指示でもない。DBデータ・秘密鍵・パスワード・DSNはGitHubやCIログに載せない。

## 2026-10-31 23:16 JST 確認済み

- 専用Lightsail `ivrm-db-postgres-01` はOSネイティブPostgreSQL **17.11**。`herta` DBはユーザーテーブル0、`ivrm_web`も0。`ivrm_ai`には8テーブルと既存クライアント接続があり**必ず非干渉**。
- 人間の認可済みSSHから`ivrm_web`に`BEGIN`→一時テーブル`CREATE`→`INSERT`→`SELECT` (1件)→`ROLLBACK`成功。**DBホスト内のCRUD**であり、Herta外部接続や永続化の合格ではない。
- AWS CoreによるHerta→専用DB**private IPv4 TCP5432到達成功**。Hertaホストの`openssl s_client -starttls postgres`で公開サーバー証明書のCN/SAN=`ivrm-db-postgres.internal`、署名者=`ivRooom PostgreSQL CA`、7日以上有効と確認。ただし**信頼CA/実アプリ用ユーザー認証の成功ではない**。
- Herta sourceローカルPG **16.15**、約23.1MB、`public`に101テーブル、`_prisma_migrations`に**完了69/未完了0/rolled-back 1**。2026-10-27の別の隔離PG17復元成功（88テーブル/完了61）では現行sourceを保証できない。
- 現行のHertaデプロイはlocal PG16。`docker-compose.external.yml`と`deploy/scripts/validate-external-database.mjs`が用意されているが、切替していない。
- Hertaホストの `/etc/ivrm/herta-postgresql-prestage/` に**既存の**実証済み公開CA（root所有0644）と事前配置済み `external.env`（root所有0600）が存在する。CA SHA-256は `255c4cafd41e0798f69174a4d7c18f4bfa73b92f4212c4bebc97df75da5ae272`。異なる旧コピーにも同一の公開CAがあり、いずれもHerta private TCP5432で`openssl -verify_return_error -verify_hostname ivrm-db-postgres.internal` PASS。ネイティブ`psql`はないが、既存 `postgres:16-alpine` クライアントイメージは利用可能。既存ローカルPGコンテナ・ボリュームは維持。

## 2026-10-31 Herta実ロールの認証付きTLS確認（追記）

- DBサーバー内の読み取り専用SQLで `herta_owner` は `NOLOGIN`、`herta_runtime` と `herta_migrator` は `LOGIN`、3ロールとも `NOSUPERUSER` / `NOCREATEDB` / `NOCREATEROLE`。HBAの構成済みルール集計は `hostssl+scram-sha-256=4`、`host+reject=2`、`local+peer=2`。
- Hertaホストの保護された事前配置 `external.env` は `HERTA_DATABASE_MODE=external`、`DATABASE_URL=herta_runtime`、`MIGRATION_DATABASE_URL=herta_migrator` に対応。URLの実値をGitHubに保存せず、想定ホスト/DB/ポート/ロールと秘密値の存在のみ照合。**本番 `.env.production` は依然ローカルモード**で、設定は切り替えていない。 既存ホスト上で `docker compose --env-file .env.production --env-file /etc/ivrm/herta-postgresql-prestage/external.env -f docker-compose.external.yml config --quiet` は **PASS**（設定構文/依存関係のオフライン評価のみ）。実コンテナは再起動・変更していない。ホストの `/app/herta` からの `git rev-parse HEAD` は利用できず、配置ソースのSHAと実行イメージとの一致は未確認。
- Hertaホスト上で、既存の公開CAを読み取り専用マウントした一時 `postgres:16-alpine` クライアントから実DB `herta` へ `PGSSLMODE=verify-full` 接続。実行時だけの0600一時環境ファイルを利用し終了時削除、資格情報やDSNの出力なし。結果：

  | 実ロール | TLS | CONNECT | DB CREATE | public USAGE | public CREATE | TEMPORARY |
  | --- | --- | --- | --- | --- | --- | --- |
  | `herta_runtime` | true | true | false | true | false | false |
  | `herta_migrator` | true | true | true | true | true | true |

- `herta_runtime` の一時テーブル作成失敗は `TEMPORARY=false` と整合し、TLS/認証失敗とは区別できた。**権限を緩めない**。`herta_migrator` は実プライベートTLS接続で `BEGIN`→`CREATE TEMP TABLE`→`INSERT`→`SELECT count(*)=1`→`ROLLBACK`を成功。永続テーブルを作らず、一時状態も破棄した。
- 永続合成Canary（Migrationロールが専用一時検証用永続テーブルを作り、そのテーブルへのDML権限だけをruntimeに委譲、独立接続で書込/読取→全削除）をIssueに事前記録したが、ツール安全性チェックが**実行前にブロック**。そのため**永続・複数接続間のread/write合格とはまだ主張しない**。別途独立レビュー済みの運用実行が必要。
- この結果はネイティブlibpqでの実ユーザー認証・CA/ホスト名検証・権限確認であり、**実アプリPrisma/エンドツーエンドの認証・DB再接続・復元履歴は未受入**。

## 優先する移行方式

**β利用データの完全一致は必須としないが、既存sourceのスキーマ・Prisma migration履歴・Bot/Guild状態を守るため、まず直近の実バックアップを隔離PG17へ復元し、証拠を採る。**

現行migration履歴を空DBに`prisma migrate deploy`で頭から再実行する方法は採用しない。`docs/POSTGRESQL_CLIENT_READINESS.md`には履歴の`20260825022000_suggestion_staff_queue_index`で`P3018` / PostgreSQL `25001`を再現した記録がある。運用上の理由でβデータを捨てる場合も、source由来の**schema+migration history**整合が別途必要で、`db push`/履歴書き換え/`migrate resolve`で辻褄を合わせない。

## P0: 専用DBホストで実行する読み取り専用の次の検査

Lightsail ConsoleのSSHで実行。認証情報や実データを出力しない。

```bash
# 専用DBのHerta runtime/migrator/ownerロール存在・権限属性のみ
sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d postgres -c "
SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole
FROM pg_catalog.pg_roles
WHERE rolname IN ('herta_owner', 'herta_runtime', 'herta_migrator')
ORDER BY rolname;"

# 現時点のherta DBユーザーテーブル数・migration履歴の有無
sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d herta -c "
SELECT current_database() AS database_name,
       count(*) FILTER (WHERE c.relkind IN ('r','p','v','m','S','f')) AS relations,
       count(*) FILTER (WHERE c.relkind IN ('r','p')) AS tables,
       count(*) FILTER (
         WHERE n.nspname='public' AND c.relname='_prisma_migrations'
           AND c.relkind IN ('r','p')
       ) AS prisma_history_tables
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname NOT LIKE 'pg_%'
  AND n.nspname <> 'information_schema';"

# 生IP/username/証明書パスワードを露出させず、HBA認証方式を集計
sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d postgres -c "
SELECT type,auth_method,count(*) AS rules
FROM pg_catalog.pg_hba_file_rules
WHERE error IS NULL
GROUP BY type,auth_method
ORDER BY type,auth_method;"
```

**この集計はHBAの適用許可を確定しない。** 本番受入前に認可済み管理者がDBホスト内で `pg_hba_file_rules` の`line_number`順に、対象DB/ロール/接続元CIDR/認証方式と`error`をすべて確認し、先行する広域`trust`/例外ルールがないことを検査する。生のHBA一覧（内部IP・CIDR等）はIssue/CIに貼らず、集計やPASS/FAILだけ記録する。権限ロールの継承/`pg_has_role`、database/schema/table ACLも別途確認する。

ロールが0件/NOLOGINなら**現状はアプリ接続不可**。あらかじめロールを作成済みだと決めつけない。別承認のtarget-only最小権限DDL、異なるランダムパスワードの秘密配送、適切なHBA/CA検証が必要。Hertaの外部アダプターは固定ホスト名と別`herta_runtime`/`herta_migrator`を要求する。

## P1: ターゲットの復元/アプリ接続ゲート（順序厳守）

1. **予行演習**: 現行sourceの復元候補バックアップについてS3 VersionId・暗号化・SHA-256と`pg_restore --list`を照合し、独立・使い捨てPG17で101テーブル/69件の完了済みPrisma migration（およびrolled-back履歴）・FK・index・owner/ACL・checksum・暗号化キー依存を検証する。過去の88テーブル/61件の実証は現行snapshotの代用にならない。
2. **接続と権限・負荷の受入**: Herta実ホストにある公開CAを読み取り専用mountし、実Prismaクライアントでホスト名・CA検証、別LOGINロール、runtime DDL禁止、3秒timeoutと合算connection poolを確認する。ネイティブlibpqによる認証/strict TLSの成功だけでPrisma合格にしない。共有1GB PG17の`max_connections=30`（うち3管理者予約）でWeb/Herta/AI/backup/migratorの実際のピーク接続/メモリを計測する。
3. **本番カットオーバー直前にすべての書き込みを止める**: Bot/API/Worker/Studioと関連ジョブのsource writerを確認して停止、書込み停止時刻を記録した**後で**、現行PG16からfresh consistent backupを採取・SHA/世代保管し、必須対象の最新Guild/設定/監査/secret参照を検証する。βのみの特定データ消失を容認する場合は対象表と失われる時間範囲を明示し、他の業務データを暗黙に消失許容としない。凍結中のソースと復元証拠はロールバック用に保持する。
4. **DB単位の復元**: 専用DBホストの対象`herta`だけが空であることを直前確認したうえで、停止後に採った**最終backup**のschema/data/`_prisma_migrations`履歴を`herta`のみに復元。既存`ivrm_ai`/Web/クラスタ全体に`DROP`やrestoreを行わない。owner/ACL/全migration checksum/件数/FK/index、ログインロールの権限を再受入し、歴史的migration SQLを再実行しない。復元失敗時はwriter停止を維持し、元のsourceをそのまま復旧に使用する。
5. **アプリ切替と検収**: 現行Compose project/Redis/認証鍵/ローカルPG16のvolumeを保持したまま`HERTA_DATABASE_MODE=external`のレビュー済みリリースを反映。最初に`prisma migrate status`、API/Bot/Studio/Workerのhealth、合成データによる**永続書込→別接続読取→削除/cleanup**、runtime DDL禁止と資格情報不正時の拒否を確認する。Discord実Guildと日次参加v2は[Herta #644](https://github.com/ivRooom/Herta/issues/644)で別受入。**本番の新DBへ書き込み開始後は旧DBへ単純URLロールバックしない**。両側writer停止・差分照合・roll-forwardを優先する。
6. **バックアップ・障害復旧**: 定常バックアップの復元試験・監視・更新手順・RPO/RTO・1GB DBリソース上限を確認。専用PostgreSQLの`archive_mode=off`はWALアーカイブPITRが有効という意味ではない。切替の成功と旧sourceの廃止判断を別のゲートとして扱う。

## まだ実施していないこと

ロールの新規作成・パスワード変更、DB本番復元、**HertaアプリPrismaの外部接続**、永続Canary・実アプリDML、Prisma DDL、DNS/HBA/IAM変更、Dockerの本番再作成、Daily v2 flags有効化、既存source削除。なお、Hertaホストの既存PG16クライアントを使った**実ロールのTLS/認証はPASS**済み。これらの実行有無は必ず実AWS/DB/GitHub証拠で区別する。
