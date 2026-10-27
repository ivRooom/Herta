#!/usr/bin/env bash
# Functions only: never source/evaluate .env.production as shell code.
HERTA_DATABASE_TOPOLOGY_VERSION=1

deployment_literal() {
  local key="$1" fallback="$2" value
  value=$(awk -v key="$key" '
    { line=$0; sub(/\r$/, "", line); sub(/^[ \t]+/, "", line); sub(/^export[ \t]+/, "", line)
      if (line ~ "^" key "[ \t]*=") { sub(/^[^=]*=/, "", line); found=1; value=line } }
    END { if (found) print "set:" value; else print "unset" }
  ' "$ENV_FILE") || return 1
  if [[ "$value" = unset ]]; then printf '%s\n' "$fallback"; return; fi
  value=${value#set:}
  value=$(printf '%s' "$value" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+#.*$//; s/[[:space:]]+$//')
  case "$value" in
    \"*\") value=${value#\"}; value=${value%\"} ;;
    \'*\') value=${value#\'}; value=${value%\'} ;;
  esac
  printf '%s\n' "$value"
}

database_mode() {
  local mode
  mode=$(deployment_literal HERTA_DATABASE_MODE local) || return 1
  case "$mode" in
    local|external) printf '%s\n' "$mode" ;;
    *) echo 'ERROR: Unsupported database mode.' >&2; return 2 ;;
  esac
}

assert_database_target() {
  local target="$1" mode file
  mode=$(database_mode) || return
  [[ "$mode" = external ]] || return 0
  for file in docker-compose.external.yml docker-compose.common.yml deploy/scripts/_database-mode.sh deploy/scripts/validate-external-database.mjs; do
    if ! git cat-file -e "${target}:${file}" 2>/dev/null; then
      echo 'ERROR: Target revision does not support external PostgreSQL; checkout blocked.' >&2
      return 2
    fi
  done
  if ! git show "${target}:deploy/scripts/_database-mode.sh" | grep -Fxq 'HERTA_DATABASE_TOPOLOGY_VERSION=1'; then
    echo 'ERROR: Unsupported target database topology contract.' >&2
    return 2
  fi
}

select_database_topology() {
  HERTA_SELECTED_DATABASE_MODE=$(database_mode) || return
  local default_project
  default_project=$(basename "$REPO_ROOT" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9_-]//g; s/^[^a-z0-9]+//')
  HERTA_SELECTED_PROJECT=$(deployment_literal COMPOSE_PROJECT_NAME "$default_project") || return
  if [[ ! "$HERTA_SELECTED_PROJECT" =~ ^[a-z0-9][a-z0-9_-]*$ ]]; then
    echo 'ERROR: Invalid protected Compose project name.' >&2; return 2
  fi
}

herta_compose() (
  local mode file errors status
  mode=$(database_mode) || exit $?
  if [[ "$mode" != "${HERTA_SELECTED_DATABASE_MODE:-}" ]]; then
    echo 'ERROR: Database mode changed or was not selected; operation blocked.' >&2; exit 2
  fi
  file=docker-compose.prod.yml
  if [[ "$mode" = external ]]; then
    file=docker-compose.external.yml
    # No accidental secret dump, old-source orphan removal or volume deletion.
    case "${1:-}" in logs) echo 'ERROR: External raw logs require a private operator procedure.' >&2; exit 2 ;; esac
    if [[ "${1:-}" = config && " $* " != *' --quiet '* && " $* " != *' -q '* ]]; then
      echo 'ERROR: Use config --quiet; rendered external credentials must not be printed.' >&2; exit 2
    fi
    for arg in "$@"; do
      case "$arg" in --remove-orphans|-v|--volumes) echo 'ERROR: External mode preserves the old source container and volumes.' >&2; exit 2 ;; esac
    done
  fi
  # Database settings come only from the protected file; local stderr stays live.
  local -a command=(env -u DATABASE_URL -u MIGRATION_DATABASE_URL -u HERTA_DATABASE_CA_FILE -u HERTA_DATABASE_PRIVATE_IP -u COMPOSE_PROJECT_NAME
    COMPOSE_REMOVE_ORPHANS=false HERTA_DATABASE_MODE="$mode" docker compose --project-directory "$REPO_ROOT"
    --project-name "$HERTA_SELECTED_PROJECT" --env-file "$ENV_FILE" -f "$REPO_ROOT/$file")
  if [[ "$mode" = local ]]; then
    exec "${command[@]}" "$@"
  fi
  umask 077
  errors=$(mktemp) || exit 1
  trap 'rm -f -- "$errors"' EXIT
  status=0
  "${command[@]}" "$@" 2>"$errors" || status=$?
  if (( status != 0 )); then
    echo 'ERROR: External Compose operation failed; raw provider/configuration errors withheld.' >&2
  fi
  exit "$status"
)

start_production_services() {
  local id
  if [[ "$HERTA_SELECTED_DATABASE_MODE" = external ]]; then
    # Every deployment must recheck the current effective URLs/CA/history.
    id="$(${COMPOSE} ps -aq migrator)" || return
    if [[ -n "$id" ]]; then
      if [[ $(docker inspect --format '{{.State.Running}}' "$id") = true ]]; then
        echo 'ERROR: A migrator is already running; do not interrupt it.' >&2; return 2
      fi
      docker rm "$id" >/dev/null || return
    fi
    ${COMPOSE} up -d --no-build
  else
    ${COMPOSE} up -d --no-build --remove-orphans
  fi
}
