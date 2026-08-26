#!/bin/bash
# ============================================================
# Herta. — 本番デプロイ (手動実行用)
# ------------------------------------------------------------
# GitHub ActionsがGHCRへpushしたcommit SHA imageをpullして起動します。
# サーバー上でmonorepoのDocker buildは実行しません。
#
# 事前にGHCRへログインしてください:
#   echo "$GHCR_PAT" | docker login ghcr.io -u <github-user> --password-stdin
#
# 使い方:
#   ./deploy/scripts/deploy.sh [ref]   # ref 省略時は main
# ============================================================
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

# AOP-aware readiness / edge checkはdeploy script側の安全境界として保持する。
# deployment targetがこの変更より古い場合でも、targetの旧helperで上書きしない。
AOP_WAIT_FOR_HEALTH_DEF="$(declare -f wait_for_health)"
AOP_WAIT_FOR_AUTH_DEF="$(declare -f wait_for_auth)"
AOP_WAIT_FOR_EDGE_DEF="$(declare -f wait_for_edge)"

DEPLOY_REF="${1:-main}"
require_env_file

echo "=== Herta. 本番デプロイ開始 (ref: ${DEPLOY_REF}) ==="

git fetch --prune --tags origin
git checkout "${DEPLOY_REF}"
git pull --ff-only origin "${DEPLOY_REF}"

# checkout/pullでworktree上のhelperが更新されるため、target固有のdeploy helperは
# deployment target revisionから再読込する。一方、AOP-aware readiness / edge checkは
# current deploy scriptで保持した定義へ戻し、古いrefへのdeployでもdirect-Caddy checkへ退行させない。
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
eval "${AOP_WAIT_FOR_HEALTH_DEF}"
eval "${AOP_WAIT_FOR_AUTH_DEF}"
eval "${AOP_WAIT_FOR_EDGE_DEF}"
require_env_file

export HERTA_IMAGE="$(resolve_image_for_ref HEAD)"
echo "配布image: ${HERTA_IMAGE}"
install_deploy_exit_trap

${COMPOSE} config --quiet
pull_production_images
verify_app_image

${COMPOSE} up -d --no-build --remove-orphans
restart_proxies
sleep 5
${COMPOSE} ps -a

verify_running_services
verify_migration
wait_for_health
wait_for_auth
wait_for_bot
wait_for_edge

clear_deploy_exit_trap
echo "=== デプロイ完了 (${HERTA_IMAGE}) ==="
