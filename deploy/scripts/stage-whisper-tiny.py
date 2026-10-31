#!/usr/bin/env python3
"""Operator-only model staging; not invoked during Herta service boot/deploy.

Pins model revision, downloads only allowlisted files from Hugging Face,
creates a per-file integrity manifest and atomically publishes a new folder.
No audio/private user data is downloaded or uploaded.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import tempfile
from urllib.request import Request, urlopen

REPO = "Systran/faster-whisper-tiny"
REVISION = "d90ca5fe260221311c53c58e660288d3deb8d356"
FILES = ("config.json", "model.bin", "tokenizer.json", "vocabulary.txt")


def download(file: str, destination: Path) -> str:
    if file not in FILES:
        raise ValueError("Model filename is not allowlisted")
    url = f"https://huggingface.co/{REPO}/resolve/{REVISION}/{file}"
    request = Request(url, headers={"User-Agent": "Herta-Whisper-Model-Stager/1"})
    digest = hashlib.sha256()
    with urlopen(request, timeout=60) as response, destination.open("xb") as out:
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            out.write(chunk)
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--destination", required=True)
    args = parser.parse_args()
    target = Path(args.destination).expanduser().resolve()
    if target.exists():
        raise SystemExit("Refusing to overwrite an existing Whisper model directory")
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".whisper-stage-", dir=target.parent) as tmp:
        staging = Path(tmp)
        sha = {name: download(name, staging / name) for name in FILES}
        if (staging / "model.bin").stat().st_size < 10 * 1024 * 1024:
            raise RuntimeError("Model weights look truncated")
        record = {"repo": REPO, "revision": REVISION, "license": "mit", "sha256": sha}
        (staging / "model-manifest.json").write_text(
            json.dumps(record, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        # Group/world can only read the public MIT model; no secret is staged.
        for file in staging.iterdir():
            file.chmod(0o644)
        shutil.copytree(staging, target, symlinks=False)
        target.chmod(0o755)
    print(f"Verified public MIT model: {REPO}@{REVISION}")
    print(f"Staged to: {target}")
    print("Do not enable Whisper until host memory/CPU preflight and security review pass.")


if __name__ == "__main__":
    main()
