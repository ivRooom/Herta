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

# ---- assert_runtime_secret_key ----------------------------------------------
# 有効な32-byte base64 / 64桁hexを受理し、未設定・空・不正長を拒否する。
# いずれの分岐でもmaster keyそのものをstdout / stderrへ出さないことを確認する。
SECRET_SENTINEL='c2VjcmV0LXNlbnRpbmVsLXZhbHVlLW11c3Qtbm90LWxlYWs='

run_assert_case() {
  local fixture="$1" want="$2" output status
  ENV_FILE="${fixture}"
  set +e
  output="$(assert_runtime_secret_key 2>&1)"
  status=$?
  set -e
  if [ "${want}" = 'pass' ] && [ "${status}" -ne 0 ]; then
    echo "ERROR: assert_runtime_secret_key rejected a valid key: ${output}" >&2
    exit 1
  fi
  if [ "${want}" = 'fail' ] && [ "${status}" -eq 0 ]; then
    echo "ERROR: assert_runtime_secret_key accepted an invalid key" >&2
    exit 1
  fi
  case "${output}" in
    *"${SECRET_SENTINEL}"*)
      echo "ERROR: assert_runtime_secret_key leaked the master key value" >&2
      exit 1
      ;;
  esac
}

VALID_B64="$(head -c 32 /dev/zero | base64)"
printf 'NODE_ENV=production\nHERTA_RUNTIME_SECRET_KEY=%s\n' "${VALID_B64}" > "${TMP_DIR}/env-valid-b64"
run_assert_case "${TMP_DIR}/env-valid-b64" pass

printf 'HERTA_RUNTIME_SECRET_KEY=%s\n' "$(printf '%064d' 0)" > "${TMP_DIR}/env-valid-hex"
run_assert_case "${TMP_DIR}/env-valid-hex" pass

printf 'NODE_ENV=production\n' > "${TMP_DIR}/env-missing"
run_assert_case "${TMP_DIR}/env-missing" fail

printf 'HERTA_RUNTIME_SECRET_KEY=\n' > "${TMP_DIR}/env-empty"
run_assert_case "${TMP_DIR}/env-empty" fail

printf 'HERTA_RUNTIME_SECRET_KEY=%s\n' "${SECRET_SENTINEL}" > "${TMP_DIR}/env-wrong-length"
run_assert_case "${TMP_DIR}/env-wrong-length" fail

# 復号すると32 bytesだが長さが4の倍数でないunpadded base64は
# resolveRuntimeSecretMasterKey() と同様に拒否する。
printf 'HERTA_RUNTIME_SECRET_KEY=%s\n' "${VALID_B64%=}" > "${TMP_DIR}/env-unpadded-b64"
run_assert_case "${TMP_DIR}/env-unpadded-b64" fail

echo "deploy common tests passed"