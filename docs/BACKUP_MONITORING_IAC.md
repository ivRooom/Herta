# バックアップ鮮度監視 CloudFormation移行Runbook

## 目的

CloudShellで手作業作成したLambda、IAM Role、EventBridge SchedulerをCloudFormationで再現可能にします。

既存リソースはCloudFormation管理外のため、同名リソースを直接置換しません。`managed`サフィックス付きの新構成を並行作成し、動作確認後に旧Schedulerを停止します。

## 管理対象

- Lambda: S3最新`.dump`の鮮度確認
- Lambda実行Role: 対象S3 prefixの一覧取得と既存SNSへのPublish
- EventBridge Schedulerと実行Role
- Scheduler配信失敗用SQS DLQ
- DLQメッセージ検知CloudWatch Alarm
- Lambda CloudWatch Logs保持期間

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

## 切替手順

1. CloudFormation stackを作成する。
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
5. 新Schedulerが`ENABLED`であることを確認する。
6. 旧Scheduler `herta-backup-freshness-daily`を停止する。

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

7. 翌日の新Scheduler実行とCloudWatch Logsを確認する。
8. 旧Lambda、旧IAM Role、旧Schedulerは確認期間後に削除する。

## ロールバック

新構成に問題がある場合は、新Schedulerを`DISABLED`へ変更し、旧Schedulerを`ENABLED`へ戻します。CloudFormation stackは原因調査が終わるまで保持します。

## 削除

```bash
aws cloudformation delete-stack \
  --region ap-northeast-1 \
  --stack-name herta-backup-monitoring

aws cloudformation wait stack-delete-complete \
  --region ap-northeast-1 \
  --stack-name herta-backup-monitoring
```

DLQにメッセージがある場合もstack削除でキュー自体は削除されるため、必要な障害情報を先に保存してください。
