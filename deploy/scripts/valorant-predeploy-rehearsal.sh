#!/usr/bin/env bash
# VALORANT additive migration release fence. No live SQL mutation here.
# Must run on the reviewed production SSH host, after config validation and
# BEFORE Docker image pull / Compose up (which starts the Prisma migrator).
set -euo pipefail
script_dir="$(cd "$(dirname "$0")" && pwd)"
source "$script_dir/_common.sh"
require_env_file

migration="$REPO_ROOT/packages/db/prisma/migrations/20261103160000_valorant_voice_participants/migration.sql"
if [[ ! -f "$migration" ]]; then
  echo 'VALORANT新規migrationなし: 事前DB復元ゲートをスキップします。'
  exit 0
fi
if [[ "$HERTA_SELECTED_DATABASE_MODE" != local ]]; then
  echo 'ERROR: 外部PostgreSQLの本番バックアップ/隔離復元経路は未承認です。デプロイを停止します。' >&2
  exit 2
fi
if [[ ! "${DEPLOY_REF:-}" =~ ^[a-f0-9]{40}$ ]]; then
  echo 'ERROR: immutable deploy SHAが不正です。' >&2
  exit 2
fi
if ! docker image inspect postgres:16-alpine >/dev/null 2>&1; then
  echo 'ERROR: PG16の隔離復元用imageが未配置です。デプロイ前に承認済み手順で準備してください。' >&2
  exit 2
fi

source_container="$("$COMPOSE" ps -q postgres)"
if [[ -z "$source_container" ]] ||
   [[ "$(docker inspect --format '{{.State.Running}}' "$source_container")" != true ]]; then
  echo 'ERROR: 対象Composeの本番PG16が稼働していません。' >&2
  exit 2
fi
source_version="$("$COMPOSE" exec -T postgres sh -ec 'exec psql -X -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SHOW server_version_num"')"
if [[ ! "$source_version" =~ ^[0-9]+$ ]] || (( source_version < 160000 || source_version >= 170000 )); then
  echo 'ERROR: 本番PostgreSQLのmajor versionが想定16と異なります。' >&2
  exit 2
fi
migration_status="$("$COMPOSE" exec -T postgres sh -ec 'exec psql -X -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
SELECT CASE
  WHEN count(*) = 0 THEN 'pending'
  WHEN count(*) = 1
    AND count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) = 1
    THEN 'applied'
  ELSE 'invalid' END
FROM "_prisma_migrations"
WHERE migration_name = '20261103160000_valorant_voice_participants';
SQL
)"
if [[ "$migration_status" == invalid ]] || [[ -z "$migration_status" ]]; then
  echo 'ERROR: migration履歴が不整合です。手動resolve/再適用せず停止します。' >&2
  exit 2
fi

# Guard expected columns and nullable/default semantics without modifying any DB.
expected_schema_sql() {
  cat <<'SQL'
SELECT CASE WHEN
 EXISTS (
   SELECT 1 FROM pg_attribute
   WHERE attrelid = 'public.valorant_pick_sessions'::regclass
     AND attname = 'voice_channel_id' AND NOT attisdropped
     AND format_type(atttypid, atttypmod) = 'text' AND NOT attnotnull
 )
 AND EXISTS (
   SELECT 1 FROM pg_attribute a
   JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attrelid = 'public.valorant_pick_sessions'::regclass
     AND a.attname = 'opted_out_user_ids' AND NOT a.attisdropped
     AND format_type(a.atttypid, a.atttypmod) = 'text[]' AND a.attnotnull
     AND pg_get_expr(d.adbin, d.adrelid) IN ('ARRAY[]::text[]', '''{}''::text[]')
 )
 THEN 'ok' ELSE 'invalid' END;
SQL
}
if [[ "$migration_status" == applied ]]; then
  check="$(expected_schema_sql | "$COMPOSE" exec -T postgres sh -ec 'exec psql -X -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"')"
  if [[ "$check" != ok ]]; then
    echo 'ERROR: 本番migrationは適用済みですが列定義が一致しません。' >&2
    exit 2
  fi
  echo 'VALORANT migration適用済み・列定義をread-only確認済み。新規DDLなし。'
  exit 0
fi
if [[ "$migration_status" != pending ]]; then
  echo 'ERROR: migration状態を確認できません。' >&2
  exit 2
fi

# Ensure a fresh protected archive remains available to the operator even if
# isolated rehearsal later fails. Do not prune or upload existing backups.
umask 077
backup_dir="$HOME/.local/share/herta/release-backups"
if [[ -L "$backup_dir" ]]; then
  echo 'ERROR: バックアップ格納先はsymlinkを許可しません。' >&2
  exit 2
fi
mkdir -p -m 700 -- "$backup_dir"
chmod 700 -- "$backup_dir"
if [[ ! -d "$backup_dir" ]] || [[ ! -w "$backup_dir" ]]; then
  echo 'ERROR: バックアップ保存領域を保護できません。' >&2
  exit 2
fi
database_bytes="$("$COMPOSE" exec -T postgres sh -ec 'exec psql -X -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT pg_database_size(current_database())"')"
if [[ ! "$database_bytes" =~ ^[0-9]+$ ]]; then
  echo 'ERROR: 本番DBサイズが確認できません。' >&2
  exit 2
fi
free_kib="$(df -Pk "$backup_dir" | awk 'NR == 2 { print $4 }')"
required_kib="$(( (database_bytes / 1024) * 3 + 262144 ))"
if [[ ! "$free_kib" =~ ^[0-9]+$ ]] || (( free_kib < required_kib )); then
  echo 'ERROR: 安全なバックアップ・隔離復元のためのディスク空き容量が不足しています。' >&2
  exit 2
fi

backup="$(mktemp "$backup_dir/valorant-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXXXX.dump")"
chmod 600 -- "$backup"
echo '本番PG16からfresh custom-formatバックアップを取得します（内容はログ出力しません）。'
if ! "$COMPOSE" exec -T postgres sh -ec 'exec pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "$backup"; then
  rm -f -- "$backup"
  echo 'ERROR: pg_dump失敗。デプロイを停止しました。' >&2
  exit 2
fi
if [[ ! -s "$backup" ]]; then
  rm -f -- "$backup"
  echo 'ERROR: ダンプが空です。デプロイを停止しました。' >&2
  exit 2
fi
(
  cd "$backup_dir"
  sha256sum "$(basename "$backup")" > "$(basename "$backup").sha256"
  chmod 600 -- "$(basename "$backup").sha256"
  sha256sum --check --status "$(basename "$backup").sha256"
)
echo 'Protected dumpのSHA-256検証に成功しました。バックアップは保全します。'

# A completely offline ephemeral container; never mount the live PG volume.
# Only the exact container ID created by THIS invocation may be cleaned up.
restore_id=''
cleanup() {
  if [[ -n "$restore_id" ]]; then
    docker rm -f "$restore_id" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT
restore_name="herta-valorant-rehearsal-$(date -u +%s)-$RANDOM"
restore_id="$(docker run --detach --rm --name "$restore_name"   --network none --memory 256m --cpus 1 --pids-limit 128   -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16-alpine)"
ready=false
for attempt in $(seq 1 45); do
  if docker exec "$restore_id" pg_isready -U postgres -q >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
if [[ "$ready" != true ]]; then
  echo 'ERROR: 隔離PG16を起動できません。' >&2
  exit 2
fi
docker exec "$restore_id" createdb -U postgres valorant_rehearsal
echo '隔離PG16 (network=none) へ同一アーカイブを復元中。'
docker exec -i "$restore_id" pg_restore --no-owner --no-acl --exit-on-error   -U postgres -d valorant_rehearsal < "$backup"
before="$(docker exec "$restore_id" psql -X -At -v ON_ERROR_STOP=1 -U postgres -d valorant_rehearsal -c   'SELECT count(*) FROM "_prisma_migrations" WHERE migration_name = '\''20261103160000_valorant_voice_participants'\''')"
if [[ "$before" != 0 ]]; then
  echo 'ERROR: 隔離復元はpending migrationを再現していません。' >&2
  exit 2
fi
echo '隔離DB上だけで変更予定のmigration SQLを検証します。'
docker exec -i "$restore_id" psql -X -v ON_ERROR_STOP=1 -U postgres   -d valorant_rehearsal < "$migration" >/dev/null
after="$(expected_schema_sql | docker exec -i "$restore_id" psql -X -At -v ON_ERROR_STOP=1 -U postgres -d valorant_rehearsal)"
if [[ "$after" != ok ]]; then
  echo 'ERROR: 隔離migration後の列定義が期待と一致しません。' >&2
  exit 2
fi
# Read/write/rollback proof is only on the isolated clone.
probe="$(docker exec -i "$restore_id" psql -X -At -v ON_ERROR_STOP=1 -U postgres -d valorant_rehearsal <<'SQL'
BEGIN;
CREATE TEMP TABLE herta_rehearsal_probe (id integer);
INSERT INTO herta_rehearsal_probe VALUES (1);
SELECT count(*) FROM herta_rehearsal_probe;
ROLLBACK;
SQL
)"
if ! printf '%s\n' "$probe" | grep -Fxq '1'; then
  echo 'ERROR: 隔離DBのトランザクション検証に失敗しました。' >&2
  exit 2
fi
echo '本番DBへ新規DDLを実行せず、PG16 backup/sha256/隔離restore/exact SQL rehearsalが成功しました。'
