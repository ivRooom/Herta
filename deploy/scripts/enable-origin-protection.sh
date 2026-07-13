#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
CERT_DIR="${REPO_ROOT}/certs"
CADDY_DIR="${REPO_ROOT}/deploy/docker/caddy"
AOP_CA_URL="${AOP_CA_URL:-https://developers.cloudflare.com/ssl/static/authenticated_origin_pull_ca.pem}"
COMPOSE="docker compose --env-file ${REPO_ROOT}/.env.production -f ${REPO_ROOT}/docker-compose.prod.yml"

usage() {
  cat <<'EOF'
Usage:
  enable-origin-protection.sh --prepare
  enable-origin-protection.sh --activate
  enable-origin-protection.sh --rollback

--prepare   Cloudflare AOP検証用CA証明書を取得し、Caddy設定を検証する
--activate  CaddyfileをAOP対応版へ切り替えて再起動する
--rollback  通常のCaddyfileへ戻して再起動する

重要:
  --activate はCloudflare側でAuthenticated Origin Pullsを有効化した後に実行してください。
EOF
}

require_file() {
  if [[ ! -f "$1" ]]; then
    echo "ERROR: 必須ファイルがありません: $1" >&2
    exit 1
  fi
}

prepare() {
  mkdir -p "${CERT_DIR}"
  umask 077
  echo "Cloudflare Authenticated Origin Pull CAを取得します"
  curl --fail --show-error --silent --location \
    "${AOP_CA_URL}" \
    --output "${CERT_DIR}/cloudflare-origin-pull-ca.pem.tmp"

  openssl x509 -in "${CERT_DIR}/cloudflare-origin-pull-ca.pem.tmp" -noout -subject -issuer -dates
  mv "${CERT_DIR}/cloudflare-origin-pull-ca.pem.tmp" \
    "${CERT_DIR}/cloudflare-origin-pull-ca.pem"
  chmod 600 "${CERT_DIR}/cloudflare-origin-pull-ca.pem"

  require_file "${CERT_DIR}/origin.pem"
  require_file "${CERT_DIR}/origin-key.pem"
  require_file "${CADDY_DIR}/Caddyfile.aop"

  docker run --rm \
    -v "${CADDY_DIR}/Caddyfile.aop:/etc/caddy/Caddyfile:ro" \
    -v "${CERT_DIR}:/certs:ro" \
    caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile

  echo "準備完了。Cloudflare側でAOPを有効化した後に --activate を実行してください。"
}

activate() {
  require_file "${REPO_ROOT}/.env.production"
  require_file "${CERT_DIR}/cloudflare-origin-pull-ca.pem"
  require_file "${CADDY_DIR}/Caddyfile.aop"

  cp "${CADDY_DIR}/Caddyfile" "${CADDY_DIR}/Caddyfile.rollback"
  cp "${CADDY_DIR}/Caddyfile.aop" "${CADDY_DIR}/Caddyfile"
  ${COMPOSE} up -d --no-build caddy
  ${COMPOSE} logs --tail=50 caddy

  echo "AOP対応Caddy設定を有効化しました。Cloudflare経由の外部health checkを確認してください。"
}

rollback() {
  require_file "${REPO_ROOT}/.env.production"
  require_file "${CADDY_DIR}/Caddyfile.rollback"

  cp "${CADDY_DIR}/Caddyfile.rollback" "${CADDY_DIR}/Caddyfile"
  ${COMPOSE} up -d --no-build caddy
  ${COMPOSE} logs --tail=50 caddy
  echo "通常のCaddy設定へロールバックしました。"
}

case "${1:-}" in
  --prepare) prepare ;;
  --activate) activate ;;
  --rollback) rollback ;;
  *) usage; exit 2 ;;
esac
