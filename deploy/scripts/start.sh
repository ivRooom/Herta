#!/bin/bash
# ============================================================
# Herta. — 本番スタック起動
#   docker compose -f docker-compose.prod.yml up -d
# ============================================================
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

require_env_file

echo "=== Herta. 本番スタックを起動します ==="
${COMPOSE} build
${COMPOSE} up -d
${COMPOSE} ps

wait_for_health

echo "=== 起動完了 ==="
