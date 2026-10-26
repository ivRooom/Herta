#!/usr/bin/env bash
set -Eeuo pipefail
export MSYS_NO_PATHCONV=1
root=$(cd "$(dirname "$0")/.." && pwd)
name=ivrm-prisma-readiness-$$
image=ivrm-prisma-readiness:fixture-$$
scratch=$(mktemp -d)
host_root=$root
host_scratch=$scratch
if command -v cygpath >/dev/null 2>&1; then
  host_root=$(cygpath -m "$root")
  host_scratch=$(cygpath -m "$scratch")
fi
cleanup() {
  if [[ $(docker inspect --format '{{ index .Config.Labels "ivrm.test" }}' "$name-client" 2>/dev/null || true) = prisma-readiness-client ]]; then
    docker rm -f "$name-client" >/dev/null
  fi
  if [[ $(docker inspect --format '{{ index .Config.Labels "ivrm.test" }}' "$name" 2>/dev/null || true) = prisma-readiness ]]; then
    docker rm -f "$name" >/dev/null
  fi
  rm -f "$scratch/ca.crt" "$scratch/wrong.crt"
  rmdir "$scratch"
  if [[ $(docker image inspect --format '{{ index .Config.Labels "ivrm.test" }}' "$image" 2>/dev/null || true) = prisma-readiness ]]; then
    docker image rm "$image" >/dev/null
  fi
}
trap cleanup EXIT
build_args=()
if [[ -n ${IVRM_TEST_CA_BUNDLE:-} ]]; then build_args+=(--secret "id=trusted_ca,src=$IVRM_TEST_CA_BUNDLE"); fi
docker build -q "${build_args[@]}" --label ivrm.test=prisma-readiness -t "$image" -f "$host_root/tests/postgresql-readiness/Dockerfile" "$host_root" >/dev/null
# All SQL/credentials are synthetic, held in bounded ephemeral storage; no published ports.
docker run -d --name "$name" --label ivrm.test=prisma-readiness \
  --network none --memory 1g --cpus 2 --pids-limit 128 \
  --tmpfs /var/lib/postgresql/data:rw,size=512m --tmpfs /tls:rw,size=8m \
  -e POSTGRES_HOST_AUTH_METHOD=trust --entrypoint bash \
  pgvector/pgvector@sha256:ac08538c6f8b9904c33c8224c5e5706dbe760aca29db1d096972b4052c22a75d -c '
    set -Eeuo pipefail
    umask 077
    openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=fixture-ca -keyout /tls/ca.key -out /tls/ca.crt >/dev/null 2>&1
    openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=wrong-ca -keyout /tls/wrong.key -out /tls/wrong.crt >/dev/null 2>&1
    openssl req -newkey rsa:2048 -nodes -subj /CN=localhost -keyout /tls/server.key -out /tls/server.csr >/dev/null 2>&1
    printf "subjectAltName=DNS:localhost\nextendedKeyUsage=serverAuth\n" >/tls/server.ext
    openssl x509 -req -in /tls/server.csr -CA /tls/ca.crt -CAkey /tls/ca.key -CAcreateserial -days 1 -extfile /tls/server.ext -out /tls/server.crt >/dev/null 2>&1
    printf "local all all trust\nhostssl herta herta_runtime,herta_migrator 127.0.0.1/32 scram-sha-256\nhost all all 0.0.0.0/0 reject\nhost all all ::/0 reject\n" >/tls/pg_hba.conf
    chown -R postgres:postgres /tls
    chmod 0755 /tls
    chmod 0644 /tls/ca.crt /tls/wrong.crt /tls/pg_hba.conf
    exec docker-entrypoint.sh postgres -c listen_addresses=127.0.0.1 -c hba_file=/tls/pg_hba.conf -c ssl=on -c ssl_min_protocol_version=TLSv1.2 -c ssl_cert_file=/tls/server.crt -c ssl_key_file=/tls/server.key -c max_connections=30
  ' >/dev/null
ready=false
for ((i=0; i<60; i++)); do
  if docker exec "$name" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
test "$ready" = true
docker exec -i "$name" psql -Xq -v ON_ERROR_STOP=1 -U postgres -d postgres <<'SQL'
CREATE ROLE herta_owner NOLOGIN;
CREATE ROLE herta_migrator LOGIN PASSWORD 'synthetic-migrator';
CREATE ROLE herta_runtime LOGIN PASSWORD 'synthetic-runtime' CONNECTION LIMIT 8;
GRANT herta_owner TO herta_migrator;
CREATE DATABASE herta OWNER herta_owner;
CREATE DATABASE ivrm_ai;
REVOKE ALL ON DATABASE herta, ivrm_ai, postgres FROM PUBLIC;
GRANT CONNECT ON DATABASE herta TO herta_migrator, herta_runtime;
\connect herta
ALTER SCHEMA public OWNER TO herta_owner;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO herta_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE herta_migrator IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO herta_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE herta_migrator IN SCHEMA public GRANT USAGE,SELECT ON SEQUENCES TO herta_runtime;
SQL
docker exec "$name" cat /tls/ca.crt >"$scratch/ca.crt"
docker exec "$name" cat /tls/wrong.crt >"$scratch/wrong.crt"
# Native Prisma uses sslmode=require + sslaccept=strict + sslcert (not libpq verify-full).
timeout 180 docker run --rm --name "$name-client" --label ivrm.test=prisma-readiness-client --network "container:$name" --memory 1g --cpus 2 --pids-limit 128 \
  -e 'DATABASE_URL=postgresql://herta_migrator:synthetic-migrator@localhost:5432/herta?sslmode=require&sslaccept=strict&sslcert=/tls/ca.crt&connection_limit=2&connect_timeout=3&pool_timeout=3' \
  -v "$host_scratch:/tls:ro" --entrypoint pnpm "$image" exec prisma db push --skip-generate \
  --schema prisma/schema.prisma
timeout 90 docker run --rm --name "$name-client" --label ivrm.test=prisma-readiness-client --network "container:$name" --memory 1g --cpus 2 --pids-limit 128 -v "$host_scratch:/tls:ro" "$image"
echo 'Full Prisma schema only: db push does not replay SQL migration history, custom SQL CHECK constraints or production data.'
