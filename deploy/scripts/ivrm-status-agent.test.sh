#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AGENT_SCRIPT="${ROOT_DIR}/deploy/scripts/ivrm-status-agent.sh"
TEST_ROOT="$(mktemp -d /var/tmp/herta-status-agent-test.XXXXXX)"
MOCK_BIN="${TEST_ROOT}/bin"
CAPTURE_DIR="${TEST_ROOT}/capture"
FIXTURE_DIR="${TEST_ROOT}/fixtures"
OUTPUT_DIR="${TEST_ROOT}/output"

cleanup() {
  rm -rf "${TEST_ROOT}"
}
trap cleanup EXIT

mkdir -p "${MOCK_BIN}" "${CAPTURE_DIR}" "${FIXTURE_DIR}" "${OUTPUT_DIR}"

cat > "${MOCK_BIN}/curl" <<'MOCK'
#!/bin/bash
set -euo pipefail

request="GET"
output_file=""
data_file=""
url=""
headers=()

while [ "$#" -gt 0 ]; do
  case "$1" in
    --request)
      request="$2"
      shift 2
      ;;
    --output)
      output_file="$2"
      shift 2
      ;;
    --header)
      headers+=("$2")
      shift 2
      ;;
    --data-binary)
      data_file="${2#@}"
      shift 2
      ;;
    --write-out|--connect-timeout|--max-time|--proto|--retry|--retry-delay|--retry-max-time)
      shift 2
      ;;
    --silent|--show-error|--tlsv1.2)
      shift
      ;;
    --*)
      echo "unexpected curl option: $1" >&2
      exit 97
      ;;
    *)
      url="$1"
      shift
      ;;
  esac
done

if [ "${request}" = "POST" ]; then
  if [ "${MOCK_INGEST_CURL_STATUS:-0}" -ne 0 ]; then
    exit "${MOCK_INGEST_CURL_STATUS}"
  fi

  : > "${MOCK_CAPTURE_DIR}/headers.txt"
  for header in "${headers[@]}"; do
    printf '%s\n' "${header}" >> "${MOCK_CAPTURE_DIR}/headers.txt"
  done
  printf '%s\n' "${url}" > "${MOCK_CAPTURE_DIR}/url.txt"
  cp "${data_file}" "${MOCK_CAPTURE_DIR}/payload.json"
  echo POST >> "${MOCK_CAPTURE_DIR}/post-count.txt"
  printf '{}\n' > "${output_file}"
  printf '%s' "${MOCK_INGEST_HTTP_CODE:-202}"
  exit 0
fi

if [ "${MOCK_HEALTH_CURL_STATUS:-0}" -ne 0 ]; then
  exit "${MOCK_HEALTH_CURL_STATUS}"
fi

cp "${MOCK_HEALTH_BODY_FILE}" "${output_file}"
printf '%s' "${MOCK_HEALTH_HTTP_CODE:-200}"
MOCK
chmod +x "${MOCK_BIN}/curl"

cat > "${FIXTURE_DIR}/operational.json" <<'JSON'
{
  "service": {
    "id": "herta-discord-bot",
    "name": "Herta",
    "type": "discord_bot"
  },
  "status": "operational",
  "checked_at": "2026-07-27T00:00:00.000Z",
  "uptime_seconds": 12345,
  "version": "0.1.0",
  "guild_count": 999,
  "checks": {
    "process": { "status": "ok" },
    "discord": {
      "status": "ok",
      "connected": true,
      "ready": true,
      "gateway_status": "ready",
      "last_heartbeat_at": "2026-07-27T00:00:00.000Z"
    },
    "database": {
      "status": "ok",
      "latency_ms": 3,
      "message": "postgres.internal.example"
    },
    "redis": {
      "status": "ok",
      "latency_ms": 1,
      "url": "redis://secret@internal"
    },
    "worker": {
      "status": "ok",
      "last_heartbeat_at": "2026-07-27T00:00:00.000Z"
    }
  },
  "token": "do-not-send"
}
JSON

cat > "${FIXTURE_DIR}/outage.json" <<'JSON'
{
  "service": { "id": "herta-discord-bot" },
  "status": "outage",
  "checked_at": "2026-07-27T00:01:00.000Z",
  "version": "0.1.0",
  "checks": {
    "process": { "status": "ok" },
    "discord": { "status": "error" },
    "database": { "status": "ok" },
    "redis": { "status": "warning" },
    "worker": { "status": "unknown" }
  }
}
JSON

cat > "${FIXTURE_DIR}/invalid.json" <<'JSON'
{
  "service": { "id": "different-service" },
  "status": "operational",
  "checked_at": "2026-07-27T00:00:00.000Z",
  "checks": {}
}
JSON

SIGNING_SECRET='test-status-signing-secret-0123456789abcdef'
LAST_STATUS=0
LAST_STDOUT=""
LAST_STDERR=""

reset_capture() {
  rm -rf "${CAPTURE_DIR}"
  mkdir -p "${CAPTURE_DIR}"
}

run_agent() {
  local fixture="$1"
  local health_code="${2:-200}"
  local ingest_code="${3:-202}"
  shift 3 || true

  reset_capture
  LAST_STDOUT="${OUTPUT_DIR}/stdout.txt"
  LAST_STDERR="${OUTPUT_DIR}/stderr.txt"

  set +e
  env \
    PATH="${MOCK_BIN}:${PATH}" \
    MOCK_CAPTURE_DIR="${CAPTURE_DIR}" \
    MOCK_HEALTH_BODY_FILE="${fixture}" \
    MOCK_HEALTH_HTTP_CODE="${health_code}" \
    MOCK_INGEST_HTTP_CODE="${ingest_code}" \
    HEALTH_URL='http://127.0.0.1:3000/healthz' \
    STATUS_INGEST_URL='https://status-ingest.example.test/v1/observations' \
    STATUS_SIGNING_SECRET="${SIGNING_SECRET}" \
    STATUS_SERVICE_ID='herta-discord-bot' \
    STATUS_SOURCE='herta-production' \
    STATUS_LOCK_FILE="${TEST_ROOT}/agent.lock" \
    STATUS_RETRY_COUNT=0 \
    "$@" \
    bash "${AGENT_SCRIPT}" >"${LAST_STDOUT}" 2>"${LAST_STDERR}"
  LAST_STATUS=$?
  set -e
}

assert_equal() {
  local expected="$1"
  local actual="$2"
  local message="$3"
  if [ "${expected}" != "${actual}" ]; then
    echo "FAIL: ${message}: expected=${expected} actual=${actual}" >&2
    exit 1
  fi
}

assert_file_absent() {
  local path="$1"
  local message="$2"
  if [ -e "${path}" ]; then
    echo "FAIL: ${message}: ${path}" >&2
    exit 1
  fi
}

assert_not_contains() {
  local pattern="$1"
  local path="$2"
  local message="$3"
  if grep -Fq "${pattern}" "${path}"; then
    echo "FAIL: ${message}" >&2
    exit 1
  fi
}

verify_signature() {
  local timestamp nonce signature actual
  timestamp="$(sed -n 's/^X-IVRM-Timestamp: //p' "${CAPTURE_DIR}/headers.txt")"
  nonce="$(sed -n 's/^X-IVRM-Nonce: //p' "${CAPTURE_DIR}/headers.txt")"
  signature="$(sed -n 's/^X-IVRM-Signature: sha256=//p' "${CAPTURE_DIR}/headers.txt")"

  actual="$(
    TEST_TIMESTAMP="${timestamp}" \
    TEST_NONCE="${nonce}" \
    TEST_SECRET="${SIGNING_SECRET}" \
    TEST_PAYLOAD="${CAPTURE_DIR}/payload.json" \
    python3 - <<'PY'
import hashlib
import hmac
import os
from pathlib import Path

canonical = (
    os.environ["TEST_TIMESTAMP"].encode("ascii")
    + b"\n"
    + os.environ["TEST_NONCE"].encode("ascii")
    + b"\n"
    + Path(os.environ["TEST_PAYLOAD"]).read_bytes()
)
print(hmac.new(os.environ["TEST_SECRET"].encode(), canonical, hashlib.sha256).hexdigest())
PY
  )"

  assert_equal "${actual}" "${signature}" 'HMAC署名がpayloadと一致すること'
}

run_agent "${FIXTURE_DIR}/operational.json" 200 202
assert_equal 0 "${LAST_STATUS}" '正常ステータスを送信できること'
jq -e '
  .schema_version == 1 and
  .service_id == "herta-discord-bot" and
  .source == "herta-production" and
  .status == "operational" and
  .version == "0.1.0" and
  .checks == {
    process: "ok",
    discord: "ok",
    database: "ok",
    redis: "ok",
    worker: "ok"
  } and
  (has("guild_count") | not) and
  (has("uptime_seconds") | not)
' "${CAPTURE_DIR}/payload.json" >/dev/null
assert_not_contains 'do-not-send' "${CAPTURE_DIR}/payload.json" 'Tokenを送信しないこと'
assert_not_contains 'postgres.internal.example' "${CAPTURE_DIR}/payload.json" '内部接続先を送信しないこと'
assert_not_contains 'redis://secret@internal' "${CAPTURE_DIR}/payload.json" 'Redis URLを送信しないこと'
verify_signature

echo 'PASS: 正常ステータスを最小payloadとHMAC署名で送信'

run_agent "${FIXTURE_DIR}/outage.json" 503 202
assert_equal 0 "${LAST_STATUS}" '503のoutage payloadも送信できること'
jq -e '.status == "outage" and .checks.discord == "error"' "${CAPTURE_DIR}/payload.json" >/dev/null

echo 'PASS: outageをHTTP 503本文から送信'

run_agent "${FIXTURE_DIR}/invalid.json" 200 202
assert_equal 3 "${LAST_STATUS}" '不正なヘルス形式を拒否すること'
assert_file_absent "${CAPTURE_DIR}/post-count.txt" '不正ヘルスを外部送信しないこと'

echo 'PASS: 不正なヘルスレスポンスを拒否'

run_agent "${FIXTURE_DIR}/operational.json" 200 401
assert_equal 4 "${LAST_STATUS}" 'status-ingestの非2xxを失敗扱いにすること'
assert_not_contains "${SIGNING_SECRET}" "${LAST_STDOUT}" '標準出力へ署名Secretを表示しないこと'
assert_not_contains "${SIGNING_SECRET}" "${LAST_STDERR}" '標準エラーへ署名Secretを表示しないこと'

echo 'PASS: status-ingest拒否を検出しSecretをログへ出さない'

run_agent "${FIXTURE_DIR}/operational.json" 200 202 STATUS_DRY_RUN=true
assert_equal 0 "${LAST_STATUS}" 'dry-runが成功すること'
assert_file_absent "${CAPTURE_DIR}/post-count.txt" 'dry-runではPOSTしないこと'
grep -q '"status":"operational"' "${LAST_STDOUT}"
assert_not_contains "${SIGNING_SECRET}" "${LAST_STDOUT}" 'dry-runへ署名Secretを表示しないこと'

echo 'PASS: dry-runで安全なpayloadだけを確認'

reset_capture
set +e
env \
  PATH="${MOCK_BIN}:${PATH}" \
  MOCK_CAPTURE_DIR="${CAPTURE_DIR}" \
  MOCK_HEALTH_BODY_FILE="${FIXTURE_DIR}/operational.json" \
  HEALTH_URL='http://127.0.0.1:3000/healthz' \
  STATUS_INGEST_URL='http://status-ingest.example.test/v1/observations' \
  STATUS_SIGNING_SECRET="${SIGNING_SECRET}" \
  STATUS_LOCK_FILE="${TEST_ROOT}/agent.lock" \
  bash "${AGENT_SCRIPT}" >"${OUTPUT_DIR}/http-stdout.txt" 2>"${OUTPUT_DIR}/http-stderr.txt"
HTTP_STATUS=$?
set -e
assert_equal 2 "${HTTP_STATUS}" '本番設定でHTTP ingestを拒否すること'
assert_file_absent "${CAPTURE_DIR}/post-count.txt" 'HTTP ingestへPOSTしないこと'

echo 'PASS: HTTPS以外のingest URLを拒否'
echo 'すべてのivrm-status-agentテストに成功しました。'
