#!/bin/bash
# ============================================================
# Herta. — PostgreSQLバックアップのリストア検証
# ------------------------------------------------------------
# S3上の最新custom-format dumpを、一時PostgreSQLコンテナへ
# 復元し、publicスキーマのテーブル数を検証します。
# 本番DB・本番Docker networkには接続しません。
# ============================================================
set -euo pipefail

umask 077

AWS_REGION="${AWS_REGION:-ap-northeast-1}"
S3_BUCKET="${S3_BUCKET:?S3_BUCKETを設定してください}"
S3_PREFIX="${S3_PREFIX:-postgres}"
SNS_TOPIC_ARN="${SNS_TOPIC_ARN:-}"
POSTGRES_IMAGE="${POSTGRES_IMAGE:-postgres:16}"
RESTORE_DATABASE="${RESTORE_DATABASE:-herta_restore_verify}"
RESTORE_MEMORY_LIMIT="${RESTORE_MEMORY_LIMIT:-1g}"
RESTORE_CPU_LIMIT="${RESTORE_CPU_LIMIT:-1}"
MIN_PUBLIC_TABLES="${MIN_PUBLIC_TABLES:-1}"
NOTIFY_SUCCESS="${NOTIFY_SUCCESS:-false}"
WORK_ROOT="${WORK_ROOT:-/var/tmp}"
LOCK_FILE="${LOCK_FILE:-/var/tmp/herta-backup-restore-verification.lock}"

CURRENT_STEP="初期化"
LATEST_KEY="未取得"
LATEST_MODIFIED="未取得"
LATEST_SIZE="未取得"
TEMP_DIR=""
CONTAINER_NAME=""
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

require_command() {
  local command_name="$1"

  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "ERROR: ${command_name}コマンドが見つかりません。" >&2
    exit 1
  fi
}

publish_notification() {
  local subject="$1"
  local message="$2"

  if [ -z "${SNS_TOPIC_ARN}" ]; then
    echo "WARN: SNS_TOPIC_ARNが未設定のため通知を省略します。" >&2
    return 0
  fi

  if ! command -v aws >/dev/null 2>&1; then
    echo "WARN: awsコマンドがないためSNS通知を送信できません。" >&2
    return 0
  fi

  aws sns publish \
    --region "${AWS_REGION}" \
    --topic-arn "${SNS_TOPIC_ARN}" \
    --subject "${subject}" \
    --message "${message}" \
    >/dev/null || echo "WARN: SNS通知の送信に失敗しました。" >&2
}

cleanup() {
  if [ -n "${CONTAINER_NAME}" ] && \
    docker inspect "${CONTAINER_NAME}" >/dev/null 2>&1; then
    docker rm --force "${CONTAINER_NAME}" >/dev/null 2>&1 || true
  fi

  if [ -n "${TEMP_DIR}" ] && [ -d "${TEMP_DIR}" ]; then
    rm -rf "${TEMP_DIR}"
  fi
}

on_exit() {
  local exit_code=$?
  local finished_at
  finished_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  set +e
  cleanup

  if [ "${exit_code}" -ne 0 ]; then
    publish_notification \
      "[ALERT] Herta backup restore verification failed" \
      "Herta PostgreSQL backup restore verification failed.

Host: $(hostname)
Started (UTC): ${STARTED_AT}
Finished (UTC): ${finished_at}
Failed step: ${CURRENT_STEP}
Exit code: ${exit_code}
S3 bucket: ${S3_BUCKET}
Backup key: ${LATEST_KEY}
Backup last modified: ${LATEST_MODIFIED}
Backup size: ${LATEST_SIZE} bytes"
  fi

  exit "${exit_code}"
}

trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

for command_name in aws docker flock mktemp date hostname; do
  require_command "${command_name}"
done

if ! [[ "${MIN_PUBLIC_TABLES}" =~ ^[0-9]+$ ]]; then
  echo "ERROR: MIN_PUBLIC_TABLESには0以上の整数を設定してください。" >&2
  exit 1
fi

mkdir -p "$(dirname "${LOCK_FILE}")" "${WORK_ROOT}"
exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
  echo "INFO: 別のリストア検証が実行中のため終了します。"
  exit 0
fi

CURRENT_STEP="最新バックアップの検索"
S3_PREFIX="${S3_PREFIX#/}"
S3_PREFIX="${S3_PREFIX%/}"
LATEST_RECORD="$(
  aws s3api list-objects-v2 \
    --region "${AWS_REGION}" \
    --bucket "${S3_BUCKET}" \
    --prefix "${S3_PREFIX}/" \
    --query 'sort_by(Contents[?ends_with(Key, `.dump`)], &LastModified)[-1].[Key,LastModified,Size]' \
    --output text
)"

if [ -z "${LATEST_RECORD}" ] || [ "${LATEST_RECORD}" = "None" ]; then
  echo "ERROR: s3://${S3_BUCKET}/${S3_PREFIX}/ に.dumpバックアップがありません。" >&2
  exit 1
fi

IFS=$'\t' read -r LATEST_KEY LATEST_MODIFIED LATEST_SIZE <<< "${LATEST_RECORD}"
if [ -z "${LATEST_KEY}" ] || [ "${LATEST_KEY}" = "None" ]; then
  echo "ERROR: 最新バックアップのキーを取得できませんでした。" >&2
  exit 1
fi

if ! [[ "${LATEST_SIZE}" =~ ^[0-9]+$ ]] || [ "${LATEST_SIZE}" -le 0 ]; then
  echo "ERROR: 最新バックアップのサイズが不正です: ${LATEST_SIZE}" >&2
  exit 1
fi

TEMP_DIR="$(mktemp -d "${WORK_ROOT%/}/herta-backup-restore.XXXXXX")"
DUMP_PATH="${TEMP_DIR}/latest.dump"

CURRENT_STEP="最新バックアップのダウンロード"
echo "=== 最新バックアップを取得 ==="
echo "S3 key: ${LATEST_KEY}"
echo "Last modified: ${LATEST_MODIFIED}"
echo "Size: ${LATEST_SIZE} bytes"
aws s3 cp \
  "s3://${S3_BUCKET}/${LATEST_KEY}" \
  "${DUMP_PATH}" \
  --region "${AWS_REGION}" \
  --only-show-errors

if [ ! -s "${DUMP_PATH}" ]; then
  echo "ERROR: ダウンロードしたバックアップが空です。" >&2
  exit 1
fi

CURRENT_STEP="dumpアーカイブ構造の検証"
echo "=== pg_restore --listでアーカイブ構造を検証 ==="
docker run --rm \
  --network none \
  --volume "${TEMP_DIR}:/backup:ro" \
  "${POSTGRES_IMAGE}" \
  pg_restore --list /backup/latest.dump \
  >/dev/null

CURRENT_STEP="一時PostgreSQLコンテナの起動"
CONTAINER_NAME="herta-backup-restore-$RANDOM-$$"
RESTORE_PASSWORD="$(
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 24
  else
    printf 'herta-restore-%s-%s' "$RANDOM" "$$"
  fi
)"

echo "=== 分離PostgreSQLコンテナを起動 ==="
docker run --detach \
  --name "${CONTAINER_NAME}" \
  --network none \
  --memory "${RESTORE_MEMORY_LIMIT}" \
  --cpus "${RESTORE_CPU_LIMIT}" \
  --label com.ivrooom.herta.purpose=backup-restore-verification \
  --env "POSTGRES_PASSWORD=${RESTORE_PASSWORD}" \
  --env "POSTGRES_DB=${RESTORE_DATABASE}" \
  --volume "${TEMP_DIR}:/backup:ro" \
  "${POSTGRES_IMAGE}" \
  >/dev/null

CURRENT_STEP="一時PostgreSQLの起動待機"
for attempt in $(seq 1 60); do
  if docker exec "${CONTAINER_NAME}" \
    pg_isready --username postgres --dbname "${RESTORE_DATABASE}" \
    >/dev/null 2>&1; then
    break
  fi

  if [ "${attempt}" -eq 60 ]; then
    echo "ERROR: 一時PostgreSQLが120秒以内に起動しませんでした。" >&2
    docker logs "${CONTAINER_NAME}" >&2 || true
    exit 1
  fi

  sleep 2
done

CURRENT_STEP="最新バックアップのリストア"
echo "=== 最新バックアップを一時DBへリストア ==="
docker exec "${CONTAINER_NAME}" \
  pg_restore \
  --username postgres \
  --dbname "${RESTORE_DATABASE}" \
  --no-owner \
  --no-privileges \
  --exit-on-error \
  /backup/latest.dump

CURRENT_STEP="復元後データベースの検証"
PUBLIC_TABLE_COUNT="$(
  docker exec "${CONTAINER_NAME}" \
    psql \
    --username postgres \
    --dbname "${RESTORE_DATABASE}" \
    --tuples-only \
    --no-align \
    --command "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';" \
    | tr -d '\r[:space:]'
)"

if ! [[ "${PUBLIC_TABLE_COUNT}" =~ ^[0-9]+$ ]]; then
  echo "ERROR: publicテーブル数を取得できませんでした: ${PUBLIC_TABLE_COUNT}" >&2
  exit 1
fi

if [ "${PUBLIC_TABLE_COUNT}" -lt "${MIN_PUBLIC_TABLES}" ]; then
  echo "ERROR: publicテーブル数が期待値未満です。" >&2
  echo "       actual=${PUBLIC_TABLE_COUNT}, minimum=${MIN_PUBLIC_TABLES}" >&2
  exit 1
fi

FINISHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "=== リストア検証成功 ==="
echo "Backup key: ${LATEST_KEY}"
echo "Public tables: ${PUBLIC_TABLE_COUNT}"
echo "Started (UTC): ${STARTED_AT}"
echo "Finished (UTC): ${FINISHED_AT}"

if [ "${NOTIFY_SUCCESS}" = "true" ]; then
  publish_notification \
    "[OK] Herta backup restore verification succeeded" \
    "Herta PostgreSQL backup restore verification succeeded.

Host: $(hostname)
Started (UTC): ${STARTED_AT}
Finished (UTC): ${FINISHED_AT}
S3 bucket: ${S3_BUCKET}
Backup key: ${LATEST_KEY}
Backup last modified: ${LATEST_MODIFIED}
Backup size: ${LATEST_SIZE} bytes
Public tables: ${PUBLIC_TABLE_COUNT}"
fi
