#!/bin/bash
# ============================================================
# Herta. — ivrm-status-agent
# ------------------------------------------------------------
# Lightsailホストの内部ヘルスエンドポイントを取得し、
# 公開許可フィールドだけを署名付きでstatus-ingest APIへ送信します。
# ============================================================
set -euo pipefail

umask 077

HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/healthz}"
STATUS_INGEST_URL="${STATUS_INGEST_URL:?STATUS_INGEST_URLを設定してください}"
STATUS_SIGNING_SECRET="${STATUS_SIGNING_SECRET:?STATUS_SIGNING_SECRETを設定してください}"
STATUS_SERVICE_ID="${STATUS_SERVICE_ID:-herta-discord-bot}"
STATUS_SOURCE="${STATUS_SOURCE:-herta-production}"
STATUS_AGENT_USER_AGENT="${STATUS_AGENT_USER_AGENT:-ivrm-status-agent/1.0}"
STATUS_CONNECT_TIMEOUT_SECONDS="${STATUS_CONNECT_TIMEOUT_SECONDS:-5}"
STATUS_MAX_TIME_SECONDS="${STATUS_MAX_TIME_SECONDS:-15}"
STATUS_RETRY_COUNT="${STATUS_RETRY_COUNT:-2}"
STATUS_MAX_HEALTH_BYTES="${STATUS_MAX_HEALTH_BYTES:-65536}"
STATUS_LOCK_FILE="${STATUS_LOCK_FILE:-/var/tmp/herta-status-agent.lock}"
STATUS_DRY_RUN="${STATUS_DRY_RUN:-false}"
STATUS_ALLOW_HTTP_FOR_TESTS="${STATUS_ALLOW_HTTP_FOR_TESTS:-false}"
STATUS_ALLOW_NON_LOOPBACK_HEALTH_URL="${STATUS_ALLOW_NON_LOOPBACK_HEALTH_URL:-false}"

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

for command_name in curl jq python3 flock mktemp date stat mkdir rm; do
  require_command "${command_name}"
done

require_positive_integer STATUS_CONNECT_TIMEOUT_SECONDS "${STATUS_CONNECT_TIMEOUT_SECONDS}"
require_positive_integer STATUS_MAX_TIME_SECONDS "${STATUS_MAX_TIME_SECONDS}"
require_non_negative_integer STATUS_RETRY_COUNT "${STATUS_RETRY_COUNT}"
require_positive_integer STATUS_MAX_HEALTH_BYTES "${STATUS_MAX_HEALTH_BYTES}"

# Bashのulimit -fは1024-byte block単位です。curlの版に依存せず、
# Content-Lengthなしの応答も書込み中に停止させます。
HEALTH_FILE_LIMIT_BLOCKS=$(( (STATUS_MAX_HEALTH_BYTES + 1023) / 1024 ))

if [ "${#STATUS_SIGNING_SECRET}" -lt 32 ] || [ "${STATUS_SIGNING_SECRET}" = "change-me-use-openssl-rand-hex-32" ]; then
  fail "STATUS_SIGNING_SECRETには32文字以上の実Secretを設定してください。" 2
fi

if ! [[ "${STATUS_SERVICE_ID}" =~ ^[a-z0-9][a-z0-9._-]{2,63}$ ]]; then
  fail "STATUS_SERVICE_IDは3〜64文字の英小文字・数字・._-で設定してください。" 2
fi

if ! [[ "${STATUS_SOURCE}" =~ ^[a-z0-9][a-z0-9._-]{2,63}$ ]]; then
  fail "STATUS_SOURCEは3〜64文字の英小文字・数字・._-で設定してください。" 2
fi

if [[ "${STATUS_INGEST_URL}" != https://* ]]; then
  if [ "${STATUS_ALLOW_HTTP_FOR_TESTS}" != "true" ] || ! is_loopback_http_url "${STATUS_INGEST_URL}"; then
    fail "STATUS_INGEST_URLにはHTTPS URLを設定してください。" 2
  fi
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
    # systemdやホストにProxy環境変数があっても、loopback healthは必ず直接取得する。
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
  --arg service_id "${STATUS_SERVICE_ID}" \
  '
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
  ' \
  "${HEALTH_FILE}" >/dev/null; then
  fail "内部ヘルスのJSON形式または値が不正です。" 3
fi

SENT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

jq -cS \
  --arg source "${STATUS_SOURCE}" \
  --arg sent_at "${SENT_AT}" \
  '
    {
      schema_version: 1,
      service_id: .service.id,
      source: $source,
      observed_at: .checked_at,
      sent_at: $sent_at,
      status: .status,
      version: (.version // null),
      checks: {
        process: .checks.process.status,
        discord: .checks.discord.status,
        database: .checks.database.status,
        redis: .checks.redis.status,
        worker: .checks.worker.status
      }
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
NONCE="$(python3 - <<'PY'
import secrets
print(secrets.token_hex(16))
PY
)"

SIGNATURE="$(
  STATUS_SIGNATURE_TIMESTAMP="${TIMESTAMP}" \
  STATUS_SIGNATURE_NONCE="${NONCE}" \
  STATUS_SIGNATURE_SECRET="${STATUS_SIGNING_SECRET}" \
  STATUS_SIGNATURE_PAYLOAD_FILE="${PAYLOAD_FILE}" \
  python3 - <<'PY'
import hashlib
import hmac
import os
from pathlib import Path

timestamp = os.environ["STATUS_SIGNATURE_TIMESTAMP"]
nonce = os.environ["STATUS_SIGNATURE_NONCE"]
secret = os.environ["STATUS_SIGNATURE_SECRET"].encode("utf-8")
payload = Path(os.environ["STATUS_SIGNATURE_PAYLOAD_FILE"]).read_bytes()
canonical = timestamp.encode("ascii") + b"\n" + nonce.encode("ascii") + b"\n" + payload
print(hmac.new(secret, canonical, hashlib.sha256).hexdigest())
PY
)"

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
    --header 'X-IVRM-Signature-Version: v1' \
    --header "X-IVRM-Timestamp: ${TIMESTAMP}" \
    --header "X-IVRM-Nonce: ${NONCE}" \
    --header "X-IVRM-Signature: sha256=${SIGNATURE}" \
    --data-binary "@${PAYLOAD_FILE}" \
    "${STATUS_INGEST_URL}"
)"
INGEST_CURL_STATUS=$?
set -e

if [ "${INGEST_CURL_STATUS}" -ne 0 ]; then
  fail "status-ingest APIへの送信に失敗しました。curl exit=${INGEST_CURL_STATUS}" 4
fi

if ! [[ "${INGEST_HTTP_CODE}" =~ ^2[0-9][0-9]$ ]]; then
  fail "status-ingest APIがHTTP ${INGEST_HTTP_CODE}を返しました。" 4
fi

log INFO "ステータス送信に成功しました。HTTP ${INGEST_HTTP_CODE}"
