"""Offline staging checks: failures must never publish partial model files."""
import hashlib
import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

STAGER_PATH = Path(__file__).resolve().parents[2] / "deploy/scripts/stage-whisper-tiny.py"
SPEC = importlib.util.spec_from_file_location("herta_stage_whisper_tiny", STAGER_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Unable to load model staging script")
stager = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(stager)

from model_manifest import verify_model_manifest


class StagingTests(unittest.TestCase):
    def test_success_only_publishes_completed_model(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "model"
            visited = []

            def fake_download(filename: str, destination: Path) -> str:
                # No half-created final target should be observable mid-stage.
                self.assertFalse(target.exists())
                visited.append(filename)
                data = b"model" if filename != "model.bin" else b"x" * (11 * 1024 * 1024)
                destination.write_bytes(data)
                return hashlib.sha256(data).hexdigest()

            with patch.object(stager, "download", side_effect=fake_download):
                with patch.object(sys, "argv", ["stage-whisper-tiny.py", "--destination", str(target)]):
                    stager.main()
            self.assertEqual(tuple(visited), stager.FILES)
            # Synthetic assets deliberately differ from the production-approved
            # SHA256 set. Exercise the verifier with ONLY these fixture digests;
            # production startup must continue to require APPROVED_SHA256.
            fixture_sha256 = {
                name: hashlib.sha256(
                    b"x" * (11 * 1024 * 1024) if name == "model.bin" else b"model"
                ).hexdigest()
                for name in stager.FILES
            }
            verify_model_manifest(target, expected_sha256=fixture_sha256)
            with self.assertRaisesRegex(RuntimeError, "Whisper model hash mismatch"):
                verify_model_manifest(target)
            self.assertEqual(list(Path(tmp).glob(".whisper-stage-*")), [])

    def test_download_failure_never_publishes_partial_model(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "model"

            def failing_download(filename: str, destination: Path) -> str:
                destination.write_text("partial", encoding="utf-8")
                raise RuntimeError("synthetic download failed")

            with patch.object(stager, "download", side_effect=failing_download):
                with patch.object(sys, "argv", ["stage-whisper-tiny.py", "--destination", str(target)]):
                    with self.assertRaisesRegex(RuntimeError, "synthetic download failed"):
                        stager.main()
            self.assertFalse(target.exists())
            self.assertEqual(list(Path(tmp).glob(".whisper-stage-*")), [])


if __name__ == "__main__":
    unittest.main()
