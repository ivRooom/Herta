#!/bin/bash
# ============================================================
# Herta. — 本番デプロイ (手動実行用)
# ------------------------------------------------------------
# GitHub Actions と同じ手順を Lightsail 上で手動実行します。
#   git pull -> docker compose build -> up -d -> health check
#
# 使い方:
#   ./deploy/scripts/deploy.sh [ref]   # ref 省略時は main
# ============================================================
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

DEPLOY_REF="${1:-main}"
require_env_file

echo "=== Herta. 本番デプロイ開始 (ref: ${DEPLOY_REF}) ==="

# 最新コードを取得
git fetch origin
git checkout "${DEPLOY_REF}"
git pull origin "${DEPLOY_REF}"

# イメージ更新 & 再起動
${COMPOSE} pull || true
${COMPOSE} build
${COMPOSE} up -d
${COMPOSE} ps

# nginx/caddy を再起動して upstream を張り直す (502 防止)
restart_proxies

# 動作確認
wait_for_health

echo "=== デプロイ完了 ==="
