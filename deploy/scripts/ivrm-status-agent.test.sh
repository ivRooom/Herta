#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AGENT_SCRIPT="${ROOT_DIR}/deploy/scripts/ivrm-status-agent.sh"
TEST_ROOT="$(mktemp -d /var/tmp/herta-status-agent-test.XXXXXX)"
MOCK_BIN="${TEST_ROOT}/bin"
CAPTURE_DIR="${TEST_ROOT}/capture"
FIXTURE_DIR="${TEST_ROOT}/fixtures"
OUTPUT_DIR="${TEST_ROOT}/output"

cleanup() { rm -rf "${TEST_ROOT}"; }
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
    --request) request="$2"; shift 2 ;;
    --output) output_file="$2"; shift 2 ;;
    --header) headers+=("$2"); shift 2 ;;
    --data-binary) data_file="${2#@}"; shift 2 ;;
    --write-out|--connect-timeout|--max-time|--max-filesize|--proto|--retry|--retry-delay|--retry-max-time) shift 2 ;;
    --silent|--show-error|--tlsv1.2) shift ;;
    --*) echo "unexpected curl option: $1" >&2; exit 97 ;;
    *) url="$1"; shift ;;
  esac
done
if [ "${request}" = "POST" ]; then
  if [ "${MOCK_INGEST_CURL_STATUS:-0}" -ne 0 ]; then exit "${MOCK_INGEST_CURL_STATUS}"; fi
  : > "${MOCK_CAPTURE_DIR}/headers.txt"
  for header in "${headers[@]}"; do printf '%s\n' "${header}" >> "${MOCK_CAPTURE_DIR}/headers.txt"; done
  printf '%s\n' "${url}" > "${MOCK_CAPTURE_DIR}/url.txt"
  cp "${data_file}" "${MOCK_CAPTURE_DIR}/payload.json"
  echo POST >> "${MOCK_CAPTURE_DIR}/post-count.txt"
  printf '{}\n' > "${output_file}"
  printf '%s' "${MOCK_INGEST_HTTP_CODE:-202}"
  exit 0
fi
if [ "${MOCK_HEALTH_CURL_STATUS:-0}" -ne 0 ]; then exit "${MOCK_HEALTH_CURL_STATUS}"; fi
cp "${MOCK_HEALTH_BODY_FILE}" "${output_file}"
printf '%s' "${MOCK_HEALTH_HTTP_CODE:-200}"
MOCK
chmod +x "${MOCK_BIN}/curl"

cat > "${FIXTURE_DIR}/operational.json" <<'JSON'
{
  "service": {"id":"herta-discord-bot","name":"Herta","type":"discord_bot"},
  "status":"operational",
  "checked_at":"2026-07-27T00:00:00.000Z",
  "uptime_seconds":12345,
  "version":"0.1.0",
  "guild_count":999,
  "checks":{
    "process":{"status":"ok"},
    "discord":{"status":"ok","connected":true,"gateway_status":"ready"},
    "database":{"status":"ok","latency_ms":3,"message":"postgres.internal.example"},
    "redis":{"status":"ok","latency_ms":1,"url":"redis://secret@internal"},
    "worker":{"status":"ok"}
  },
  "token":"do-not-send"
}
JSON
cat > "${FIXTURE_DIR}/outage.json" <<'JSON'
{"service":{"id":"herta-discord-bot"},"status":"outage","checked_at":"2026-07-27T00:01:00.000Z","version":"0.1.0","checks":{"process":{"status":"ok"},"discord":{"status":"error"},"database":{"status":"ok"},"redis":{"status":"warning"},"worker":{"status":"unknown"}}}
JSON
cat > "${FIXTURE_DIR}/invalid.json" <<'JSON'
{"service":{"id":"different-service"},"status":"operational","checked_at":"2026-07-27T00:00:00.000Z","checks":{}}
JSON
cat > "${FIXTURE_DIR}/invalid-version.json" <<'JSON'
{"service":{"id":"herta-discord-bot"},"status":"operational","checked_at":"2026-07-27T00:02:00.000Z","version":{"secret_token":"must-not-be-forwarded"},"checks":{"process":{"status":"ok"},"discord":{"status":"ok"},"database":{"status":"ok"},"redis":{"status":"ok"},"worker":{"status":"ok"}}}
JSON

SIGNING_SECRET='test-status-signing-secret-0123456789abcdef'
LAST_STATUS=0
LAST_STDOUT=""
LAST_STDERR=""
reset_capture() { rm -rf "${CAPTURE_DIR}"; mkdir -p "${CAPTURE_DIR}"; }
run_agent() {
  local fixture="$1" health_code="${2:-200}" ingest_code="${3:-202}"
  shift 3 || true
  reset_capture
  LAST_STDOUT="${OUTPUT_DIR}/stdout.txt"
  LAST_STDERR="${OUTPUT_DIR}/stderr.txt"
  set +e
  env PATH="${MOCK_BIN}:${PATH}" MOCK_CAPTURE_DIR="${CAPTURE_DIR}" \
    MOCK_HEALTH_BODY_FILE="${fixture}" MOCK_HEALTH_HTTP_CODE="${health_code}" \
    MOCK_INGEST_HTTP_CODE="${ingest_code}" HEALTH_URL='http://127.0.0.1:3000/healthz' \
    STATUS_INGEST_URL='https://stats.ivrm.jp/api/internal/status-ingest' \
    STATUS_SIGNING_SECRET="${SIGNING_SECRET}" STATUS_SERVICE_ID='herta-discord-bot' \
    STATUS_LOCK_FILE="${TEST_ROOT}/agent.lock" STATUS_RETRY_COUNT=0 "$@" \
    bash "${AGENT_SCRIPT}" >"${LAST_STDOUT}" 2>"${LAST_STDERR}"
  LAST_STATUS=$?
  set -e
}
assert_equal() { [ "$1" = "$2" ] || { echo "FAIL: $3 expected=$1 actual=$2" >&2; exit 1; }; }
assert_file_absent() { [ ! -e "$1" ] || { echo "FAIL: $2" >&2; exit 1; }; }
assert_not_contains() { ! grep -Fq "$1" "$2" || { echo "FAIL: $3" >&2; exit 1; }; }

verify_signature() {
  local service_id timestamp request_id body_hash signature actual_hash actual_signature
  service_id="$(sed -n 's/^X-IVRM-Service-Id: //p' "${CAPTURE_DIR}/headers.txt")"
  timestamp="$(sed -n 's/^X-IVRM-Timestamp: //p' "${CAPTURE_DIR}/headers.txt")"
  request_id="$(sed -n 's/^X-IVRM-Request-Id: //p' "${CAPTURE_DIR}/headers.txt")"
  body_hash="$(sed -n 's/^X-IVRM-Body-SHA256: //p' "${CAPTURE_DIR}/headers.txt")"
  signature="$(sed -n 's/^X-IVRM-Signature: v1=//p' "${CAPTURE_DIR}/headers.txt")"
  readarray -t values < <(
    TEST_TIMESTAMP="${timestamp}" TEST_REQUEST_ID="${request_id}" TEST_SERVICE_ID="${service_id}" \
    TEST_BODY_HASH="${body_hash}" TEST_SECRET="${SIGNING_SECRET}" TEST_PAYLOAD="${CAPTURE_DIR}/payload.json" \
    python3 - <<'PY'
import hashlib, hmac, os
from pathlib import Path
body = Path(os.environ['TEST_PAYLOAD']).read_bytes()
actual_hash = hashlib.sha256(body).hexdigest()
canonical = '\n'.join(['POST','/api/internal/status-ingest',os.environ['TEST_TIMESTAMP'],os.environ['TEST_REQUEST_ID'],os.environ['TEST_SERVICE_ID'],actual_hash])
print(actual_hash)
print(hmac.new(os.environ['TEST_SECRET'].encode(), canonical.encode(), hashlib.sha256).hexdigest())
PY
  )
  actual_hash="${values[0]}"
  actual_signature="${values[1]}"
  assert_equal "${actual_hash}" "${body_hash}" '本文SHA-256が一致すること'
  assert_equal "${actual_signature}" "${signature}" 'ivrm-stats HMAC署名が一致すること'
  [[ "${request_id}" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]] || {
    echo 'FAIL: request IDがUUID v4ではありません' >&2
    exit 1
  }
}

run_agent "${FIXTURE_DIR}/operational.json" 200 202
assert_equal 0 "${LAST_STATUS}" '正常ステータスを送信できること'
jq -e '
  .schema_version == "1.0" and
  .service == {id:"herta-discord-bot",name:"Herta",group:"Discordサービス",type:"discord_bot"} and
  .status == "operational" and .checked_at == "2026-07-27T00:00:00.000Z" and
  .version == "0.1.0" and .summary == "正常に稼働しています" and
  (has("checks") | not) and (has("guild_count") | not) and (has("uptime_seconds") | not)
' "${CAPTURE_DIR}/payload.json" >/dev/null
assert_not_contains 'do-not-send' "${CAPTURE_DIR}/payload.json" 'Tokenを送信しないこと'
assert_not_contains 'postgres.internal.example' "${CAPTURE_DIR}/payload.json" '内部接続先を送信しないこと'
assert_not_contains 'redis://secret@internal' "${CAPTURE_DIR}/payload.json" 'Redis URLを送信しないこと'
verify_signature
grep -qx 'https://stats.ivrm.jp/api/internal/status-ingest' "${CAPTURE_DIR}/url.txt"
echo 'PASS: ivrm-stats互換payloadとHMAC署名で送信'

run_agent "${FIXTURE_DIR}/outage.json" 503 202
assert_equal 0 "${LAST_STATUS}" '503のoutage payloadも送信できること'
jq -e '.status == "outage" and .summary == "サービス障害が発生しています"' "${CAPTURE_DIR}/payload.json" >/dev/null
echo 'PASS: outageをHTTP 503本文から送信'

run_agent "${FIXTURE_DIR}/invalid.json" 200 202
assert_equal 3 "${LAST_STATUS}" '不正なヘルス形式を拒否すること'
assert_file_absent "${CAPTURE_DIR}/post-count.txt" '不正ヘルスを外部送信しないこと'

run_agent "${FIXTURE_DIR}/invalid-version.json" 200 202
assert_equal 3 "${LAST_STATUS}" 'object型versionを拒否すること'
assert_file_absent "${CAPTURE_DIR}/post-count.txt" '不正versionを外部送信しないこと'
assert_not_contains 'must-not-be-forwarded' "${LAST_STDOUT}" '不正version内容を標準出力へ表示しないこと'
assert_not_contains 'must-not-be-forwarded' "${LAST_STDERR}" '不正version内容を標準エラーへ表示しないこと'

run_agent "${FIXTURE_DIR}/operational.json" 200 401
assert_equal 4 "${LAST_STATUS}" '受信APIの401を失敗扱いにすること'
assert_not_contains "${SIGNING_SECRET}" "${LAST_STDOUT}" '標準出力へSecretを表示しないこと'
assert_not_contains "${SIGNING_SECRET}" "${LAST_STDERR}" '標準エラーへSecretを表示しないこと'

run_agent "${FIXTURE_DIR}/operational.json" 200 409
assert_equal 0 "${LAST_STATUS}" '再送時の409を処理済みとして扱うこと'
grep -q '既に処理済み' "${LAST_STDOUT}"

run_agent "${FIXTURE_DIR}/operational.json" 200 202 STATUS_DRY_RUN=true
assert_equal 0 "${LAST_STATUS}" 'dry-runが成功すること'
assert_file_absent "${CAPTURE_DIR}/post-count.txt" 'dry-runではPOSTしないこと'
grep -q '"schema_version":"1.0"' "${LAST_STDOUT}"
assert_not_contains "${SIGNING_SECRET}" "${LAST_STDOUT}" 'dry-runへSecretを表示しないこと'

reset_capture
set +e
env PATH="${MOCK_BIN}:${PATH}" MOCK_CAPTURE_DIR="${CAPTURE_DIR}" \
  MOCK_HEALTH_BODY_FILE="${FIXTURE_DIR}/operational.json" HEALTH_URL='http://127.0.0.1:3000/healthz' \
  STATUS_INGEST_URL='http://stats.ivrm.jp/api/internal/status-ingest' \
  STATUS_SIGNING_SECRET="${SIGNING_SECRET}" STATUS_LOCK_FILE="${TEST_ROOT}/agent.lock" \
  bash "${AGENT_SCRIPT}" >"${OUTPUT_DIR}/http-stdout.txt" 2>"${OUTPUT_DIR}/http-stderr.txt"
HTTP_STATUS=$?
set -e
assert_equal 2 "${HTTP_STATUS}" '本番設定でHTTP ingestを拒否すること'
assert_file_absent "${CAPTURE_DIR}/post-count.txt" 'HTTP ingestへPOSTしないこと'

echo 'すべてのivrm-status-agentテストに成功しました。'
