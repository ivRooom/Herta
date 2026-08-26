#!/bin/bash
# ============================================================
# Herta. — Health check
# ------------------------------------------------------------
# AOP有効後も成立する内部application healthと、Cloudflare経由の
# public edge healthを分離して確認します。
# ============================================================
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

require_env_file

echo "=== コンテナ状態 ==="
${COMPOSE} ps

echo ""
wait_for_health
wait_for_auth
wait_for_bot

echo ""
wait_for_edge