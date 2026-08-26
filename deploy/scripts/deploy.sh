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

DEPLOY_REF="${1:-main}"
require_env_file

echo "=== Herta. 本番デプロイ開始 (ref: ${DEPLOY_REF}) ==="

git fetch --prune --tags origin
git checkout "${DEPLOY_REF}"
git pull --ff-only origin "${DEPLOY_REF}"

# checkout/pullでworktree上のhelperが更新されるため、以降のreadiness判定は
# deployment target revisionの定義を再読込して実行する。checkout前にsourceした
# helperを使い続けると、AOP導入前のdirect-Caddy health checkが残る可能性がある。
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
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
