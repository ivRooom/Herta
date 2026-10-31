#!/usr/bin/env bash
# Read-only host preflight. Never downloads a model, changes a service, or logs a secret.
set -euo pipefail

MODEL_DIR="${VC_RECAP_WHISPER_MODEL_DIR:-./var/whisper-model}"
if [[ ! -f "${MODEL_DIR}/model-manifest.json" ]] || [[ ! -s "${MODEL_DIR}/model.bin" ]]; then
  echo "BLOCKED: verified Whisper Tiny model/manifest missing" >&2
  exit 1
fi

# Verify all immutable model artifacts, not just the presence of model.bin.
# The sidecar repeats this integrity check at startup; refuse bad staging
# before any build/start command is attempted on production.
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PYTHONPATH="${repo_root}/services/whisper" python3 - "${MODEL_DIR}" <<'PY'
import sys
from pathlib import Path
from model_manifest import verify_model_manifest

verify_model_manifest(Path(sys.argv[1]))
PY

if [[ ! -f /proc/meminfo ]]; then
  echo "BLOCKED: only Linux hosts supported" >&2
  exit 1
fi

mem_kb="$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)"
if [[ -z "${mem_kb}" ]] || (( mem_kb < 1100 * 1024 )); then
  echo "BLOCKED: less than 1100 MiB currently available; cannot add a 1024MiB sidecar safely" >&2
  exit 1
fi

if [[ ! -e /var/lib/docker ]]; then
  echo "BLOCKED: docker data directory not present" >&2
  exit 1
fi

disk_free_kb="$(df -Pk /var/lib/docker | awk 'NR == 2 {print $4}')"
if [[ -z "${disk_free_kb}" ]] || (( disk_free_kb < 2 * 1024 * 1024 )); then
  echo "BLOCKED: need at least 2 GiB free Docker disk space before image build" >&2
  exit 1
fi

echo "Host memory and Docker disk headroom threshold satisfied (NOT a benchmark)."
echo "Inspect aggregate service RSS and disk space; never expose process environment/secrets:"
free -m
df -h /var/lib/docker
docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}'
echo "This preflight alone is not approval to enable voice processing."
