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
- Hertaホストの既知の候補パスには新DB用の公開CAが見つからず、ネイティブ`psql`もない。既存ローカルPGコンテナは停止せず、Dockerの既存名前付きボリュームも保持する。

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

ロール作成・パスワード設定、DB本番復元、Herta外部接続認証、Prisma DDL、DNS/HBA/IAM変更、Dockerの本番再作成、Daily v2 flags有効化、既存source削除。これらの実行有無は必ず実AWS/DB/GitHub証拠で区別する。
