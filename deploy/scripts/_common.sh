#!/bin/bash
# ============================================================
# Herta. — デプロイスクリプト共通処理
# 各スクリプトから source して使用します。
# ============================================================
set -euo pipefail

# リポジトリルート (このスクリプトの 2 階層上) を基準に動作
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${REPO_ROOT}"

# 本番用 compose ファイル
COMPOSE="docker compose -f docker-compose.prod.yml"

# API health check エンドポイント
HEALTH_URL="${HEALTH_URL:-http://localhost:3001/api/v1/health}"

require_env_file() {
  if [ ! -f "${REPO_ROOT}/.env.production" ]; then
    echo "ERROR: .env.production が見つかりません。" >&2
    echo "       cp .env.production.example .env.production で作成し、値を設定してください。" >&2
    exit 1
  fi
}

# API が healthy になるまで待機 (最大 60 秒)
wait_for_health() {
  echo "=== Health check (${HEALTH_URL}) ==="
  for i in $(seq 1 12); do
    if curl -fsS "${HEALTH_URL}" > /dev/null 2>&1; then
      echo "API health check 成功"
      return 0
    fi
    echo "API 応答待ち... (${i}/12)"
    sleep 5
  done
  echo "ERROR: API health check に失敗しました。" >&2
  ${COMPOSE} logs --tail=100 api || true
  return 1
}
