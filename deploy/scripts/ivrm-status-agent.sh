#!/bin/bash
# ============================================================
# Herta. — ivrm-status-agent
# ------------------------------------------------------------
# Lightsailホストの内部ヘルスエンドポイントを取得し、
# 公開許可フィールドだけを署名付きでivrm-stats APIへ送信します。
# ============================================================
set -euo pipefail

umask 077

HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/healthz}"
STATUS_INGEST_URL="${STATUS_INGEST_URL:?STATUS_INGEST_URLを設定してください}"
STATUS_SIGNING_SECRET="${STATUS_SIGNING_SECRET:?STATUS_SIGNING_SECRETを設定してください}"
STATUS_SERVICE_ID="${STATUS_SERVICE_ID:-herta-discord-bot}"
STATUS_AGENT_USER_AGENT="${STATUS_AGENT_USER_AGENT:-ivrm-status-agent/1.1}"
STATUS_CONNECT_TIMEOUT_SECONDS="${STATUS_CONNECT_TIMEOUT_SECONDS:-5}"
STATUS_MAX_TIME_SECONDS="${STATUS_MAX_TIME_SECONDS:-15}"
STATUS_RETRY_COUNT="${STATUS_RETRY_COUNT:-2}"
STATUS_MAX_HEALTH_BYTES="${STATUS_MAX_HEALTH_BYTES:-65536}"
STATUS_LOCK_FILE="${STATUS_LOCK_FILE:-/var/tmp/herta-status-agent.lock}"
STATUS_DRY_RUN="${STATUS_DRY_RUN:-false}"
STATUS_ALLOW_HTTP_FOR_TESTS="${STATUS_ALLOW_HTTP_FOR_TESTS:-false}"
STATUS_ALLOW_NON_LOOPBACK_HEALTH_URL="${STATUS_ALLOW_NON_LOOPBACK_HEALTH_URL:-false}"
STATUS_INGEST_PATH='/api/internal/status-ingest'

TEMP_DIR=""

log() {
  local level="$1"
  shift
  printf '%s [%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${level}" "$*"
}

fail() {
  local message="$1"
  local exit_code="${2:-1}"
  log ERROR "${message}" >&2
  exit "${exit_code}"
}

cleanup() {
  if [ -n "${TEMP_DIR}" ] && [ -d "${TEMP_DIR}" ]; then
    rm -rf "${TEMP_DIR}"
  fi
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

require_command() {
  local command_name="$1"
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    fail "${command_name}コマンドが見つかりません。" 2
  fi
}

require_positive_integer() {
  local variable_name="$1"
  local value="$2"
  if ! [[ "${value}" =~ ^[1-9][0-9]*$ ]]; then
    fail "${variable_name}には1以上の整数を設定してください。" 2
  fi
}

require_non_negative_integer() {
  local variable_name="$1"
  local value="$2"
  if ! [[ "${value}" =~ ^[0-9]+$ ]]; then
    fail "${variable_name}には0以上の整数を設定してください。" 2
  fi
}

require_boolean() {
  local variable_name="$1"
  local value="$2"
  if [ "${value}" != "true" ] && [ "${value}" != "false" ]; then
    fail "${variable_name}にはtrueまたはfalseを設定してください。" 2
  fi
}

is_loopback_http_url() {
  local value="$1"

  python3 - "${value}" <<'PY'
import sys
from urllib.parse import urlsplit

try:
    parsed = urlsplit(sys.argv[1])
    port = parsed.port
except (ValueError, IndexError):
    raise SystemExit(1)

valid = (
    parsed.scheme.lower() == "http"
    and parsed.hostname in {"127.0.0.1", "::1", "localhost"}
    and parsed.username is None
    and parsed.password is None
    and port is not None
    and 1 <= port <= 65535
)
raise SystemExit(0 if valid else 1)
PY
}

validate_ingest_url() {
  local value="$1"
  local allow_http="$2"

  python3 - "${value}" "${allow_http}" "${STATUS_INGEST_PATH}" <<'PY'
import sys
from urllib.parse import urlsplit

value, allow_http, expected_path = sys.argv[1:]
try:
    parsed = urlsplit(value)
    port = parsed.port
except (ValueError, IndexError):
    raise SystemExit(1)

scheme = parsed.scheme.lower()
is_https = scheme == "https"
is_test_http = (
    allow_http == "true"
    and scheme == "http"
    and parsed.hostname in {"127.0.0.1", "::1", "localhost"}
    and port is not None
    and 1 <= port <= 65535
)
valid = (
    (is_https or is_test_http)
    and parsed.hostname is not None
    and parsed.username is None
    and parsed.password is None
    and parsed.path == expected_path
    and parsed.query == ""
    and parsed.fragment == ""
)
raise SystemExit(0 if valid else 1)
PY
}

for command_name in curl jq python3 flock mktemp date stat mkdir rm sed; do
  require_command "${command_name}"
done

require_positive_integer STATUS_CONNECT_TIMEOUT_SECONDS "${STATUS_CONNECT_TIMEOUT_SECONDS}"
require_positive_integer STATUS_MAX_TIME_SECONDS "${STATUS_MAX_TIME_SECONDS}"
require_non_negative_integer STATUS_RETRY_COUNT "${STATUS_RETRY_COUNT}"
require_positive_integer STATUS_MAX_HEALTH_BYTES "${STATUS_MAX_HEALTH_BYTES}"
require_boolean STATUS_DRY_RUN "${STATUS_DRY_RUN}"
require_boolean STATUS_ALLOW_HTTP_FOR_TESTS "${STATUS_ALLOW_HTTP_FOR_TESTS}"
require_boolean STATUS_ALLOW_NON_LOOPBACK_HEALTH_URL "${STATUS_ALLOW_NON_LOOPBACK_HEALTH_URL}"

HEALTH_FILE_LIMIT_BLOCKS=$(( (STATUS_MAX_HEALTH_BYTES + 1023) / 1024 ))

if [ "${#STATUS_SIGNING_SECRET}" -lt 32 ] || [ "${STATUS_SIGNING_SECRET}" = "change-me-use-openssl-rand-hex-32" ]; then
  fail "STATUS_SIGNING_SECRETには32文字以上の実Secretを設定してください。" 2
fi

if [ "${STATUS_SERVICE_ID}" != "herta-discord-bot" ]; then
  fail "STATUS_SERVICE_IDはherta-discord-botである必要があります。" 2
fi

if ! validate_ingest_url "${STATUS_INGEST_URL}" "${STATUS_ALLOW_HTTP_FOR_TESTS}"; then
  fail "STATUS_INGEST_URLには${STATUS_INGEST_PATH}を指すHTTPS URLを設定してください。" 2
fi

if [ "${STATUS_ALLOW_NON_LOOPBACK_HEALTH_URL}" != "true" ] && ! is_loopback_http_url "${HEALTH_URL}"; then
  fail "HEALTH_URLは既定でloopback HTTP URLだけを許可します。" 2
fi

mkdir -p "$(dirname "${STATUS_LOCK_FILE}")"
exec 9>"${STATUS_LOCK_FILE}"
if ! flock -n 9; then
  log INFO "前回のstatus-agentが実行中のため今回の送信を省略します。"
  exit 0
fi

TEMP_DIR="$(mktemp -d /var/tmp/herta-status-agent.XXXXXX)"
HEALTH_FILE="${TEMP_DIR}/health.json"
PAYLOAD_FILE="${TEMP_DIR}/payload.json"

log INFO "内部ヘルスを取得します。"
set +e
HEALTH_HTTP_CODE="$(
  (
    ulimit -f "${HEALTH_FILE_LIMIT_BLOCKS}"
    NO_PROXY='*' no_proxy='*' curl \
      --silent \
      --show-error \
      --output "${HEALTH_FILE}" \
      --write-out '%{http_code}' \
      --connect-timeout "${STATUS_CONNECT_TIMEOUT_SECONDS}" \
      --max-time "${STATUS_MAX_TIME_SECONDS}" \
      --max-filesize "${STATUS_MAX_HEALTH_BYTES}" \
      --header 'Accept: application/json' \
      "${HEALTH_URL}"
  )
)"
HEALTH_CURL_STATUS=$?
set -e

if [ "${HEALTH_CURL_STATUS}" -ne 0 ]; then
  fail "内部ヘルスの取得に失敗しました。curl exit=${HEALTH_CURL_STATUS}" 3
fi

if [ "${HEALTH_HTTP_CODE}" != "200" ] && [ "${HEALTH_HTTP_CODE}" != "503" ]; then
  fail "内部ヘルスが想定外のHTTP ${HEALTH_HTTP_CODE}を返しました。" 3
fi

if [ ! -s "${HEALTH_FILE}" ]; then
  fail "内部ヘルスの応答本文が空です。" 3
fi

HEALTH_SIZE="$(stat -c '%s' "${HEALTH_FILE}")"
if [ "${HEALTH_SIZE}" -gt "${STATUS_MAX_HEALTH_BYTES}" ]; then
  fail "内部ヘルスの応答が上限${STATUS_MAX_HEALTH_BYTES} bytesを超えています。" 3
fi

if ! jq -e \
  --slurp \
  --arg service_id "${STATUS_SERVICE_ID}" \
  '
    length == 1 and
    (.[0] |
      type == "object" and
      .service.id == $service_id and
      (.status | IN("operational", "degraded", "outage", "maintenance", "unknown")) and
      (.checked_at | type == "string" and length > 0) and
      (
        .version == null or
        (.version | type == "string" and length >= 1 and length <= 64 and test("^[0-9A-Za-z._+-]+$"))
      ) and
      (.checks | type == "object") and
      (.checks.process.status | IN("ok", "warning", "error", "not_configured", "unknown")) and
      (.checks.discord.status | IN("ok", "warning", "error", "not_configured", "unknown")) and
      (.checks.database.status | IN("ok", "warning", "error", "not_configured", "unknown")) and
      (.checks.redis.status | IN("ok", "warning", "error", "not_configured", "unknown")) and
      (.checks.worker.status | IN("ok", "warning", "error", "not_configured", "unknown"))
    )
  ' \
  "${HEALTH_FILE}" >/dev/null; then
  fail "内部ヘルスのJSON形式または値が不正です。" 3
fi

jq -cS \
  --slurp \
  '
    .[0] |
    {
      schema_version: "1.0",
      service: {
        id: .service.id,
        name: "Herta",
        group: "Discordサービス",
        type: "discord_bot"
      },
      status: .status,
      checked_at: .checked_at,
      version: (.version // null),
      summary: (
        if .status == "operational" then "正常に稼働しています"
        elif .status == "maintenance" then "メンテナンス中です"
        elif .status == "degraded" then "一部機能で遅延または不安定な状態です"
        elif .status == "outage" then "サービス障害が発生しています"
        else "稼働状態を確認できません"
        end
      )
    }
  ' \
  "${HEALTH_FILE}" > "${PAYLOAD_FILE}"

if [ "${STATUS_DRY_RUN}" = "true" ]; then
  log INFO "dry-runのため外部送信を行いません。"
  cat "${PAYLOAD_FILE}"
  printf '\n'
  exit 0
fi

TIMESTAMP="$(date -u +%s)"

AUTH_VALUES="$(
  STATUS_AUTH_TIMESTAMP="${TIMESTAMP}" \
  STATUS_AUTH_SECRET="${STATUS_SIGNING_SECRET}" \
  STATUS_AUTH_SERVICE_ID="${STATUS_SERVICE_ID}" \
  STATUS_AUTH_PATH="${STATUS_INGEST_PATH}" \
  STATUS_AUTH_PAYLOAD_FILE="${PAYLOAD_FILE}" \
  python3 - <<'PY'
import hashlib
import hmac
import os
from pathlib import Path
from uuid import uuid4

payload = Path(os.environ["STATUS_AUTH_PAYLOAD_FILE"]).read_bytes()
body_hash = hashlib.sha256(payload).hexdigest()
request_id = str(uuid4())
canonical = "\n".join(
    [
        "POST",
        os.environ["STATUS_AUTH_PATH"],
        os.environ["STATUS_AUTH_TIMESTAMP"],
        request_id,
        os.environ["STATUS_AUTH_SERVICE_ID"],
        body_hash,
    ]
)
signature = hmac.new(
    os.environ["STATUS_AUTH_SECRET"].encode("utf-8"),
    canonical.encode("utf-8"),
    hashlib.sha256,
).hexdigest()
print(request_id)
print(body_hash)
print(signature)
PY
)"

REQUEST_ID="$(printf '%s\n' "${AUTH_VALUES}" | sed -n '1p')"
BODY_SHA256="$(printf '%s\n' "${AUTH_VALUES}" | sed -n '2p')"
SIGNATURE="$(printf '%s\n' "${AUTH_VALUES}" | sed -n '3p')"

if ! [[ "${REQUEST_ID}" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]]; then
  fail "request IDの生成に失敗しました。" 4
fi
if ! [[ "${BODY_SHA256}" =~ ^[0-9a-f]{64}$ ]] || ! [[ "${SIGNATURE}" =~ ^[0-9a-f]{64}$ ]]; then
  fail "署名情報の生成に失敗しました。" 4
fi

CURL_PROTOCOLS='=https'
if [ "${STATUS_ALLOW_HTTP_FOR_TESTS}" = "true" ]; then
  CURL_PROTOCOLS='=http,https'
fi

log INFO "署名付きステータスを送信します。service=${STATUS_SERVICE_ID} status=$(jq -r '.status' "${PAYLOAD_FILE}")"
set +e
INGEST_HTTP_CODE="$(
  curl \
    --silent \
    --show-error \
    --output /dev/null \
    --write-out '%{http_code}' \
    --request POST \
    --proto "${CURL_PROTOCOLS}" \
    --tlsv1.2 \
    --connect-timeout "${STATUS_CONNECT_TIMEOUT_SECONDS}" \
    --max-time "${STATUS_MAX_TIME_SECONDS}" \
    --retry "${STATUS_RETRY_COUNT}" \
    --retry-delay 1 \
    --retry-max-time "${STATUS_MAX_TIME_SECONDS}" \
    --header 'Content-Type: application/json' \
    --header 'Accept: application/json' \
    --header "User-Agent: ${STATUS_AGENT_USER_AGENT}" \
    --header "X-IVRM-Service-Id: ${STATUS_SERVICE_ID}" \
    --header "X-IVRM-Timestamp: ${TIMESTAMP}" \
    --header "X-IVRM-Request-Id: ${REQUEST_ID}" \
    --header "X-IVRM-Body-SHA256: ${BODY_SHA256}" \
    --header "X-IVRM-Signature: v1=${SIGNATURE}" \
    --data-binary "@${PAYLOAD_FILE}" \
    "${STATUS_INGEST_URL}"
)"
INGEST_CURL_STATUS=$?
set -e

if [ "${INGEST_CURL_STATUS}" -ne 0 ]; then
  fail "status APIへの送信に失敗しました。curl exit=${INGEST_CURL_STATUS}" 4
fi

if [[ "${INGEST_HTTP_CODE}" =~ ^2[0-9][0-9]$ ]]; then
  log INFO "ステータス送信に成功しました。HTTP ${INGEST_HTTP_CODE}"
  exit 0
fi

if [ "${INGEST_HTTP_CODE}" = "409" ]; then
  log INFO "同一request IDは既に処理済みです。HTTP 409"
  exit 0
fi

fail "status APIがHTTP ${INGEST_HTTP_CODE}を返しました。" 4
