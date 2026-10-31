"""Offline local model integrity gate. Checked on every service startup."""
import hashlib
import json
from pathlib import Path

REPO_ID = "Systran/faster-whisper-tiny"
REVISION = "d90ca5fe260221311c53c58e660288d3deb8d356"
REQUIRED_FILES = ("config.json", "model.bin", "tokenizer.json", "vocabulary.txt")
APPROVED_SHA256 = {
    "config.json": "a73a28cdfe1c43ccc7202fa333d1f89c202477271407ae9a7f19afa52039cac8",
    "model.bin": "dcb76c6586fc06cbdac6dd21f14cfd129cc4cdd9dce19bf4ffa62e59cbe6e6d1",
    "tokenizer.json": "fb7b63191e9bb045082c79fd742a3106a12c99513ab30df4a0d47fa6cb6fd0ab",
    "vocabulary.txt": "34ce3fe1c5041027b3f8d42912270993f986dbc4bb34cf27f951e34a1e453913",
}



def sha256_file(file: Path) -> str:
    digest = hashlib.sha256()
    with file.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_model_manifest(root: Path, expected_sha256: dict | None = None) -> None:
    manifest_path = root / "model-manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("repo") != REPO_ID or manifest.get("revision") != REVISION:
        raise RuntimeError("Unapproved Whisper model source or revision")
    if manifest.get("license") != "mit":
        raise RuntimeError("Whisper model license confirmation missing")
    approved = APPROVED_SHA256 if expected_sha256 is None else expected_sha256
    files = manifest.get("sha256")
    if not isinstance(files, dict) or set(files) != set(REQUIRED_FILES):
        raise RuntimeError("Whisper model manifest is incomplete")
    for name in REQUIRED_FILES:
        source = root / name
        if source.is_symlink() or not source.is_file():
            raise RuntimeError("Invalid Whisper model file")
        if files[name] != approved.get(name) or sha256_file(source) != approved[name]:
            raise RuntimeError("Whisper model hash mismatch")
