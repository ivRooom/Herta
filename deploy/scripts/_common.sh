#!/bin/bash
# ============================================================
# Herta. — デプロイスクリプト共通処理
# 各スクリプトから source して使用します。
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${REPO_ROOT}"

ENV_FILE="${REPO_ROOT}/.env.production"
COMPOSE="docker compose --env-file ${ENV_FILE} -f docker-compose.prod.yml"
HEALTH_DOMAIN="${HEALTH_DOMAIN:-herta.ivrm.jp}"
IMAGE_REPOSITORY="${IMAGE_REPOSITORY:-ghcr.io/ivrooom/herta}"

require_env_file() {
  if [ ! -f "${ENV_FILE}" ]; then
    echo "ERROR: .env.production が見つかりません。" >&2
    echo "       cp .env.production.example .env.production で作成し、値を設定してください。" >&2
    exit 1
  fi

  if [ ! -r "${ENV_FILE}" ]; then
    echo "ERROR: .env.production を読み取れません。権限を確認してください。" >&2
    exit 1
  fi
}

resolve_image_for_ref() {
  local ref="$1"
  local sha
  sha="$(git rev-parse "${ref}")"
  printf '%s:%s\n' "${IMAGE_REPOSITORY}" "${sha}"
}

pull_production_images() {
  echo "=== 本番imageを取得 (${HERTA_IMAGE}) ==="
  ${COMPOSE} pull postgres redis nginx caddy api
}

verify_app_image() {
  echo "=== 配布image内の成果物を検証 ==="
  docker run --rm --entrypoint sh "${HERTA_IMAGE}" -lc '
    set -eu
    test -f apps/api/dist/main.js
    test -f apps/bot/dist/main.js
    test -f apps/worker/dist/main.js
    test -f apps/studio/.next/standalone/apps/studio/server.js
    test -n "$(find apps/studio/.next/standalone/apps/studio/.prisma/client \
      -maxdepth 1 -type f -name "libquery_engine-*.so.node" -print -quit)"
  '
}

restart_proxies() {
  echo "=== nginx / caddy 再起動 (upstream 再解決) ==="
  ${COMPOSE} restart nginx caddy
  sleep 5
}

verify_running_services() {
  echo "=== コンテナ稼働確認 ==="
  local service container_id
  for service in postgres redis api studio bot worker nginx caddy; do
    container_id="$(${COMPOSE} ps -q "${service}")"
    if [ -z "${container_id}" ]; then
      echo "ERROR: ${service}コンテナが存在しません。" >&2
      return 1
    fi
    if [ "$(docker inspect --format '{{.State.Running}}' "${container_id}")" != "true" ]; then
      echo "ERROR: ${service}コンテナが停止しています。" >&2
      ${COMPOSE} logs --tail=100 "${service}" || true
      return 1
    fi
  done
}

verify_migration() {
  local migrator_id
  migrator_id="$(${COMPOSE} ps -aq migrator)"
  if [ -z "${migrator_id}" ] || \
    [ "$(docker inspect --format '{{.State.ExitCode}}' "${migrator_id}")" != "0" ]; then
    echo "ERROR: migrationが正常終了していません。" >&2
    ${COMPOSE} logs --tail=100 migrator || true
    return 1
  fi
}

wait_for_health() {
  local health_url="https://${HEALTH_DOMAIN}/api/v1/health"
  echo "=== Health check (${health_url}) ==="
  for i in $(seq 1 24); do
    if curl -fsS -k --resolve "${HEALTH_DOMAIN}:443:127.0.0.1" "${health_url}" > /dev/null 2>&1; then
      echo "API health check 成功"
      return 0
    fi
    echo "API 応答待ち... (${i}/24)"
    sleep 5
  done
  echo "ERROR: API health check に失敗しました。" >&2
  ${COMPOSE} logs --tail=100 api || true
  ${COMPOSE} logs --tail=100 nginx || true
  ${COMPOSE} logs --tail=100 caddy || true
  return 1
}

wait_for_auth() {
  local auth_url="https://${HEALTH_DOMAIN}/api/auth/providers"
  echo "=== Auth.js health check (${auth_url}) ==="
  for i in $(seq 1 12); do
    if curl -fsS -k --resolve "${HEALTH_DOMAIN}:443:127.0.0.1" "${auth_url}" > /dev/null 2>&1; then
      echo "Auth.js health check 成功"
      return 0
    fi
    echo "Studio認証応答待ち... (${i}/12)"
    sleep 5
  done
  echo "ERROR: Auth.js health check に失敗しました。" >&2
  ${COMPOSE} logs --tail=100 studio || true
  ${COMPOSE} logs --tail=100 nginx || true
  ${COMPOSE} logs --tail=100 caddy || true
  return 1
}

wait_for_bot() {
  local bot_container
  bot_container="$(${COMPOSE} ps -q bot)"
  echo "=== Discord Botログイン確認 ==="
  for i in $(seq 1 12); do
    if docker logs --since 5m "${bot_container}" 2>&1 | grep -q "Herta Bot がログインしました"; then
      echo "Discord Botログイン成功"
      return 0
    fi
    echo "Botログイン待ち... (${i}/12)"
    sleep 5
  done
  echo "ERROR: Discord Botログインを確認できません。" >&2
  ${COMPOSE} logs --tail=100 bot || true
  return 1
}
