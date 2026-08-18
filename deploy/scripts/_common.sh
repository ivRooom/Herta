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
PRISMA_BIN="/app/packages/db/node_modules/.bin/prisma"
PRISMA_SCHEMA="/app/packages/db/prisma/schema.prisma"

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

reclaim_production_docker_space() {
  local migrator_id migrator_running image_id

  echo "=== Docker容量を事前回収 ==="
  docker system df || true

  # migratorは正常終了後に停止したまま残るため、次回deploy前にだけ削除する。
  # 稼働中のcontainerは削除せず、volumeも一切pruneしない。
  migrator_id="$(${COMPOSE} ps -aq migrator 2>/dev/null | head -n 1 || true)"
  if [ -n "${migrator_id}" ]; then
    migrator_running="$(docker inspect --format '{{.State.Running}}' "${migrator_id}" 2>/dev/null || true)"
    if [ "${migrator_running}" != 'true' ]; then
      docker rm "${migrator_id}" > /dev/null 2>&1 || true
    fi
  fi

  # commit SHAごとに増えるHerta imageだけを削除対象にする。
  # 現在の稼働containerが参照しているimageはDocker自身が削除を拒否するため保持される。
  while IFS= read -r image_id; do
    [ -n "${image_id}" ] || continue
    docker image rm "${image_id}" > /dev/null 2>&1 || true
  done < <(docker image ls "${IMAGE_REPOSITORY}" --format '{{.ID}}' 2>/dev/null | sort -u)

  # dangling layerと古いbuild cacheだけを回収する。named volumeは触らない。
  docker image prune -f > /dev/null 2>&1 || true
  docker builder prune -f --filter 'until=24h' > /dev/null 2>&1 || true

  docker system df || true
  df -h /var/lib/docker 2>/dev/null || df -h / || true
}

pull_production_images() {
  reclaim_production_docker_space
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

service_runtime_state() {
  local service="$1"
  local container_id
  container_id="$(${COMPOSE} ps -aq "${service}" 2>/dev/null | head -n 1 || true)"
  if [ -z "${container_id}" ]; then
    printf 'missing\n'
    return 0
  fi

  docker inspect \
    --format 'status={{.State.Status}} running={{.State.Running}} exit={{.State.ExitCode}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' \
    "${container_id}" 2>/dev/null || printf 'inspect_failed\n'
}

print_migration_history() {
  local postgres_id
  postgres_id="$(${COMPOSE} ps -q postgres 2>/dev/null || true)"
  if [ -z "${postgres_id}" ] || \
    [ "$(docker inspect --format '{{.State.Running}}' "${postgres_id}" 2>/dev/null || true)" != 'true' ]; then
    echo "PostgreSQLが起動していないためmigration履歴確認をスキップします"
    return 0
  fi

  echo "=== Prisma migration history (latest 10) ==="
  ${COMPOSE} exec -T postgres sh -lc \
    'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -P pager=off -c '\''SELECT migration_name, started_at, finished_at, rolled_back_at, applied_steps_count FROM "_prisma_migrations" ORDER BY started_at DESC LIMIT 10;'\''' \
    2>&1 || true

  echo "=== Prisma migrate status ==="
  ${COMPOSE} run --rm --no-deps migrator \
    "${PRISMA_BIN}" migrate status --schema "${PRISMA_SCHEMA}" 2>&1 || true
}

# Secretや環境変数そのものは出力せず、障害切り分けに必要な状態と安全な末尾ログだけを残す。
print_deploy_diagnostics() (
  set +e
  local deploy_exit_code="${1:-1}"
  local service

  echo
  echo "=== Deploy failure diagnostics (exit=${deploy_exit_code}) ==="
  printf 'git HEAD: '
  git rev-parse --short HEAD 2>/dev/null || echo unknown

  echo "=== docker compose ps -a ==="
  ${COMPOSE} ps -a 2>&1 || true

  echo "=== container runtime states ==="
  for service in postgres redis migrator api studio bot worker nginx caddy; do
    printf '%s: %s\n' "${service}" "$(service_runtime_state "${service}")"
  done

  print_migration_history

  for service in migrator api studio bot worker nginx caddy; do
    echo "=== ${service} logs (tail 80) ==="
    ${COMPOSE} logs --tail=80 "${service}" 2>&1 || true
  done

  echo "=== End deploy failure diagnostics ==="
)

_deploy_exit_handler() {
  local status=$?
  trap - EXIT
  if [ "${status}" -ne 0 ]; then
    print_deploy_diagnostics "${status}"
  fi
  exit "${status}"
}

install_deploy_exit_trap() {
  trap _deploy_exit_handler EXIT
}

clear_deploy_exit_trap() {
  trap - EXIT
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
  local bot_container bot_health
  bot_container="$(${COMPOSE} ps -q bot)"
  echo "=== Discord Bot health check ==="
  if [ -z "${bot_container}" ]; then
    echo "ERROR: Discord Botコンテナが存在しません。" >&2
    return 1
  fi

  for i in $(seq 1 12); do
    bot_health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${bot_container}" 2>/dev/null || true)"
    if [ "${bot_health}" = 'healthy' ] || [ "${bot_health}" = 'running' ]; then
      echo "Discord Bot health check 成功 (${bot_health})"
      return 0
    fi
    echo "Bot health待ち... (${i}/12, status=${bot_health:-unknown})"
    sleep 5
  done
  echo "ERROR: Discord Botがhealthyになりませんでした。" >&2
  ${COMPOSE} logs --tail=100 bot || true
  return 1
}
