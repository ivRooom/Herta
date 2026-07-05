#!/bin/bash
# ============================================================
# Herta. — Health check
# ------------------------------------------------------------
# コンテナ状態と API の疎通を確認します。
#   - docker compose ps
#   - GET /api/v1/health (ローカル)
#   - 外部からの確認は https://herta.ivrm.jp/api/v1/health を使用
# ============================================================
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

echo "=== コンテナ状態 ==="
${COMPOSE} ps

echo ""
wait_for_health
