#!/bin/bash
set -euo pipefail

REGION="${AWS_REGION:-ap-northeast-1}"
STACK_NAME="${STACK_NAME:-herta-backup-monitoring}"
RESOURCE_NAME_SUFFIX="${RESOURCE_NAME_SUFFIX:-managed}"
TEMPLATE_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/template.yml"

: "${BACKUP_BUCKET_NAME:?BACKUP_BUCKET_NAMEを設定してください}"
: "${ALERT_TOPIC_ARN:?ALERT_TOPIC_ARNを設定してください}"

for command_name in aws; do
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "ERROR: ${command_name}コマンドが見つかりません。" >&2
    exit 1
  fi
done

aws sts get-caller-identity --region "${REGION}" >/dev/null
aws cloudformation validate-template \
  --region "${REGION}" \
  --template-body "file://${TEMPLATE_FILE}" >/dev/null

aws cloudformation deploy \
  --region "${REGION}" \
  --stack-name "${STACK_NAME}" \
  --template-file "${TEMPLATE_FILE}" \
  --capabilities CAPABILITY_NAMED_IAM \
  --no-fail-on-empty-changeset \
  --tags Application=Herta Purpose=BackupFreshnessCheck ManagedBy=CloudFormation \
  --parameter-overrides \
    BackupBucketName="${BACKUP_BUCKET_NAME}" \
    AlertTopicArn="${ALERT_TOPIC_ARN}" \
    ResourceNameSuffix="${RESOURCE_NAME_SUFFIX}" \
    BackupPrefix="${BACKUP_PREFIX:-postgres}" \
    MaximumBackupAgeHours="${MAXIMUM_BACKUP_AGE_HOURS:-25}" \
    ScheduleExpression="${SCHEDULE_EXPRESSION:-cron(0 5 * * ? *)}" \
    ScheduleTimezone="${SCHEDULE_TIMEZONE:-Asia/Tokyo}" \
    LogRetentionDays="${LOG_RETENTION_DAYS:-30}"

FUNCTION_NAME="$(
  aws cloudformation describe-stacks \
    --region "${REGION}" \
    --stack-name "${STACK_NAME}" \
    --query 'Stacks[0].Outputs[?OutputKey==`FunctionName`].OutputValue' \
    --output text
)"

aws lambda invoke \
  --region "${REGION}" \
  --function-name "${FUNCTION_NAME}" \
  --payload '{}' \
  --cli-binary-format raw-in-base64-out \
  /tmp/herta-backup-monitoring-result.json >/dev/null

python3 -m json.tool /tmp/herta-backup-monitoring-result.json

echo "Stack: ${STACK_NAME}"
echo "Function: ${FUNCTION_NAME}"
echo "次に force_alert テストを実行し、通知確認後に旧Schedulerを停止してください。"
