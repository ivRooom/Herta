#!/usr/bin/env python3
"""Synthetic-only contract tests for read-only VC Recap restore release gate."""
import hashlib
import json
import runpy
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

SCRIPT = Path(__file__).with_name("verify-vc-recap-restore-fences.py")
verify = runpy.run_path(str(SCRIPT))["verify"]
OWNER = "123456789012345678"
OTHER = "123456789012345679"


def stamp(dt):
    return dt.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


class RestoreGateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.now = datetime.now(timezone.utc).replace(microsecond=0)
        self.issued = stamp(self.now)
        self.requested = stamp(self.now - timedelta(minutes=15))
        self.ledger = {
            "kind": "vc-recap-independent-erasure-ledger-v1",
            "generatedAt": self.issued,
            "entries": [{"userId": OWNER, "requestedAt": self.requested}],
        }
        self.restored = {
            "kind": "vc-recap-restored-db-fences-v1",
            "entries": [{"userId": OWNER, "requestedAt": self.requested}],
        }

    def write(self):
        ledger = self.root / "external.json"
        db = self.root / "restored.json"
        raw = json.dumps(self.ledger, sort_keys=True).encode("utf-8")
        ledger.write_bytes(raw)
        db.write_text(json.dumps(self.restored))
        return ledger, db, hashlib.sha256(raw).hexdigest()

    def check(self, expected_count=1, **kwargs):
        ledger, db, sha = self.write()
        return verify(ledger, db, sha, expected_count, now=self.now, **kwargs)

    def test_replayed_fences_pass_without_claiming_complete_erasure(self):
        self.assertEqual(self.check(), (1, 1))

    def test_missing_and_older_fences_fail_closed(self):
        self.restored["entries"] = []
        with self.assertRaisesRegex(Exception, "missing"):
            self.check()
        self.restored["entries"] = [{
            "userId": OWNER,
            "requestedAt": stamp(self.now - timedelta(days=2)),
        }]
        with self.assertRaisesRegex(Exception, "missing"):
            self.check()

    def test_current_or_newer_restored_fence_is_acceptable(self):
        self.restored["entries"][0]["requestedAt"] = stamp(self.now)
        self.assertEqual(self.check(), (1, 1))

    def test_duplicate_and_invalid_user_ids_are_rejected(self):
        self.ledger["entries"].append(dict(self.ledger["entries"][0]))
        with self.assertRaisesRegex(Exception, "Duplicate"):
            self.check(expected_count=2)
        self.ledger["entries"] = [{"userId": "../../owner", "requestedAt": self.requested}]
        with self.assertRaisesRegex(Exception, "owner"):
            self.check()

    def test_stale_or_future_ledger_is_rejected(self):
        self.ledger["generatedAt"] = stamp(self.now - timedelta(days=3))
        with self.assertRaisesRegex(Exception, "stale"):
            self.check()
        self.ledger["generatedAt"] = stamp(self.now + timedelta(minutes=1))
        with self.assertRaisesRegex(Exception, "future"):
            self.check()

    def test_checksum_mismatch_and_independent_count_mismatch_are_rejected(self):
        ledger, db, _ = self.write()
        with self.assertRaisesRegex(Exception, "checksum"):
            verify(ledger, db, "0" * 64, 1, now=self.now)
        with self.assertRaisesRegex(Exception, "count"):
            self.check(expected_count=2)

    def test_empty_ledger_requires_explicit_operator_acknowledgment(self):
        self.ledger["entries"] = []
        self.restored["entries"] = []
        with self.assertRaisesRegex(Exception, "empty"):
            self.check(expected_count=0)
        self.assertEqual(self.check(expected_count=0, allow_empty=True), (0, 0))

    def test_future_fence_is_not_accepted(self):
        self.ledger["entries"][0]["requestedAt"] = stamp(self.now + timedelta(seconds=2))
        with self.assertRaisesRegex(Exception, "inconsistent"):
            self.check()

    def test_future_restored_fence_is_denied_even_when_external_request_is_older(self):
        self.restored["entries"][0]["requestedAt"] = stamp(self.now + timedelta(minutes=1))
        with self.assertRaisesRegex(Exception, "after the check"):
            self.check()

    def test_oversized_snapshot_is_rejected_before_unsafe_full_read(self):
        ledger, db, _ = self.write()
        with ledger.open("wb") as out:
            out.seek(64 * 1024 * 1024)
            out.write(b"x")
        with self.assertRaisesRegex(Exception, "size is invalid"):
            verify(ledger, db, "0" * 64, 1, now=self.now)

    def test_malformed_restored_records_fail_closed(self):
        self.restored["entries"] = [{"userId": OTHER, "requestedAt": "wrong"}]
        with self.assertRaisesRegex(Exception, "timestamp"):
            self.check()
        self.restored["entries"] = [{"userId": OWNER, "requestedAt": self.requested,
                                     "unrecognized": True}]
        with self.assertRaisesRegex(Exception, "row"):
            self.check()

    def test_cli_fails_without_inputs_and_never_prints_identifiers(self):
        ledger, db, sha = self.write()
        success = subprocess.run([
            sys.executable, str(SCRIPT), "--external-ledger", str(ledger),
            "--restored-fences", str(db), "--external-sha256", sha,
            "--expected-count", "1"
        ], text=True, capture_output=True, check=False)
        self.assertEqual(success.returncode, 0)
        self.assertNotIn(OWNER, success.stdout + success.stderr)
        self.restored["entries"] = []
        ledger, db, sha = self.write()
        denied = subprocess.run([
            sys.executable, str(SCRIPT), "--external-ledger", str(ledger),
            "--restored-fences", str(db), "--external-sha256", sha,
            "--expected-count", "1"
        ], text=True, capture_output=True, check=False)
        self.assertNotEqual(denied.returncode, 0)
        self.assertIn("NO-GO", denied.stderr)
        self.assertNotIn(OWNER, denied.stdout + denied.stderr)


if __name__ == "__main__":
    unittest.main()
