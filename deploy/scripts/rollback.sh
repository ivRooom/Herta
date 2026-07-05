#!/bin/bash
# ============================================================
# Herta. — ロールバック
# ------------------------------------------------------------
# 指定したコミット / タグへ切り戻して再ビルド・再起動します。
# 引数を省略した場合は 1 つ前のコミット (HEAD~1) に戻します。
#
# 使い方:
#   ./deploy/scripts/rollback.sh              # HEAD~1 へ
#   ./deploy/scripts/rollback.sh <commit|tag> # 指定リビジョンへ
#
# 注意: DB マイグレーション (prisma migrate deploy) は前方向のみです。
#       スキーマ変更を伴うリリースの切り戻しは、事前バックアップからの
#       リストアが必要になる場合があります (docs/DEPLOYMENT_LIGHTSAIL.md 参照)。
# ============================================================
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

require_env_file

git fetch origin --tags
TARGET="${1:-HEAD~1}"
TARGET_SHA="$(git rev-parse "${TARGET}")"

echo "=== Herta. ロールバック ==="
echo "現在:   $(git rev-parse HEAD)"
echo "切り戻し先: ${TARGET} (${TARGET_SHA})"

git checkout "${TARGET_SHA}"

${COMPOSE} build
${COMPOSE} up -d
${COMPOSE} ps

wait_for_health

echo "=== ロールバック完了 (${TARGET_SHA}) ==="
echo "main に戻す場合: git checkout main && ./deploy/scripts/deploy.sh"
