from __future__ import annotations

import hashlib
import hmac
import http.client
import json
import os
import tempfile
import threading
import time
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from unittest.mock import patch

from status_ingest import (
    Config,
    ConfigurationError,
    StatusServer,
    StatusStore,
    format_rfc3339,
)


class StatusIngestTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.secret = b"test-signing-secret-0123456789abcdef"
        self.config = Config(
            host="127.0.0.1",
            port=0,
            database_path=Path(self.temp_dir.name) / "status.sqlite3",
            signing_secret=self.secret,
            allowed_service_id="herta-discord-bot",
            allowed_source="herta-production",
            timestamp_tolerance_seconds=300,
            max_observation_age_seconds=600,
            future_observation_tolerance_seconds=60,
            nonce_retention_seconds=900,
            observation_retention_days=30,
            stale_after_seconds=180,
            max_body_bytes=16384,
            cors_origin="https://stats.ivrm.jp",
        )
        self.store = StatusStore(self.config)
        self.server = StatusServer(("127.0.0.1", 0), self.config, self.store)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.port = self.server.server_address[1]

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.temp_dir.cleanup()

    def payload(self, *, timestamp: str | None = None) -> dict[str, Any]:
        timestamp = timestamp or format_rfc3339(datetime.now(UTC))
        return {
            "schema_version": 1,
            "service_id": "herta-discord-bot",
            "source": "herta-production",
            "observed_at": timestamp,
            "sent_at": timestamp,
            "status": "operational",
            "version": "0.1.0",
            "checks": {
                "process": "ok",
                "discord": "ok",
                "database": "ok",
                "redis": "ok",
                "worker": "ok",
            },
        }

    def signed_request(
        self,
        payload: dict[str, Any],
        *,
        nonce: str = "0123456789abcdef0123456789abcdef",
        secret: bytes | None = None,
        signature_timestamp: int | None = None,
    ) -> tuple[int, dict[str, Any]]:
        body = json.dumps(payload, separators=(",", ":")).encode()
        timestamp_text = str(signature_timestamp or int(time.time()))
        canonical = timestamp_text.encode() + b"\n" + nonce.encode() + b"\n" + body
        signature = hmac.new(secret or self.secret, canonical, hashlib.sha256).hexdigest()
        return self.request(
            "POST",
            "/v1/observations",
            body=body,
            headers={
                "Content-Type": "application/json",
                "X-IVRM-Signature-Version": "v1",
                "X-IVRM-Timestamp": timestamp_text,
                "X-IVRM-Nonce": nonce,
                "X-IVRM-Signature": f"sha256={signature}",
            },
        )

    def request(
        self,
        method: str,
        path: str,
        *,
        body: bytes | None = None,
        headers: dict[str, str] | None = None,
    ) -> tuple[int, dict[str, Any]]:
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=3)
        connection.request(method, path, body=body, headers=headers or {})
        response = connection.getresponse()
        raw = response.read()
        connection.close()
        return response.status, json.loads(raw) if raw else {}

    def test_accepts_agent_epoch_signature_and_returns_public_status(self) -> None:
        status, response = self.signed_request(self.payload())
        self.assertEqual(202, status)
        self.assertTrue(response["accepted"])
        self.assertNotIn("signature", json.dumps(response).lower())

        status, public = self.request("GET", "/api/status.json")
        self.assertEqual(200, status)
        self.assertEqual("operational", public["status"])
        self.assertEqual("operational", public["reported_status"])
        self.assertEqual("0.1.0", public["version"])
        self.assertEqual("ok", public["checks"]["discord"])
        self.assertFalse(public["freshness"]["stale"])
        self.assertNotIn("nonce", public)
        self.assertNotIn("request_id", public)

    def test_rejects_modified_body_with_invalid_signature(self) -> None:
        status, response = self.signed_request(
            self.payload(),
            secret=b"different-signing-secret-0123456789",
        )
        self.assertEqual(401, status)
        self.assertEqual("invalid_signature", response["error"]["code"])

    def test_rejects_rfc3339_signature_header_used_by_neither_agent_nor_contract(self) -> None:
        payload = self.payload()
        body = json.dumps(payload, separators=(",", ":")).encode()
        nonce = "0123456789abcdef0123456789abcdef"
        timestamp = payload["sent_at"]
        signature = hmac.new(
            self.secret,
            timestamp.encode() + b"\n" + nonce.encode() + b"\n" + body,
            hashlib.sha256,
        ).hexdigest()
        status, response = self.request(
            "POST",
            "/v1/observations",
            body=body,
            headers={
                "Content-Type": "application/json",
                "X-IVRM-Signature-Version": "v1",
                "X-IVRM-Timestamp": timestamp,
                "X-IVRM-Nonce": nonce,
                "X-IVRM-Signature": f"sha256={signature}",
            },
        )
        self.assertEqual(401, status)
        self.assertEqual("invalid_signature", response["error"]["code"])

    def test_rejects_replayed_nonce(self) -> None:
        payload = self.payload()
        first_status, _ = self.signed_request(payload)
        second_status, response = self.signed_request(payload)
        self.assertEqual(202, first_status)
        self.assertEqual(409, second_status)
        self.assertEqual("replayed_nonce", response["error"]["code"])

        with self.store.connect() as connection:
            count = connection.execute(
                "SELECT COUNT(*) FROM status_observations"
            ).fetchone()[0]
        self.assertEqual(1, count)

    def test_rejects_extra_payload_fields(self) -> None:
        payload = self.payload()
        payload["guild_count"] = 999
        status, response = self.signed_request(payload)
        self.assertEqual(422, status)
        self.assertEqual("invalid_payload", response["error"]["code"])

    def test_rejects_old_observation_with_current_signature(self) -> None:
        timestamp = format_rfc3339(datetime.now(UTC) - timedelta(hours=1))
        status, response = self.signed_request(self.payload(timestamp=timestamp))
        self.assertEqual(422, status)
        self.assertEqual("stale_observation", response["error"]["code"])

    def test_rejects_sent_at_far_from_signature_timestamp(self) -> None:
        timestamp = format_rfc3339(datetime.now(UTC) - timedelta(minutes=10))
        payload = self.payload(timestamp=timestamp)
        payload["observed_at"] = format_rfc3339(datetime.now(UTC))
        status, response = self.signed_request(payload)
        self.assertEqual(422, status)
        self.assertEqual("invalid_payload", response["error"]["code"])

    def test_stale_public_status_becomes_unknown(self) -> None:
        old_time = format_rfc3339(datetime.now(UTC) - timedelta(minutes=10))
        payload = self.payload(timestamp=old_time)
        self.store.save_observation(
            nonce="abcdefabcdefabcdefabcdefabcdefab",
            request_id="test-request",
            payload=payload,
            received_at=datetime.now(UTC) - timedelta(minutes=10),
        )

        status, public = self.request("GET", "/v1/status")
        self.assertEqual(200, status)
        self.assertEqual("unknown", public["status"])
        self.assertEqual("operational", public["reported_status"])
        self.assertTrue(public["freshness"]["stale"])

    def test_older_observation_does_not_replace_latest(self) -> None:
        now = datetime.now(UTC)
        latest_payload = self.payload(timestamp=format_rfc3339(now))
        old_payload = self.payload(timestamp=format_rfc3339(now - timedelta(minutes=1)))
        old_payload["status"] = "outage"
        self.store.save_observation(
            nonce="11111111111111111111111111111111",
            request_id="latest",
            payload=latest_payload,
            received_at=now,
        )
        self.store.save_observation(
            nonce="22222222222222222222222222222222",
            request_id="older",
            payload=old_payload,
            received_at=now + timedelta(seconds=1),
        )
        self.assertEqual("operational", self.store.latest()["status"])

    def test_returns_unknown_before_first_observation(self) -> None:
        status, public = self.request("GET", "/v1/status")
        self.assertEqual(200, status)
        self.assertEqual("unknown", public["status"])
        self.assertIsNone(public["observed_at"])
        self.assertTrue(public["freshness"]["stale"])

    def test_healthcheck_uses_database(self) -> None:
        status, response = self.request("GET", "/healthz")
        self.assertEqual(200, status)
        self.assertEqual("ok", response["status"])
        self.assertEqual("ok", response["database"])

    def test_database_does_not_store_raw_payload_or_signature(self) -> None:
        status, _ = self.signed_request(self.payload())
        self.assertEqual(202, status)
        with self.store.connect() as connection:
            columns = {
                row[1]
                for row in connection.execute(
                    "PRAGMA table_info(status_observations)"
                ).fetchall()
            }
        self.assertNotIn("raw_body", columns)
        self.assertNotIn("signature", columns)
        self.assertNotIn("secret", columns)

    def test_rejects_nonce_retention_shorter_than_full_signature_window(self) -> None:
        environment = {
            "STATUS_SIGNING_SECRET": "test-signing-secret-0123456789abcdef",
            "STATUS_TIMESTAMP_TOLERANCE_SECONDS": "600",
            "STATUS_NONCE_RETENTION_SECONDS": "900",
        }
        with patch.dict(os.environ, environment, clear=True):
            with self.assertRaises(ConfigurationError):
                Config.from_env()


if __name__ == "__main__":
    unittest.main()
