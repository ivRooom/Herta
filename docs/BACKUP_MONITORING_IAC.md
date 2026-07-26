# バックアップ鮮度監視 CloudFormation移行Runbook

## 目的

CloudShellで手作業作成したLambda、IAM Role、EventBridge SchedulerをCloudFormationで再現可能にします。

既存リソースはCloudFormation管理外のため、同名リソースを直接置換しません。`managed`サフィックス付きの新構成を並行作成し、動作確認後に旧Schedulerを停止します。

## 管理対象

- Lambda: S3最新`.dump`の鮮度確認
- Lambda実行Role: 対象S3 prefixの一覧取得、既存SNSへのPublish、CloudWatchカスタムメトリクス送信
- EventBridge Schedulerと実行Role
- Scheduler配信失敗用SQS DLQ
- DLQメッセージ検知CloudWatch Alarm
- Lambda CloudWatch Logs保持期間
- CloudWatch Dashboard

## 監視メトリクス

Lambdaは実行ごとに`Herta/BackupMonitoring`名前空間へ以下を送信します。

| メトリクス             | 値                               | 用途                       |
| ---------------------- | -------------------------------- | -------------------------- |
| `LatestBackupAgeHours` | 最新`.dump`の経過時間            | 鮮度上限との比較           |
| `BackupFound`          | 検出時`1`、未検出時`0`           | バックアップ生成有無の確認 |
| `FreshnessOk`          | 上限以内`1`、超過または未検出`0` | 現在状態の判定             |

各メトリクスには`FunctionName`ディメンションが付与されます。

CloudWatchへのメトリクス送信はベストエフォートです。`PutMetricData`が失敗した場合は`cloudwatch_metric_publish_failed`を警告ログへ記録し、バックアップ未検出・鮮度超過時のSNS通知処理は継続します。

## ダッシュボード

CloudWatch Dashboardには以下を表示します。

- 最新バックアップ経過時間と鮮度上限
- バックアップ検出状態、鮮度状態
- Lambdaの実行回数、エラー、スロットル
- Scheduler DLQの可視メッセージ数
- 直近50件のLambdaログ

既定のダッシュボード名は`herta-backup-monitoring`です。CloudFormation Outputsの`DashboardUrl`から直接開けます。

## デプロイ

```bash
cd /app/herta

export AWS_REGION='ap-northeast-1'
export BACKUP_BUCKET_NAME='herta-production-backups-ACCOUNT_ID-ap-northeast-1'
export ALERT_TOPIC_ARN='arn:aws:sns:ap-northeast-1:ACCOUNT_ID:herta-backup-alerts'

bash deploy/aws/backup-monitoring/deploy.sh
```

既定値:

- Stack: `herta-backup-monitoring`
- Resource suffix: `managed`
- 最大バックアップ経過時間: 25時間
- Scheduler: 毎日05:00 Asia/Tokyo
- Lambda Logs: 30日
- CloudWatch Dashboard: `herta-backup-monitoring`

ダッシュボード名を変更する場合はデプロイスクリプトへ`DashboardName`パラメータを追加指定するか、AWS CLIからCloudFormationを更新します。

## 切替手順

1. CloudFormation stackを作成または更新する。
2. デプロイスクリプトが実施する通常Lambda呼び出しで`status=ok`を確認する。
3. 新Lambdaへ強制通知テストを実施する。

```bash
FUNCTION_NAME="$(aws cloudformation describe-stacks \
  --stack-name herta-backup-monitoring \
  --query 'Stacks[0].Outputs[?OutputKey==`FunctionName`].OutputValue' \
  --output text)"

aws lambda invoke \
  --function-name "$FUNCTION_NAME" \
  --payload '{"force_alert":true}' \
  --cli-binary-format raw-in-base64-out \
  /tmp/herta-backup-alert-test.json

python3 -m json.tool /tmp/herta-backup-alert-test.json
```

4. SNS通知を確認する。
5. ダッシュボードURLを取得して表示を確認する。

```bash
DASHBOARD_URL="$(aws cloudformation describe-stacks \
  --stack-name herta-backup-monitoring \
  --query 'Stacks[0].Outputs[?OutputKey==`DashboardUrl`].OutputValue' \
  --output text)"

echo "$DASHBOARD_URL"
```

初回はカスタムメトリクスが反映されるまで数分かかる場合があります。通常呼び出し後に`LatestBackupAgeHours`、`BackupFound`、`FreshnessOk`が表示されることを確認します。

6. 新Schedulerが`ENABLED`であることを確認する。
7. 旧Scheduler `herta-backup-freshness-daily`を停止する。

```bash
aws scheduler update-schedule \
  --name herta-backup-freshness-daily \
  --state DISABLED \
  --schedule-expression 'cron(0 5 * * ? *)' \
  --schedule-expression-timezone 'Asia/Tokyo' \
  --flexible-time-window '{"Mode":"OFF"}' \
  --target file://scheduler-target.json
```

`update-schedule`はTarget全体の再指定が必要です。旧作成時の`scheduler-target.json`がない場合は、先に`aws scheduler get-schedule`でTargetを保存してください。

8. 翌日の新Scheduler実行、CloudWatch Dashboard、CloudWatch Logsを確認する。
9. 旧Lambda、旧IAM Role、旧Schedulerは確認期間後に削除する。

## 確認コマンド

カスタムメトリクスの存在確認:

```bash
aws cloudwatch list-metrics \
  --namespace 'Herta/BackupMonitoring' \
  --dimensions Name=FunctionName,Value="$FUNCTION_NAME"
```

ダッシュボード定義の確認:

```bash
aws cloudwatch get-dashboard \
  --dashboard-name herta-backup-monitoring
```

## ロールバック

新構成に問題がある場合は、新Schedulerを`DISABLED`へ変更し、旧Schedulerを`ENABLED`へ戻します。CloudFormation stackは原因調査が終わるまで保持します。

ダッシュボードやカスタムメトリクスの追加のみでLambda監視処理に問題が生じた場合は、直前のCloudFormationテンプレートへ戻してstackを更新します。既に送信されたカスタムメトリクスは保持期間経過までCloudWatchに残ります。

## 削除

```bash
aws cloudformation delete-stack \
  --region ap-northeast-1 \
  --stack-name herta-backup-monitoring

aws cloudformation wait stack-delete-complete \
  --region ap-northeast-1 \
  --stack-name herta-backup-monitoring
```

DLQにメッセージがある場合もstack削除でキュー自体は削除されるため、必要な障害情報を先に保存してください。CloudFormation管理のDashboardもstack削除時に削除されますが、送信済みのカスタムメトリクスは直ちには削除されません。
