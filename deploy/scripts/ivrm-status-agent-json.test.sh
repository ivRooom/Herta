#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AGENT_SCRIPT="${ROOT_DIR}/deploy/scripts/ivrm-status-agent.sh"
TEST_ROOT="$(mktemp -d /var/tmp/herta-status-agent-json-test.XXXXXX)"
MOCK_BIN="${TEST_ROOT}/bin"
CAPTURE_DIR="${TEST_ROOT}/capture"
SIGNING_SECRET='test-status-signing-secret-0123456789abcdef'

cleanup() { rm -rf "${TEST_ROOT}"; }
trap cleanup EXIT
mkdir -p "${MOCK_BIN}" "${CAPTURE_DIR}"

cat > "${TEST_ROOT}/multi-document.json" <<'JSON'
{"service":{"id":"invalid-service"},"status":"operational","checked_at":"2026-07-27T00:00:00.000Z","version":"0.1.0","checks":{"process":{"status":"ok"},"discord":{"status":"ok"},"database":{"status":"ok"},"redis":{"status":"ok"},"worker":{"status":"ok"}}}
{"service":{"id":"herta-discord-bot"},"status":"operational","checked_at":"2026-07-27T00:00:01.000Z","version":"0.1.0","checks":{"process":{"status":"ok"},"discord":{"status":"ok"},"database":{"status":"ok"},"redis":{"status":"ok"},"worker":{"status":"ok"}}}
JSON

cat > "${MOCK_BIN}/curl" <<'MOCK'
#!/bin/bash
set -euo pipefail
request="GET"
output_file=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --request) request="$2"; shift 2 ;;
    --output) output_file="$2"; shift 2 ;;
    --write-out|--connect-timeout|--max-time|--max-filesize|--proto|--retry|--retry-delay|--retry-max-time|--header|--data-binary) shift 2 ;;
    --silent|--show-error|--tlsv1.2) shift ;;
    --*) echo "unexpected curl option: $1" >&2; exit 97 ;;
    *) shift ;;
  esac
done
if [ "${request}" = "POST" ]; then
  echo POST > "${MOCK_CAPTURE_DIR}/post.txt"
  printf '202'
  exit 0
fi
cp "${MOCK_HEALTH_BODY_FILE}" "${output_file}"
printf '200'
MOCK
chmod +x "${MOCK_BIN}/curl"

set +e
env \
  PATH="${MOCK_BIN}:${PATH}" \
  MOCK_CAPTURE_DIR="${CAPTURE_DIR}" \
  MOCK_HEALTH_BODY_FILE="${TEST_ROOT}/multi-document.json" \
  HEALTH_URL='http://127.0.0.1:3000/healthz' \
  STATUS_INGEST_URL='https://stats.ivrm.jp/api/internal/status-ingest' \
  STATUS_SIGNING_SECRET="${SIGNING_SECRET}" \
  STATUS_LOCK_FILE="${TEST_ROOT}/agent.lock" \
  STATUS_RETRY_COUNT=0 \
  STATUS_DRY_RUN=false \
  bash "${AGENT_SCRIPT}" >"${TEST_ROOT}/multi.stdout" 2>"${TEST_ROOT}/multi.stderr"
MULTI_STATUS=$?
set -e

if [ "${MULTI_STATUS}" -ne 3 ]; then
  echo "FAIL: 複数JSONドキュメントをexit code 3で拒否できませんでした: ${MULTI_STATUS}" >&2
  exit 1
fi
if [ -e "${CAPTURE_DIR}/post.txt" ]; then
  echo 'FAIL: 複数JSONドキュメントをstatus APIへ送信しました' >&2
  exit 1
fi
grep -q 'JSON形式または値が不正' "${TEST_ROOT}/multi.stderr"
echo 'PASS: health応答を単一JSONドキュメントへ限定'

set +e
env \
  PATH="${MOCK_BIN}:${PATH}" \
  HEALTH_URL='http://127.0.0.1:3000/healthz' \
  STATUS_INGEST_URL='https://stats.ivrm.jp/api/internal/status-ingest' \
  STATUS_SIGNING_SECRET="${SIGNING_SECRET}" \
  STATUS_LOCK_FILE="${TEST_ROOT}/agent.lock" \
  STATUS_DRY_RUN=TRUE \
  bash "${AGENT_SCRIPT}" >"${TEST_ROOT}/boolean.stdout" 2>"${TEST_ROOT}/boolean.stderr"
BOOLEAN_STATUS=$?
set -e

if [ "${BOOLEAN_STATUS}" -ne 2 ]; then
  echo "FAIL: 不正なdry-run値をexit code 2で拒否できませんでした: ${BOOLEAN_STATUS}" >&2
  exit 1
fi
grep -q 'STATUS_DRY_RUNにはtrueまたはfalse' "${TEST_ROOT}/boolean.stderr"
echo 'PASS: 不正なdry-run値で実送信へ進まない'
