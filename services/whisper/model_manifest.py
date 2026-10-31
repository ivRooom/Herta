"""Offline local model integrity gate. Checked on every service startup."""
import hashlib
import json
from pathlib import Path

REPO_ID = "Systran/faster-whisper-tiny"
REVISION = "d90ca5fe260221311c53c58e660288d3deb8d356"
REQUIRED_FILES = ("config.json", "model.bin", "tokenizer.json", "vocabulary.txt")


def sha256_file(file: Path) -> str:
    digest = hashlib.sha256()
    with file.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_model_manifest(root: Path) -> None:
    manifest_path = root / "model-manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("repo") != REPO_ID or manifest.get("revision") != REVISION:
        raise RuntimeError("Unapproved Whisper model source or revision")
    if manifest.get("license") != "mit":
        raise RuntimeError("Whisper model license confirmation missing")
    files = manifest.get("sha256")
    if not isinstance(files, dict) or set(files) != set(REQUIRED_FILES):
        raise RuntimeError("Whisper model manifest is incomplete")
    for name in REQUIRED_FILES:
        source = root / name
        if source.is_symlink() or not source.is_file():
            raise RuntimeError("Invalid Whisper model file")
        if sha256_file(source) != files[name]:
            raise RuntimeError("Whisper model hash mismatch")
