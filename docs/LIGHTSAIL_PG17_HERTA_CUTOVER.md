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
       count(*) FILTER (WHERE c.relkind IN ('r','p')) AS tables
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

ロールが0件/NOLOGINなら**現状はアプリ接続不可**。あらかじめロールを作成済みだと決めつけない。別承認のtarget-only最小権限DDL、異なるランダムパスワードの秘密配送、適切なHBA/CA検証が必要。Hertaの外部アダプターは固定ホスト名と別`herta_runtime`/`herta_migrator`を要求する。

## P1: ターゲットの復元/アプリ接続ゲート

1. 新しい**実source**のバックアップのS3 VersionId・暗号化・SHA-256と`pg_restore --list`を検証。前日のバックアップを最新カットオーバーコピーと呼ばない。**独立・使い捨てPG17**に復元して現在の101テーブル/69完了migrationに照合し、全データを晒さずFK・index・owner/ACL・Prisma checksum・シークレット復号依存を検証。
2. 実DBサーバーで対象の`herta`のみ空であることを直前確認。既存`ivrm_ai`/他DB/クラスタ全体に対するrestoreや`DROP`は行わない。確認済みdumpのDB単位復元は復元済みデータ/metadataとアプリロール権限を共に検証してから行う。適用後にmigration SQLは再実行しない。
3. Herta runtimeホストに**公開**ivRooom PostgreSQL CAを、信頼済み経路から供給し、読み取り専用mountで使用。実行コンテナのPrismaで厳格なCA/hostname検証・別LOGINロール・3秒timeout/合算プール予算を確認。DBの`ssl=on`またはTCP疎通だけでは合格不可。
4. `HERTA_DATABASE_MODE=external`を利用する場合は現在のCompose project/RedisボリュームとローカルPG16を保持。先に`prisma migrate status`、実体のAPI/Bot/Studio/Worker health、限定テスト用レコードで**永続書込→別接続読取→消去/cleanup**、runtime DDL禁止、資格情報不正時の拒否を検査。
5. ソースの書込み停止地点と回復方針を記録し、HertaのGitHub release所有者の配備workflowで段階切替。**新DBへ業務書込開始後に旧DBへ単純URLロールバックすると更新が消える**ため、停止・差分照合・roll-forwardを優先する。Discordの実Guild操作は別の[Herta #644](https://github.com/ivRooom/Herta/issues/644)で受入。
6. 1GB RAMの共有PG17: `max_connections=30`で管理者予約3。Web/Herta/AI/バックアップ/migratorの**実測合算poolとピーク接続・メモリ**を確認。 `archive_mode=off`のためWAL archive/PITR可能とは扱わない。

## まだ実施していないこと

ロールの新規作成・パスワード変更、DB本番復元、**HertaアプリPrismaの外部接続**、永続Canary・実アプリDML、Prisma DDL、DNS/HBA/IAM変更、Dockerの本番再作成、Daily v2 flags有効化、既存source削除。なお、Hertaホストの既存PG16クライアントを使った**実ロールのTLS/認証はPASS**済み。これらの実行有無は必ず実AWS/DB/GitHub証拠で区別する。
