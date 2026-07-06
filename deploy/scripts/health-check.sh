#!/bin/bash
# ============================================================
# Herta. — Health check
# ------------------------------------------------------------
# コンテナ状態と Cloudflare 経由の API 疎通を確認します。
#   - docker compose ps
#   - GET https://herta.ivrm.jp/api/v1/health (Caddy 経由)
# ============================================================
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

echo "=== コンテナ状態 ==="
${COMPOSE} ps

echo ""
wait_for_health
