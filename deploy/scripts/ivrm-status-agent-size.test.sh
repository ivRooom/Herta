#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AGENT_SCRIPT="${ROOT_DIR}/deploy/scripts/ivrm-status-agent.sh"
TEST_ROOT="$(mktemp -d /var/tmp/herta-status-agent-size-test.XXXXXX)"
MOCK_BIN="${TEST_ROOT}/bin"
SIGNING_SECRET='test-status-signing-secret-0123456789abcdef'

cleanup() { rm -rf "${TEST_ROOT}"; }
trap cleanup EXIT
mkdir -p "${MOCK_BIN}"

cat > "${MOCK_BIN}/curl" <<'MOCK'
#!/bin/bash
set -euo pipefail
output_file=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --output) output_file="$2"; shift 2 ;;
    --write-out|--connect-timeout|--max-time|--max-filesize) shift 2 ;;
    --header) shift 2 ;;
    --silent|--show-error) shift ;;
    --*) echo "unexpected curl option: $1" >&2; exit 97 ;;
    *) shift ;;
  esac
done
MOCK_OUTPUT_FILE="${output_file}" python3 - <<'PY'
import os
from pathlib import Path
Path(os.environ["MOCK_OUTPUT_FILE"]).write_bytes(b"x" * 131072)
PY
printf '200'
MOCK
chmod +x "${MOCK_BIN}/curl"

set +e
env \
  PATH="${MOCK_BIN}:${PATH}" \
  HEALTH_URL='http://127.0.0.1:3000/healthz' \
  STATUS_INGEST_URL='https://stats.example.test/api/internal/status-ingest' \
  STATUS_SIGNING_SECRET="${SIGNING_SECRET}" \
  STATUS_LOCK_FILE="${TEST_ROOT}/agent.lock" \
  STATUS_MAX_HEALTH_BYTES=65536 \
  STATUS_DRY_RUN=true \
  bash "${AGENT_SCRIPT}" >"${TEST_ROOT}/stdout.txt" 2>"${TEST_ROOT}/stderr.txt"
STATUS=$?
set -e

if [ "${STATUS}" -ne 3 ]; then
  echo "FAIL: 大容量health応答をexit code 3で拒否できませんでした: ${STATUS}" >&2
  cat "${TEST_ROOT}/stdout.txt" >&2 || true
  cat "${TEST_ROOT}/stderr.txt" >&2 || true
  exit 1
fi

grep -q '内部ヘルスの取得に失敗しました' "${TEST_ROOT}/stderr.txt"
echo 'PASS: Content-Lengthなしの大容量health応答をOSファイル上限で停止'
