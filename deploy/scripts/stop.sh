#!/bin/bash
# ============================================================
# Herta. — 本番スタック停止
#   docker compose -f docker-compose.prod.yml down
#
# データ (postgres_data / redis_data) は保持されます。
# ボリュームも削除する場合は: ./stop.sh --volumes
# ============================================================
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

if [ "${1:-}" = "--volumes" ]; then
  echo "=== Herta. 本番スタックを停止します (ボリュームも削除) ==="
  ${COMPOSE} down -v
else
  echo "=== Herta. 本番スタックを停止します ==="
  ${COMPOSE} down
fi

echo "=== 停止完了 ==="
