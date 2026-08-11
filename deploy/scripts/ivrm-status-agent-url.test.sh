#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AGENT_SCRIPT="${ROOT_DIR}/deploy/scripts/ivrm-status-agent.sh"
TEST_ROOT="$(mktemp -d /var/tmp/herta-status-agent-url-test.XXXXXX)"
SIGNING_SECRET='test-status-signing-secret-0123456789abcdef'

cleanup() { rm -rf "${TEST_ROOT}"; }
trap cleanup EXIT

run_invalid_url_case() {
  local health_url="$1"
  local ingest_url="$2"
  local allow_http="$3"
  local output_file="$4"

  set +e
  env \
    HEALTH_URL="${health_url}" \
    STATUS_INGEST_URL="${ingest_url}" \
    STATUS_SIGNING_SECRET="${SIGNING_SECRET}" \
    STATUS_LOCK_FILE="${TEST_ROOT}/agent.lock" \
    STATUS_ALLOW_HTTP_FOR_TESTS="${allow_http}" \
    STATUS_DRY_RUN=true \
    bash "${AGENT_SCRIPT}" >"${output_file}.stdout" 2>"${output_file}.stderr"
  local status=$?
  set -e

  if [ "${status}" -ne 2 ]; then
    echo "FAIL: 不正URLをexit code 2で拒否できませんでした: ${health_url} ${ingest_url}" >&2
    exit 1
  fi
}

run_invalid_url_case 'http://localhost.evil.example:3000/healthz' 'https://status.ivrm.jp/api/internal/status-ingest' false "${TEST_ROOT}/malicious-health"
grep -q 'HEALTH_URLは既定でloopback' "${TEST_ROOT}/malicious-health.stderr"
echo 'PASS: localhostを前方一致させた外部health URLを拒否'

run_invalid_url_case 'http://127.0.0.1:3000@evil.example/healthz' 'https://status.ivrm.jp/api/internal/status-ingest' false "${TEST_ROOT}/userinfo-health"
grep -q 'HEALTH_URLは既定でloopback' "${TEST_ROOT}/userinfo-health.stderr"
echo 'PASS: userinfoでloopbackに偽装した外部health URLを拒否'

run_invalid_url_case 'http://127.0.0.1:3000/healthz' 'https://evil.example/api/internal/status-ingest' false "${TEST_ROOT}/arbitrary-https-host"
grep -q 'STATUS_INGEST_URLにはhttps://status.ivrm.jp/api/internal/status-ingest' "${TEST_ROOT}/arbitrary-https-host.stderr"
echo 'PASS: 固定先以外のHTTPS Hostを拒否'

run_invalid_url_case 'http://127.0.0.1:3000/healthz' 'https://status.ivrm.jp:444/api/internal/status-ingest' false "${TEST_ROOT}/nonstandard-port"
grep -q 'STATUS_INGEST_URLにはhttps://status.ivrm.jp/api/internal/status-ingest' "${TEST_ROOT}/nonstandard-port.stderr"
echo 'PASS: 本番Hostの非標準HTTPS portを拒否'

run_invalid_url_case 'http://127.0.0.1:3000/healthz' 'http://localhost.evil.example:8080/api/internal/status-ingest' true "${TEST_ROOT}/malicious-ingest"
grep -q 'STATUS_INGEST_URLにはhttps://status.ivrm.jp/api/internal/status-ingest' "${TEST_ROOT}/malicious-ingest.stderr"
echo 'PASS: localhostを前方一致させたHTTP ingest URLを拒否'

run_invalid_url_case 'http://127.0.0.1:3000/healthz' 'http://127.0.0.1:8080@evil.example/api/internal/status-ingest' true "${TEST_ROOT}/userinfo-ingest"
grep -q 'STATUS_INGEST_URLにはhttps://status.ivrm.jp/api/internal/status-ingest' "${TEST_ROOT}/userinfo-ingest.stderr"
echo 'PASS: userinfoでloopbackに偽装したHTTP ingest URLを拒否'

run_invalid_url_case 'http://127.0.0.1:3000/healthz' 'https://status.ivrm.jp/v1/observations' false "${TEST_ROOT}/wrong-path"
grep -q 'STATUS_INGEST_URLにはhttps://status.ivrm.jp/api/internal/status-ingest' "${TEST_ROOT}/wrong-path.stderr"
echo 'PASS: 署名対象と異なるingest pathを拒否'

run_invalid_url_case 'http://127.0.0.1:3000/healthz' 'https://status.ivrm.jp/api/internal/status-ingest?debug=true' false "${TEST_ROOT}/query"
grep -q 'STATUS_INGEST_URLにはhttps://status.ivrm.jp/api/internal/status-ingest' "${TEST_ROOT}/query.stderr"
echo 'PASS: canonical pathを変えるquery付きURLを拒否'

# 旧ドメインへ戻す設定は明示的に拒否する。
run_invalid_url_case 'http://127.0.0.1:3000/healthz' 'https://stats.ivrm.jp/api/internal/status-ingest' false "${TEST_ROOT}/legacy-host"
grep -q 'STATUS_INGEST_URLにはhttps://status.ivrm.jp/api/internal/status-ingest' "${TEST_ROOT}/legacy-host.stderr"
echo 'PASS: 旧stats.ivrm.jpへの送信を拒否'

set +e
env \
  HEALTH_URL='http://127.0.0.1:3000/healthz' \
  STATUS_INGEST_URL='https://status.ivrm.jp/api/internal/status-ingest' \
  STATUS_SIGNING_SECRET='change-me-use-openssl-rand-hex-32' \
  STATUS_LOCK_FILE="${TEST_ROOT}/agent.lock" \
  STATUS_DRY_RUN=true \
  bash "${AGENT_SCRIPT}" >"${TEST_ROOT}/placeholder.stdout" 2>"${TEST_ROOT}/placeholder.stderr"
PLACEHOLDER_STATUS=$?
set -e

if [ "${PLACEHOLDER_STATUS}" -ne 2 ]; then
  echo 'FAIL: 公開済みplaceholder Secretを拒否できませんでした' >&2
  exit 1
fi
grep -q '実Secretを設定してください' "${TEST_ROOT}/placeholder.stderr"
echo 'PASS: 公開済みplaceholder Secretを拒否'

echo 'すべてのstatus-agent URL・Secret境界テストに成功しました。'
