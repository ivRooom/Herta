# PostgreSQLバックアップ リストア検証Runbook

## 目的

S3へ保存された最新のPostgreSQL custom-format dump (`.dump`) が、実際に`pg_restore`で復元できることを週次で確認します。

既存のバックアップ鮮度監視は「新しいバックアップが存在するか」を確認します。本Runbookの仕組みは、次の段階として「バックアップを分離環境へ復元できるか」を確認します。

## 安全設計

- 本番PostgreSQLコンテナには接続しません。
- 本番Docker networkには参加せず、検証コンテナは`--network none`で起動します。
- 検証コンテナはCPU 1、メモリ1GBを既定上限とします。
- `flock`により同時実行を防止します。
- 成功・失敗を問わず、一時コンテナと一時ファイルを終了処理で削除します。
- 通常は失敗時だけSNS通知します。
- 実行優先度を下げ、週1回・深夜帯に実行します。

## 処理フロー

1. S3の`postgres/`配下から最新の`.dump`を特定する。
2. `/var/tmp`配下の権限制限付き一時ディレクトリへダウンロードする。
3. `pg_restore --list`でアーカイブ構造を検証する。
4. ネットワークから分離した一時PostgreSQL 16コンテナを起動する。
5. 最新dumpを一時DBへ`pg_restore --exit-on-error`で復元する。
6. `public`スキーマのテーブル数が最小期待値以上か確認する。
7. 一時コンテナと一時ファイルを削除する。
8. 失敗時は既存SNSトピックへ通知する。

## 構成ファイル

| ファイル                                                   | 用途                                   |
| ---------------------------------------------------------- | -------------------------------------- |
| `deploy/scripts/verify-backup-restore.sh`                  | リストア検証本体                       |
| `deploy/scripts/verify-backup-restore.test.sh`             | AWS・Dockerをモックした成功/失敗テスト |
| `deploy/systemd/herta-backup-restore-verification.service` | oneshotサービス                        |
| `deploy/systemd/herta-backup-restore-verification.timer`   | 毎週月曜03:30 JSTのタイマー            |
| `deploy/systemd/backup-restore-verification.env.example`   | 環境変数例                             |
| `.github/workflows/backup-restore-verification-ci.yml`     | シェル・systemd・安全設定のCI          |

## 前提条件

本番ホストの`ubuntu`ユーザーで次が利用できることを確認します。

```bash
sudo -u ubuntu -H aws sts get-caller-identity
sudo -u ubuntu -H docker version
command -v flock
```

必要なコマンド:

- AWS CLI v2
- Docker Engine
- `flock` (`util-linux`)
- Bash

## AWS権限

検証を実行するAWS認証情報には、対象バックアップへの読み取りとSNS通知だけを許可します。

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ListHertaBackups",
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::HERTA_BACKUP_BUCKET",
      "Condition": {
        "StringLike": {
          "s3:prefix": ["postgres", "postgres/*"]
        }
      }
    },
    {
      "Sid": "ReadHertaBackups",
      "Effect": "Allow",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::HERTA_BACKUP_BUCKET/postgres/*"
    },
    {
      "Sid": "PublishHertaBackupAlerts",
      "Effect": "Allow",
      "Action": "sns:Publish",
      "Resource": "arn:aws:sns:ap-northeast-1:ACCOUNT_ID:herta-backup-alerts"
    }
  ]
}
```

`HERTA_BACKUP_BUCKET`と`ACCOUNT_ID`は実環境の値へ置換します。アクセスキーやシークレットキーはリポジトリへ保存しません。

## 導入

### 1. 最新コードを配置

```bash
cd /app/herta
git fetch origin
git checkout main
git pull --ff-only origin main
```

### 2. 環境変数を作成

```bash
sudo install -d -m 0750 -o root -g ubuntu /etc/herta
sudo cp \
  deploy/systemd/backup-restore-verification.env.example \
  /etc/herta/backup-restore-verification.env
sudo chown root:ubuntu /etc/herta/backup-restore-verification.env
sudo chmod 0640 /etc/herta/backup-restore-verification.env
sudoedit /etc/herta/backup-restore-verification.env
```

最低限、次を実環境の値へ変更します。

```dotenv
AWS_REGION=ap-northeast-1
S3_BUCKET=herta-production-backups-ACCOUNT_ID-ap-northeast-1
S3_PREFIX=postgres
SNS_TOPIC_ARN=arn:aws:sns:ap-northeast-1:ACCOUNT_ID:herta-backup-alerts
```

既定では成功通知を送らず、失敗時だけ通知します。

```dotenv
NOTIFY_SUCCESS=false
```

### 3. systemd unitを配置

```bash
sudo install -m 0644 \
  deploy/systemd/herta-backup-restore-verification.service \
  /etc/systemd/system/herta-backup-restore-verification.service

sudo install -m 0644 \
  deploy/systemd/herta-backup-restore-verification.timer \
  /etc/systemd/system/herta-backup-restore-verification.timer

sudo systemctl daemon-reload
```

`/app/herta`以外へ配置している場合、serviceの`WorkingDirectory`、`ConditionPathExists`、`ExecStart`を実環境へ合わせます。実行ユーザーが`ubuntu`以外の場合も`User`と`HOME`を変更します。

### 4. 手動検証

タイマーを有効化する前に、必ず1回手動実行します。

```bash
sudo systemctl start herta-backup-restore-verification.service
sudo systemctl status herta-backup-restore-verification.service --no-pager
sudo journalctl \
  -u herta-backup-restore-verification.service \
  -n 200 \
  --no-pager
```

成功ログの主要項目:

```text
=== リストア検証成功 ===
Backup key: postgres/....dump
Public tables: 1以上
Started (UTC): ...
Finished (UTC): ...
```

一時コンテナが残っていないことも確認します。

```bash
docker ps -a \
  --filter label=com.ivrooom.herta.purpose=backup-restore-verification
```

### 5. 週次タイマーを有効化

```bash
sudo systemctl enable --now herta-backup-restore-verification.timer
sudo systemctl list-timers \
  herta-backup-restore-verification.timer \
  --all
```

既定スケジュール:

- 毎週月曜日 03:30 Asia/Tokyo
- 最大15分のランダム遅延
- サーバー停止中に予定時刻を過ぎた場合、次回起動後に補完実行

## 手動でスクリプトを実行する場合

systemdと同じ環境ファイルを読み込んで実行します。

```bash
set -a
source /etc/herta/backup-restore-verification.env
set +a
bash /app/herta/deploy/scripts/verify-backup-restore.sh
```

直接実行でも同じロックファイルを使うため、systemd実行中は重複実行されません。

## モックテスト

AWSや実Dockerコンテナへ接続せず、成功系・復元失敗系・SNS通知・クリーンアップを検証できます。

```bash
bash deploy/scripts/verify-backup-restore.test.sh
```

## 運用確認

直近実行結果:

```bash
sudo systemctl status herta-backup-restore-verification.service --no-pager
sudo journalctl \
  -u herta-backup-restore-verification.service \
  --since '8 days ago' \
  --no-pager
```

次回実行時刻:

```bash
sudo systemctl list-timers \
  herta-backup-restore-verification.timer \
  --all
```

失敗後の再実行:

```bash
sudo systemctl reset-failed herta-backup-restore-verification.service
sudo systemctl start herta-backup-restore-verification.service
```

## 停止・無効化

```bash
sudo systemctl disable --now herta-backup-restore-verification.timer
```

unitも撤去する場合:

```bash
sudo rm -f \
  /etc/systemd/system/herta-backup-restore-verification.service \
  /etc/systemd/system/herta-backup-restore-verification.timer
sudo systemctl daemon-reload
```

## トラブルシューティング

| 症状                                 | 確認事項                                              |
| ------------------------------------ | ----------------------------------------------------- |
| S3の最新dumpを取得できない           | `S3_BUCKET`、`S3_PREFIX`、`s3:ListBucket`を確認       |
| `AccessDenied`でダウンロードできない | `s3:GetObject`と対象ARNを確認                         |
| SNS通知だけ失敗する                  | `SNS_TOPIC_ARN`、`sns:Publish`、リージョンを確認      |
| Docker socketへ接続できない          | `ubuntu`が`docker`グループへ所属しているか確認        |
| PostgreSQLイメージを取得できない     | Docker Hubへの疎通とディスク空き容量を確認            |
| 120秒以内に起動しない                | `docker logs <container>`、メモリ・ディスク空きを確認 |
| テーブル数が期待値未満               | dump対象DB、dump方式、`MIN_PUBLIC_TABLES`を確認       |
| 一時コンテナが残った                 | labelで特定し、原因調査後に`docker rm -f`で削除       |

## 注意事項

- この検証はバックアップの復元可能性を確認しますが、業務上重要なデータ件数や参照整合性までは保証しません。
- `MIN_PUBLIC_TABLES`は最低限の成立判定です。主要テーブルの件数・整合性検証は別フェーズで追加します。
- dumpが大きくなった場合は、実行時間・一時ディスク・CPU・メモリ使用量を確認して上限と実行時刻を調整します。
- 本番への実リストアは別Runbookと承認手順に従い、この一時検証コンテナを流用しません。
