#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
source "$ROOT/deploy/scripts/_database-mode.sh"
REPO_ROOT="$ROOT"
fixture=$(mktemp -d)
trap 'rm -rf -- "$fixture"' EXIT
ENV_FILE="$fixture/env"
printf 'COMPOSE_PROJECT_NAME=herta\n' > "$ENV_FILE"
[[ $(database_mode) = local ]]
printf 'HERTA_DATABASE_MODE="external" # supported\nCOMPOSE_PROJECT_NAME=herta\n' > "$ENV_FILE"
select_database_topology
[[ "$HERTA_SELECTED_DATABASE_MODE" = external ]]
if assert_database_target 1941b7e7862eb405ed44e0cc627b010a4eb1e48b 2>/dev/null; then echo 'Legacy revision accepted'; exit 1; fi
for args in 'up --remove-orphans' 'down -v' 'config' 'logs api'; do
  if herta_compose $args >/dev/null 2>&1; then echo 'Unsafe operation accepted'; exit 1; fi
done
mkdir "$fixture/bin"
cat > "$fixture/bin/docker" <<'EOF'
#!/usr/bin/env bash
[[ "$COMPOSE_REMOVE_ORPHANS" = false && "$HERTA_DATABASE_MODE" = external ]]
[[ ! -v DATABASE_URL && ! -v MIGRATION_DATABASE_URL ]]
[[ "$*" = *'--project-name herta'* && "$*" = *docker-compose.external.yml* ]]
EOF
chmod +x "$fixture/bin/docker"
export PATH="$fixture/bin:$PATH" COMPOSE_REMOVE_ORPHANS=true DATABASE_URL=sentinel-secret MIGRATION_DATABASE_URL=sentinel-secret
herta_compose config --quiet
# A provider/parser failure must not leak a credential embedded in its error.
printf '#!/usr/bin/env bash\necho sentinel-secret >&2\nexit 1\n' > "$fixture/bin/docker"
if herta_compose config --quiet >"$fixture/result" 2>&1; then exit 1; fi
if grep -q sentinel-secret "$fixture/result"; then echo 'Secret leaked'; exit 1; fi
COMPOSE=fake_compose
fake_compose() { if [[ "$1" = ps ]]; then echo fixture-migrator; else echo "$*" >> "$fixture/calls"; fi; }
docker() {
  if [[ "$1" = inspect ]]; then echo "${RUNNING:-false}"
  elif [[ "$1" = rm ]]; then echo removed >> "$fixture/calls"
  else return 1; fi
}
RUNNING=true
if start_production_services >/dev/null 2>&1; then echo 'Running migrator interrupted'; exit 1; fi
[[ ! -f "$fixture/calls" ]]
RUNNING=false
start_production_services
[[ $(head -n 1 "$fixture/calls") = removed ]]
grep -Fx 'up -d --no-build' "$fixture/calls" >/dev/null
printf '\nHERTA_DATABASE_MODE=unknown\n' >> "$ENV_FILE"
if database_mode >/dev/null 2>&1; then echo 'Unknown mode accepted'; exit 1; fi
# Local mode must preserve stderr/stdout order rather than defer diagnostics.
printf 'HERTA_DATABASE_MODE=local\nCOMPOSE_PROJECT_NAME=herta\n' > "$ENV_FILE"
select_database_topology
printf '#!/usr/bin/env bash\nprintf "stderr-first\\n" >&2\nprintf "stdout-second\\n"\n' > "$fixture/bin/docker"
[[ $(herta_compose config --quiet 2>&1) = $'stderr-first\nstdout-second' ]]
echo 'database mode tests passed'
