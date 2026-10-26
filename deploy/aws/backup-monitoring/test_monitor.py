"""Network-free tests of the exact Lambda source embedded in CloudFormation."""
import base64
import contextlib
import copy
from datetime import datetime, timedelta, timezone
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch


TEMPLATE = Path(__file__).with_name("template.yml")
CAPTURE = "20261026T000000Z-00000000-0000-0000-0000-000000000000"
KEY = f"postgresql/{CAPTURE}/manifest.json"
DATABASES = ["herta", "ivrm_web", "ivrm_dashboard", "ivrm_ai"]


def inline_source():
    lines = TEMPLATE.read_text(encoding="utf-8").splitlines()
    start = lines.index("        ZipFile: |") + 1
    result = []
    for line in lines[start:]:
        if line and not line.startswith("          "):
            break
        result.append(line[10:] if line else "")
    return "\n".join(result)


class LegacyS3:
    def __init__(self, latest):
        self.latest = latest

    def get_paginator(self, operation):
        assert operation == "list_objects_v2"
        return types.SimpleNamespace(paginate=lambda **kwargs: iter([
            {"Contents": [] if self.latest is None else [self.latest]}
        ]))


class DedicatedS3:
    def __init__(self, clock):
        self.clock = clock
        self.listing_calls = []
        self.get_calls = []
        self.list_error = None
        self.get_error = None
        self.version = "fixture-manifest-version"
        self.checksum_override = None
        self.body = None
        self.manifest = {
            "format_version": 1,
            "capture_id": CAPTURE,
            "completed_at": clock.isoformat(),
            "server_version_num": 170011,
            "databases": DATABASES,
            "files": [{"name": name, "bytes": 100, "sha256": "a" * 64, "version_id": "fixture-version"}
                      for name in [f"{database}.dump" for database in DATABASES] + ["roles.sql"]],
        }
        self.listing = {"Contents": [{"Key": KEY, "Size": 1, "LastModified": clock}]}

    def payload(self):
        if isinstance(self.manifest, bytes):
            return self.manifest
        return json.dumps(self.manifest).encode()

    def list_objects_v2(self, **kwargs):
        self.listing_calls.append(kwargs)
        if self.list_error:
            raise self.list_error
        listing = copy.deepcopy(self.listing)
        for item in listing.get("Contents", []):
            if item["Key"] == KEY:
                item["Size"] = len(self.payload())
        return listing

    def get_object(self, **kwargs):
        self.get_calls.append(kwargs)
        if self.get_error:
            raise self.get_error
        payload = self.payload()
        self.body = io.BytesIO(payload)
        return {"Body": self.body, "ContentLength": len(payload), "VersionId": self.version,
                "ChecksumSHA256": self.checksum_override or base64.b64encode(hashlib.sha256(payload).digest()).decode()}


class SNS:
    def __init__(self):
        self.messages = []
        self.error = None

    def publish(self, **kwargs):
        if self.error:
            raise self.error
        self.messages.append(kwargs)
        return {"MessageId": "fixture-message"}


class MonitorTests(unittest.TestCase):
    def setUp(self):
        self.clock = datetime.now(timezone.utc)
        self.legacy = LegacyS3({"Key": "postgres/legacy.dump", "LastModified": self.clock})
        self.dedicated = DedicatedS3(self.clock)
        self.sns = SNS()
        self.metrics = []
        self.dedicated_client_config = None

    def load(self, enabled=True):
        def client(name, **kwargs):
            if name == "s3":
                if "config" in kwargs:
                    self.dedicated_client_config = kwargs["config"]
                return self.dedicated if "config" in kwargs else self.legacy
            if name == "sns":
                return self.sns
            if name == "cloudwatch":
                return types.SimpleNamespace(put_metric_data=lambda **args: self.metrics.append(args))
            raise AssertionError("unexpected service")

        boto = types.ModuleType("boto3")
        boto.client = client
        botocore = types.ModuleType("botocore")
        config = types.ModuleType("botocore.config")
        config.Config = lambda **kwargs: kwargs
        environment = {"S3_BUCKET": "fixture-legacy-bucket", "SNS_TOPIC_ARN": "fixture-topic",
                       "DEDICATED_BACKUP_EXPECTED_OWNER": "000000000000",
                       "DEDICATED_BACKUP_BUCKET": "fixture-dedicated-bucket" if enabled else ""}
        namespace = {}
        with patch.dict(sys.modules, {"boto3": boto, "botocore": botocore, "botocore.config": config}), patch.dict(os.environ, environment):
            exec(compile(inline_source(), str(TEMPLATE), "exec"), namespace)
        return namespace

    def invoke(self, enabled=True, event=None):
        with contextlib.redirect_stdout(io.StringIO()):
            return self.load(enabled)["lambda_handler"](event or {}, types.SimpleNamespace(function_name="fixture-function"))

    def assert_dedicated_alert(self):
        result = self.invoke()
        self.assertEqual(result["status"], "alert")
        self.assertEqual(result["dedicated_backup"]["status"], "alert")
        message = self.sns.messages[0]
        self.assertEqual(json.loads(message["Message"]), {
            "status": "alert", "component": "dedicated_postgresql_backup", "reason": "capture_check_failed", "version": 1})
        self.assertNotIn("fixture-dedicated", message["Message"])
        return result

    def test_disabled_preserves_legacy_success_and_metrics(self):
        result = self.invoke(False)
        self.assertEqual(result["status"], "ok")
        self.assertNotIn("dedicated_backup", result)
        self.assertEqual(self.dedicated.listing_calls, [])
        self.assertEqual(self.sns.messages, [])
        self.assertEqual(len(self.metrics), 1)
        self.assertEqual([m["MetricName"] for m in self.metrics[0]["MetricData"]], ["BackupFound", "FreshnessOk", "LatestBackupAgeHours"])

    def test_disabled_preserves_missing_stale_and_force_alert(self):
        self.legacy.latest = None
        self.assertEqual(self.invoke(False)["reason"], "no_backup")
        self.legacy.latest = {"Key": "postgres/legacy.dump", "LastModified": self.clock - timedelta(hours=26)}
        self.assertEqual(self.invoke(False)["reason"], "stale_backup")
        self.legacy.latest["LastModified"] = self.clock
        self.assertEqual(self.invoke(False, {"force_alert": True})["status"], "test_alert")
        self.assertEqual(self.dedicated.listing_calls, [])

    def test_fresh_complete_capture_and_bounded_requests(self):
        result = self.invoke()
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["dedicated_backup"], {"status": "ok"})
        self.assertEqual(self.dedicated.listing_calls[0]["MaxKeys"], 1000)
        self.assertEqual(self.dedicated.listing_calls[0]["ExpectedBucketOwner"], "000000000000")
        self.assertEqual(self.dedicated.listing_calls[0]["Prefix"], "postgresql/")
        self.assertEqual(self.dedicated.get_calls[0]["ChecksumMode"], "ENABLED")
        self.assertEqual(self.dedicated.get_calls[0]["ExpectedBucketOwner"], "000000000000")
        self.assertEqual(self.dedicated_client_config, {
            "connect_timeout": 2, "read_timeout": 2,
            "retries": {"mode": "standard", "total_max_attempts": 1}})
        self.assertTrue(self.dedicated.body.closed)
        self.assertEqual(self.sns.messages, [])
        self.assertEqual(len(self.metrics), 1)

    def test_dedicated_checked_even_when_legacy_missing_or_stale(self):
        for latest in (None, {"Key": "postgres/legacy.dump", "LastModified": self.clock - timedelta(hours=26)}):
            with self.subTest(latest=latest):
                self.legacy.latest = latest
                self.dedicated.listing_calls.clear()
                self.assertEqual(self.invoke()["dedicated_backup"]["status"], "ok")
                self.assertEqual(len(self.dedicated.listing_calls), 1)

    def test_missing_and_incomplete_latest_dump_not_healthy(self):
        self.dedicated.listing = {"Contents": [{"Key": f"postgresql/{CAPTURE}/ivrm_ai.dump", "Size": 100, "LastModified": self.clock}]}
        self.assert_dedicated_alert()

    def test_stale_and_future_object_rejected(self):
        for delta in (-26 * 3600, 600):
            with self.subTest(delta=delta):
                self.dedicated.listing["Contents"][0]["LastModified"] = self.clock + timedelta(seconds=delta)
                self.assert_dedicated_alert()

    def test_incomplete_duplicate_wrong_header_and_payload_rejected(self):
        original = copy.deepcopy(self.dedicated.manifest)
        changes = [lambda m: m["files"].pop(),
                   lambda m: m["files"].append(m["files"][0]),
                   lambda m: m.update(databases=["ivrm_ai"]),
                   lambda m: m.update(capture_id="other"),
                   lambda m: m.update(server_version_num=160000),
                   lambda m: m["files"][0].update(bytes=128 * 1024 * 1024 + 1),
                   lambda m: m["files"][0].update(sha256="invalid"),
                   lambda m: m["files"][0].update(version_id="null")]
        for change in changes:
            with self.subTest(change=change):
                self.dedicated.manifest = copy.deepcopy(original)
                change(self.dedicated.manifest)
                self.assert_dedicated_alert()

    def test_stale_future_or_naive_completion_rejected(self):
        for completed in ((self.clock - timedelta(hours=26)).isoformat(),
                          (self.clock + timedelta(minutes=10)).isoformat(), "2026-01-01T00:00:00"):
            with self.subTest(completed=completed):
                self.dedicated.manifest["completed_at"] = completed
                self.assert_dedicated_alert()

    def test_bad_checksum_and_missing_version_rejected(self):
        self.dedicated.checksum_override = "invalid"
        self.assert_dedicated_alert()
        self.dedicated.checksum_override = None
        self.dedicated.version = "null"
        self.assert_dedicated_alert()

    def test_malformed_or_oversize_manifest_rejected(self):
        for payload in (b"not-json", b"x" * 65537):
            with self.subTest(payload_size=len(payload)):
                self.dedicated.manifest = payload
                self.assert_dedicated_alert()

    def test_paginated_listing_fails_closed(self):
        self.dedicated.listing["IsTruncated"] = True
        self.assert_dedicated_alert()
        self.assertEqual(self.dedicated.get_calls, [])

    def test_sdk_failure_does_not_leak_or_become_healthy(self):
        for attribute in ("list_error", "get_error"):
            with self.subTest(attribute=attribute):
                setattr(self.dedicated, attribute, RuntimeError("private-provider-detail"))
                self.assert_dedicated_alert()
                self.assertNotIn("private-provider-detail", self.sns.messages[-1]["Message"])
                setattr(self.dedicated, attribute, None)

    def test_notification_failure_propagates(self):
        self.dedicated.list_error = RuntimeError("private-provider-detail")
        self.sns.error = RuntimeError("fixture delivery failure")
        with self.assertRaisesRegex(RuntimeError, "fixture delivery failure"):
            self.invoke()

    def test_dedicated_alert_overrides_legacy_force_alert_status(self):
        self.dedicated.listing = {"Contents": []}
        self.assertEqual(self.invoke(event={"force_alert": True})["status"], "alert")


if __name__ == "__main__":
    unittest.main()
