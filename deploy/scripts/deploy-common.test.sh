#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/_common.sh"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

cat > "${TMP_DIR}/fake-compose" <<'SH'
#!/bin/sh
if [ "$1" = "ps" ] && [ "$2" = "-q" ] && [ "$3" = "bot" ]; then
  echo bot-container-id
  exit 0
fi
if [ "$1" = "logs" ]; then
  echo "ERROR: wait_for_bot must not depend on recent login logs" >&2
  exit 91
fi
exit 0
SH

cat > "${TMP_DIR}/docker" <<'SH'
#!/bin/sh
if [ "$1" = "inspect" ]; then
  echo healthy
  exit 0
fi
if [ "$1" = "logs" ]; then
  echo "ERROR: wait_for_bot must not inspect recent login logs" >&2
  exit 92
fi
exit 0
SH

cat > "${TMP_DIR}/sleep" <<'SH'
#!/bin/sh
echo "ERROR: healthy bot should not require a retry sleep" >&2
exit 93
SH

chmod +x "${TMP_DIR}/fake-compose" "${TMP_DIR}/docker" "${TMP_DIR}/sleep"
PATH="${TMP_DIR}:${PATH}"
COMPOSE="fake-compose"

wait_for_bot

echo "deploy common tests passed"