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
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/_common.sh"

# deployment targetがAOP-aware helper導入前でも安全に検証できるよう、
# current revisionのreadiness / edge checkをlegacy fallbackとして保持する。
AOP_WAIT_FOR_HEALTH_DEF="$(declare -f wait_for_health)"
AOP_WAIT_FOR_AUTH_DEF="$(declare -f wait_for_auth)"
AOP_WAIT_FOR_EDGE_DEF="$(declare -f wait_for_edge)"

DEPLOY_REF="${1:-main}"
require_env_file

echo "=== Herta. 本番デプロイ開始 (ref: ${DEPLOY_REF}) ==="

git fetch --prune --tags origin
git checkout "${DEPLOY_REF}"
git pull --ff-only origin "${DEPLOY_REF}"

# checkout/pull後はdeployment target revisionのhelperを使う。future revisionで
# readiness仕様が更新された場合は、そのtargetの実装を尊重する。
# 一方、AOP-aware helper導入前の古いrefにはwait_for_edgeが存在しないため、
# その場合だけcurrent revisionで保存した3つのhealth helperへfallbackする。
unset -f wait_for_health wait_for_auth wait_for_edge
source "${SCRIPT_DIR}/_common.sh"
if ! declare -F wait_for_health >/dev/null || \
  ! declare -F wait_for_auth >/dev/null || \
  ! declare -F wait_for_edge >/dev/null; then
  eval "${AOP_WAIT_FOR_HEALTH_DEF}"
  eval "${AOP_WAIT_FOR_AUTH_DEF}"
  eval "${AOP_WAIT_FOR_EDGE_DEF}"
fi
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
