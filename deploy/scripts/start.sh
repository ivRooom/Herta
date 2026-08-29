#!/bin/bash
# ============================================================
# Herta. — 本番スタック起動
# ------------------------------------------------------------
# GHCRの事前ビルド済みlatest imageを利用します。
# 事前にdocker login ghcr.ioを実行してください。
# ============================================================
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

require_env_file
assert_runtime_secret_key
export HERTA_IMAGE="${HERTA_IMAGE:-${IMAGE_REPOSITORY}:latest}"

echo "=== Herta. 本番スタックを起動します (${HERTA_IMAGE}) ==="
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
echo "=== 起動完了 ==="