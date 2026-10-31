import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

MODULE = Path(__file__).with_name("model-manifest.py")
spec = importlib.util.spec_from_file_location("model_manifest", MODULE)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ManifestTests(unittest.TestCase):
    def test_accepts_pinned_model_and_rejects_tampering(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            files = {}
            for name in module.REQUIRED_FILES:
                data = ("synthetic-" + name).encode("utf-8")
                (root / name).write_bytes(data)
                files[name] = hashlib.sha256(data).hexdigest()
            record = {
                "repo": module.REPO_ID,
                "revision": module.REVISION,
                "license": "mit",
                "sha256": files,
            }
            (root / "model-manifest.json").write_text(json.dumps(record), encoding="utf-8")
            module.verify_model_manifest(root)
            (root / "model.bin").write_bytes(b"tampered")
            with self.assertRaisesRegex(RuntimeError, "hash mismatch"):
                module.verify_model_manifest(root)

    def test_rejects_wrong_revision(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "model-manifest.json").write_text(
                json.dumps({"repo": module.REPO_ID, "revision": "main", "license": "mit"}),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(RuntimeError, "revision"):
                module.verify_model_manifest(root)


if __name__ == "__main__":
    unittest.main()
