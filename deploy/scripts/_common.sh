#!/bin/bash
# ============================================================
# Herta. — デプロイスクリプト共通処理
# 各スクリプトから source して使用します。
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${REPO_ROOT}"

ENV_FILE="${REPO_ROOT}/.env.production"
COMPOSE="docker compose --env-file ${ENV_FILE} -f docker-compose.prod.yml"
HEALTH_DOMAIN="${HEALTH_DOMAIN:-herta.ivrm.jp}"

require_env_file() {
  if [ ! -f "${ENV_FILE}" ]; then
    echo "ERROR: .env.production が見つかりません。" >&2
    echo "       cp .env.production.example .env.production で作成し、値を設定してください。" >&2
    exit 1
  fi

  if [ ! -r "${ENV_FILE}" ]; then
    echo "ERROR: .env.production を読み取れません。権限を確認してください。" >&2
    exit 1
  fi
}

restart_proxies() {
  echo "=== nginx / caddy 再起動 (upstream 再解決) ==="
  ${COMPOSE} restart nginx caddy
  sleep 5
}

wait_for_health() {
  local health_url="https://${HEALTH_DOMAIN}/api/v1/health"
  echo "=== Health check (${health_url}) ==="
  for i in $(seq 1 24); do
    if curl -fsS -k --resolve "${HEALTH_DOMAIN}:443:127.0.0.1" "${health_url}" > /dev/null 2>&1; then
      echo "API health check 成功"
      return 0
    fi
    echo "API 応答待ち... (${i}/24)"
    sleep 5
  done
  echo "ERROR: API health check に失敗しました。" >&2
  ${COMPOSE} logs --tail=100 api || true
  ${COMPOSE} logs --tail=100 nginx || true
  ${COMPOSE} logs --tail=100 caddy || true
  return 1
}
