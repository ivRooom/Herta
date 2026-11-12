#!/bin/bash
# Herta. — verify-backup-restore.sh の外部依存モックテスト
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_SCRIPT="${SCRIPT_DIR}/verify-backup-restore.sh"
TEST_ROOT="$(mktemp -d)"
FAKE_BIN="${TEST_ROOT}/bin"

cleanup() {
  rm -rf "${TEST_ROOT}"
}
trap cleanup EXIT

mkdir -p "${FAKE_BIN}"

cat > "${FAKE_BIN}/aws" <<'EOF'
#!/bin/bash
set -euo pipefail

printf '%s\n' "$*" >> "${FAKE_AWS_LOG}"

if [ "$1" = "s3api" ] && [ "$2" = "list-objects-v2" ]; then
  printf 'postgres/herta-test.dump\t2026-07-26T09:03:22+00:00\t4096\n'
  exit 0
fi

if [ "$1" = "s3" ] && [ "$2" = "cp" ]; then
  if [[ "$3" == *.sha256 ]]; then
    if [ "${FAKE_CHECKSUM_MODE:-}" = "missing" ]; then
      exit 1
    fi
    expected="$(sha256sum "${4%.sha256}")"
    expected="${expected%% *}"
    filename="herta-test.dump"
    case "${FAKE_CHECKSUM_MODE:-}" in
      mismatch) expected="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" ;;
      invalid) printf 'invalid sidecar\n' > "$4"; exit 0 ;;
      wrong-file) filename="other.dump" ;;
    esac
    printf '%s  %s\n' "${expected}" "${filename}" > "$4"
  else
    printf 'fake custom format dump\n' > "$4"
  fi
  exit 0
fi

if [ "$1" = "sns" ] && [ "$2" = "publish" ]; then
  exit 0
fi

echo "unexpected aws invocation: $*" >&2
exit 1
EOF

cat > "${FAKE_BIN}/docker" <<'EOF'
#!/bin/bash
set -euo pipefail

printf '%s\n' "$*" >> "${FAKE_DOCKER_LOG}"

contains_argument() {
  local expected="$1"
  shift
  local argument

  for argument in "$@"; do
    if [ "${argument}" = "${expected}" ]; then
      return 0
    fi
  done

  return 1
}

case "$1" in
  run)
    if contains_argument --detach "$@"; then
      printf 'fake-container-id\n'
    fi
    ;;
  exec)
    if contains_argument pg_isready "$@"; then
      exit 0
    fi

    if contains_argument pg_restore "$@"; then
      if [ "${FAKE_RESTORE_FAIL:-false}" = "true" ]; then
        echo "forced restore failure" >&2
        exit 42
      fi
      exit 0
    fi

    if contains_argument psql "$@"; then
      printf '%s\n' "${FAKE_PUBLIC_TABLE_COUNT:-12}"
      exit 0
    fi
    ;;
  inspect|rm|logs)
    exit 0
    ;;
esac

exit 0
EOF

chmod +x "${FAKE_BIN}/aws" "${FAKE_BIN}/docker"

run_success_test() {
  local case_root="${TEST_ROOT}/success"
  local output="${case_root}/stdout.log"
  local error_output="${case_root}/stderr.log"
  local aws_log="${case_root}/aws.log"
  local docker_log="${case_root}/docker.log"

  mkdir -p "${case_root}/work"
  : > "${aws_log}"
  : > "${docker_log}"

  env \
    PATH="${FAKE_BIN}:${PATH}" \
    FAKE_AWS_LOG="${aws_log}" \
    FAKE_DOCKER_LOG="${docker_log}" \
    AWS_REGION=ap-northeast-1 \
    S3_BUCKET=herta-test-backups \
    S3_PREFIX=postgres \
    SNS_TOPIC_ARN=arn:aws:sns:ap-northeast-1:111111111111:herta-test-alerts \
    WORK_ROOT="${case_root}/work" \
    LOCK_FILE="${case_root}/verification.lock" \
    bash "${TARGET_SCRIPT}" \
    > "${output}" 2> "${error_output}"

  grep -q 'リストア検証成功' "${output}"
  grep -q 'Public tables: 12' "${output}"
  grep -q 'バックアップSHA256一致' "${output}"
  grep -q 'latest.dump.sha256' "${aws_log}"
  grep -q -- '--network none' "${docker_log}"
  grep -q 'rm --force' "${docker_log}"

  if grep -q '^sns publish' "${aws_log}"; then
    echo "ERROR: 成功時にSNS通知が送信されました。" >&2
    return 1
  fi
}

run_failure_notification_test() {
  local case_root="${TEST_ROOT}/failure"
  local output="${case_root}/stdout.log"
  local error_output="${case_root}/stderr.log"
  local aws_log="${case_root}/aws.log"
  local docker_log="${case_root}/docker.log"
  local status

  mkdir -p "${case_root}/work"
  : > "${aws_log}"
  : > "${docker_log}"

  set +e
  env \
    PATH="${FAKE_BIN}:${PATH}" \
    FAKE_AWS_LOG="${aws_log}" \
    FAKE_DOCKER_LOG="${docker_log}" \
    FAKE_RESTORE_FAIL=true \
    AWS_REGION=ap-northeast-1 \
    S3_BUCKET=herta-test-backups \
    S3_PREFIX=postgres \
    SNS_TOPIC_ARN=arn:aws:sns:ap-northeast-1:111111111111:herta-test-alerts \
    WORK_ROOT="${case_root}/work" \
    LOCK_FILE="${case_root}/verification.lock" \
    bash "${TARGET_SCRIPT}" \
    > "${output}" 2> "${error_output}"
  status=$?
  set -e

  if [ "${status}" -eq 0 ]; then
    echo "ERROR: リストア失敗時に終了コード0となりました。" >&2
    return 1
  fi

  grep -q '^sns publish' "${aws_log}"
  grep -q 'rm --force' "${docker_log}"
  grep -q 'forced restore failure' "${error_output}"
}

run_integrity_failure_test() {
  local mode="$1"
  local case_root="${TEST_ROOT}/checksum-${mode}"
  local output="${case_root}/stdout.log"
  local error_output="${case_root}/stderr.log"
  local aws_log="${case_root}/aws.log"
  local docker_log="${case_root}/docker.log"
  local status

  mkdir -p "${case_root}/work"
  : > "${aws_log}"
  : > "${docker_log}"

  set +e
  env \
    PATH="${FAKE_BIN}:${PATH}" \
    FAKE_AWS_LOG="${aws_log}" \
    FAKE_DOCKER_LOG="${docker_log}" \
    FAKE_CHECKSUM_MODE="${mode}" \
    AWS_REGION=ap-northeast-1 \
    S3_BUCKET=herta-test-backups \
    S3_PREFIX=postgres \
    SNS_TOPIC_ARN=arn:aws:sns:ap-northeast-1:111111111111:herta-test-alerts \
    WORK_ROOT="${case_root}/work" \
    LOCK_FILE="${case_root}/verification.lock" \
    bash "${TARGET_SCRIPT}" \
    > "${output}" 2> "${error_output}"
  status=$?
  set -e

  if [ "${status}" -eq 0 ]; then
    echo "ERROR: ${mode}時に終了コード0となりました。" >&2
    return 1
  fi

  grep -q '^sns publish' "${aws_log}"
  if grep -Eq '^(run|exec) ' "${docker_log}"; then
    echo "ERROR: ${mode}時にDockerを実行しました。" >&2
    return 1
  fi
  if find "${case_root}/work" -mindepth 1 -print -quit | grep -q .; then
    echo "ERROR: ${mode}時に一時ファイルが残っています。" >&2
    return 1
  fi
}

bash -n "${TARGET_SCRIPT}"
run_success_test
run_failure_notification_test
for mode in missing mismatch invalid wrong-file; do
  run_integrity_failure_test "${mode}"
done

echo "verify-backup-restore.sh tests passed"
