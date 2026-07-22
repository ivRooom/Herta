#!/bin/bash
# ============================================================
# Herta. — ロールバック
# ------------------------------------------------------------
# 指定commitのGHCR imageへ切り戻します。サーバー上で再buildしません。
# 引数を省略した場合は1つ前のcommit (HEAD~1) を対象にします。
#
# 使い方:
#   ./deploy/scripts/rollback.sh              # HEAD~1へ
#   ./deploy/scripts/rollback.sh <commit|tag> # 指定revisionへ
#
# 注意: DB migration (prisma migrate deploy) は前方向のみです。
#       schema変更を伴うreleaseの切り戻しは、事前backupからの
#       restoreが必要になる場合があります。
# ============================================================
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

require_env_file

git fetch --prune --tags origin
TARGET="${1:-HEAD~1}"
TARGET_SHA="$(git rev-parse "${TARGET}")"
export HERTA_IMAGE="${IMAGE_REPOSITORY}:${TARGET_SHA}"

echo "=== Herta. ロールバック ==="
echo "現在:       $(git rev-parse HEAD)"
echo "切り戻し先: ${TARGET} (${TARGET_SHA})"
echo "配布image:  ${HERTA_IMAGE}"

git checkout "${TARGET_SHA}"
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

echo "=== ロールバック完了 (${TARGET_SHA}) ==="
echo "mainへ戻す場合: git checkout main && ./deploy/scripts/deploy.sh"
