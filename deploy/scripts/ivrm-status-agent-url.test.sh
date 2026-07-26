#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AGENT_SCRIPT="${ROOT_DIR}/deploy/scripts/ivrm-status-agent.sh"
TEST_ROOT="$(mktemp -d /var/tmp/herta-status-agent-url-test.XXXXXX)"
SIGNING_SECRET='test-status-signing-secret-0123456789abcdef'

cleanup() {
  rm -rf "${TEST_ROOT}"
}
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

run_invalid_url_case \
  'http://localhost.evil.example:3000/healthz' \
  'https://status-ingest.example.test/v1/observations' \
  false \
  "${TEST_ROOT}/malicious-health"

grep -q 'HEALTH_URLは既定でloopback' "${TEST_ROOT}/malicious-health.stderr"
echo 'PASS: localhostを前方一致させた外部health URLを拒否'

run_invalid_url_case \
  'http://127.0.0.1:3000/healthz' \
  'http://localhost.evil.example:8080/v1/observations' \
  true \
  "${TEST_ROOT}/malicious-ingest"

grep -q 'STATUS_INGEST_URLにはHTTPS URL' "${TEST_ROOT}/malicious-ingest.stderr"
echo 'PASS: localhostを前方一致させたHTTP ingest URLを拒否'

echo 'すべてのstatus-agent URL境界テストに成功しました。'
