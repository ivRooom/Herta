#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AGENT_SCRIPT="${ROOT_DIR}/deploy/scripts/ivrm-status-agent.sh"
TEST_ROOT="$(mktemp -d /var/tmp/herta-status-agent-proxy-test.XXXXXX)"
PROXY_PORT_FILE="${TEST_ROOT}/proxy-port.txt"
PROXY_HIT_FILE="${TEST_ROOT}/proxy-hit.txt"
SIGNING_SECRET='test-status-signing-secret-0123456789abcdef'
PROXY_PID=""

cleanup() {
  if [ -n "${PROXY_PID}" ]; then
    kill "${PROXY_PID}" >/dev/null 2>&1 || true
    wait "${PROXY_PID}" 2>/dev/null || true
  fi
  rm -rf "${TEST_ROOT}"
}
trap cleanup EXIT

python3 - "${PROXY_PORT_FILE}" "${PROXY_HIT_FILE}" <<'PY' &
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

port_file = Path(sys.argv[1])
hit_file = Path(sys.argv[2])
payload = {
    "service": {"id": "herta-discord-bot"},
    "status": "operational",
    "checked_at": "2026-07-27T00:00:00.000Z",
    "version": "0.1.0",
    "checks": {
        "process": {"status": "ok"},
        "discord": {"status": "ok"},
        "database": {"status": "ok"},
        "redis": {"status": "ok"},
        "worker": {"status": "ok"},
    },
}
body = json.dumps(payload).encode("utf-8")

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        hit_file.write_text(self.path, encoding="utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        return

server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
port_file.write_text(str(server.server_address[1]), encoding="utf-8")
server.serve_forever()
PY
PROXY_PID=$!

for _ in $(seq 1 50); do
  if [ -s "${PROXY_PORT_FILE}" ]; then break; fi
  sleep 0.1
done

if [ ! -s "${PROXY_PORT_FILE}" ]; then
  echo 'FAIL: mock proxyを起動できませんでした' >&2
  exit 1
fi

PROXY_PORT="$(cat "${PROXY_PORT_FILE}")"
PROXY_URL="http://127.0.0.1:${PROXY_PORT}"

set +e
env \
  http_proxy="${PROXY_URL}" HTTP_PROXY="${PROXY_URL}" \
  https_proxy="${PROXY_URL}" HTTPS_PROXY="${PROXY_URL}" ALL_PROXY="${PROXY_URL}" \
  no_proxy='' NO_PROXY='' \
  HEALTH_URL='http://127.0.0.1:9/healthz' \
  STATUS_INGEST_URL='https://stats.ivrm.jp/api/internal/status-ingest' \
  STATUS_SIGNING_SECRET="${SIGNING_SECRET}" \
  STATUS_LOCK_FILE="${TEST_ROOT}/agent.lock" \
  STATUS_CONNECT_TIMEOUT_SECONDS=1 STATUS_MAX_TIME_SECONDS=2 STATUS_RETRY_COUNT=0 \
  STATUS_DRY_RUN=true \
  bash "${AGENT_SCRIPT}" >"${TEST_ROOT}/stdout.txt" 2>"${TEST_ROOT}/stderr.txt"
STATUS=$?
set -e

if [ "${STATUS}" -ne 3 ]; then
  echo "FAIL: Proxy設定下の到達不能loopback healthをexit code 3にできませんでした: ${STATUS}" >&2
  cat "${TEST_ROOT}/stdout.txt" >&2 || true
  cat "${TEST_ROOT}/stderr.txt" >&2 || true
  exit 1
fi

if [ -e "${PROXY_HIT_FILE}" ]; then
  echo 'FAIL: loopback health requestがProxyへ送信されました' >&2
  cat "${PROXY_HIT_FILE}" >&2 || true
  exit 1
fi

grep -q '内部ヘルスの取得に失敗しました' "${TEST_ROOT}/stderr.txt"
echo 'PASS: Proxy環境変数があってもloopback healthを直接取得'
