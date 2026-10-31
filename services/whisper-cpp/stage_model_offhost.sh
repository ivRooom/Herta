#!/usr/bin/env bash
# Operator only. Download an immutable public GGML model OFF the production
# server. Never invoked by Compose, the bot, or any deploy/build lifecycle.
set -euo pipefail
if [[ $# -ne 1 || -z "$1" ]]; then
  echo "Usage: $0 <new-local-model-directory> (in controlled off-host environment)" >&2
  exit 2
fi
repo="ggerganov/whisper.cpp"
revision="5359861c739e955e79d9a303bcbc70fb988958b1"
expected="be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21"
target="$1"
if [[ -e "$target" || -L "$target" ]]; then
  echo "Refusing to overwrite existing model directory" >&2
  exit 1
fi
parent="$(dirname "$target")"
mkdir -p "$parent"
parent="$(cd "$parent" && pwd -P)"
target="$parent/$(basename "$target")"
stage="$(mktemp -d "$parent/.whispercpp-XXXXXXXX")"
trap 'rm -rf -- "$stage"' EXIT
curl --fail --location --retry 3 --connect-timeout 10 --max-time 600 \
  "https://huggingface.co/${repo}/resolve/${revision}/ggml-tiny.bin" \
  --output "$stage/ggml-tiny.bin"
printf '%s  %s\n' "$expected" "$stage/ggml-tiny.bin" | sha256sum --check --strict -
chmod 0755 "$stage"
chmod 0644 "$stage/ggml-tiny.bin"
# Both paths are in the same parent filesystem, so rename is atomic.
mv -T -- "$stage" "$target"
echo "Pinned GGML tiny model staged in controlled environment: $target"
echo "Transfer this verified file via private channel; re-run SHA256 verification on host."
echo "Never mount/start without host memory, security scan, consent and E2E approval."
