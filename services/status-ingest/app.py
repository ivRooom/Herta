#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import re
import signal
import sqlite3
import sys
import time
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

LOG = logging.getLogger("status-ingest")

OVERALL_STATUSES = {
    "operational",
    "degraded",
    "outage",
    "maintenance",
    "unknown",
}
CHECK_STATUSES = {
    "ok",
    "warning",
    "error",
    "not_configured",
    "unknown",
}
CHECK_KEYS = ("process", "discord", "database", "redis", "worker")
TOP_LEVEL_KEYS = {
    "schema_version",
    "service_id",
    "source",
    "observed_at",
    "sent_at",
    "status",
    "version",
    "checks",
}
NONCE_PATTERN = re.compile(r"^[0-9a-f]{32}$")
SIGNATURE_PATTERN = re.compile(r"^sha256=([0-9a-f]{64})$")
IDENTIFIER_PATTERN = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")
VERSION_PATTERN = re.compile(r"^[0-9A-Za-z][0-9A-Za-z._+~-]{0,63}$")


class ConfigurationError(ValueError):
    pass


class RequestError(ValueError):
    def __init__(self, status: HTTPStatus, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


@dataclass(frozen=True)
class Config:
    host: str
    port: int
    database_path: Path
    signing_secret: bytes
    allowed_service_id: str
    allowed_source: str
    timestamp_tolerance_seconds: int
    max_observation_age_seconds: int
    future_observation_tolerance_seconds: int
    nonce_retention_seconds: int
    observation_retention_days: int
    stale_after_seconds: int
    max_body_bytes: int
    cors_origin: str | None

    @classmethod
    def from_env(cls) -> "Config":
        host = os.getenv("STATUS_INGEST_HOST", "0.0.0.0")
        port = env_int("STATUS_INGEST_PORT", 8080, minimum=1, maximum=65535)
        database_path = Path(
            os.getenv("STATUS_DATABASE_PATH", "/data/status-ingest.sqlite3")
        )

        secret = os.getenv("STATUS_SIGNING_SECRET", "")
        if len(secret) < 32:
            raise ConfigurationError(
                "STATUS_SIGNING_SECRETは32文字以上の実値が必要です"
            )

        service_id = os.getenv("STATUS_ALLOWED_SERVICE_ID", "herta-discord-bot")
        source = os.getenv("STATUS_ALLOWED_SOURCE", "herta-production")
        for name, value in (
            ("STATUS_ALLOWED_SERVICE_ID", service_id),
            ("STATUS_ALLOWED_SOURCE", source),
        ):
            if not IDENTIFIER_PATTERN.fullmatch(value):
                raise ConfigurationError(f"{name}の形式が不正です")

        cors_origin = os.getenv("STATUS_PUBLIC_CORS_ORIGIN", "").strip() or None
        if cors_origin is not None:
            parsed = urlparse(cors_origin)
            if parsed.scheme != "https" or not parsed.netloc or parsed.path not in ("", "/"):
                raise ConfigurationError(
                    "STATUS_PUBLIC_CORS_ORIGINにはHTTPS Originを指定してください"
                )
            cors_origin = cors_origin.rstrip("/")

        return cls(
            host=host,
            port=port,
            database_path=database_path,
            signing_secret=secret.encode("utf-8"),
            allowed_service_id=service_id,
            allowed_source=source,
            timestamp_tolerance_seconds=env_int(
                "STATUS_TIMESTAMP_TOLERANCE_SECONDS", 300, minimum=30, maximum=3600
            ),
            max_observation_age_seconds=env_int(
                "STATUS_MAX_OBSERVATION_AGE_SECONDS", 600, minimum=30, maximum=86400
            ),
            future_observation_tolerance_seconds=env_int(
                "STATUS_FUTURE_OBSERVATION_TOLERANCE_SECONDS",
                60,
                minimum=0,
                maximum=600,
            ),
            nonce_retention_seconds=env_int(
                "STATUS_NONCE_RETENTION_SECONDS", 900, minimum=300, maximum=86400
            ),
            observation_retention_days=env_int(
                "STATUS_OBSERVATION_RETENTION_DAYS", 30, minimum=1, maximum=365
            ),
            stale_after_seconds=env_int(
                "STATUS_STALE_AFTER_SECONDS", 180, minimum=60, maximum=3600
            ),
            max_body_bytes=env_int(
                "STATUS_MAX_BODY_BYTES", 16384, minimum=1024, maximum=65536
            ),
            cors_origin=cors_origin,
        )


def env_int(name: str, default: int, *, minimum: int, maximum: int) -> int:
    raw = os.getenv(name, str(default))
    try:
        value = int(raw)
    except ValueError as error:
        raise ConfigurationError(f"{name}は整数で指定してください") from error
    if value < minimum or value > maximum:
        raise ConfigurationError(
            f"{name}は{minimum}以上{maximum}以下で指定してください"
        )
    return value


def utc_now() -> datetime:
    return datetime.now(UTC)


def format_rfc3339(value: datetime) -> str:
    return value.astimezone(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def parse_rfc3339(value: Any, field_name: str) -> datetime:
    if not isinstance(value, str) or not value:
        raise RequestError(
            HTTPStatus.UNPROCESSABLE_ENTITY,
            "invalid_payload",
            f"{field_name}が不正です",
        )
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise RequestError(
            HTTPStatus.UNPROCESSABLE_ENTITY,
            "invalid_payload",
            f"{field_name}が不正です",
        ) from error
    if parsed.tzinfo is None:
        raise RequestError(
            HTTPStatus.UNPROCESSABLE_ENTITY,
            "invalid_payload",
            f"{field_name}にはtimezoneが必要です",
        )
    return parsed.astimezone(UTC)


class StatusStore:
    def __init__(self, config: Config) -> None:
        self.config = config
        config.database_path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(
            self.config.database_path,
            timeout=5,
            isolation_level=None,
        )
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA busy_timeout = 5000")
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    def _initialize(self) -> None:
        with self.connect() as connection:
            connection.execute("PRAGMA journal_mode = WAL")
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS status_nonces (
                    nonce TEXT PRIMARY KEY,
                    received_at_epoch INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS status_observations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    request_id TEXT NOT NULL UNIQUE,
                    service_id TEXT NOT NULL,
                    source TEXT NOT NULL,
                    observed_at TEXT NOT NULL,
                    sent_at TEXT NOT NULL,
                    received_at TEXT NOT NULL,
                    received_at_epoch INTEGER NOT NULL,
                    status TEXT NOT NULL,
                    version TEXT,
                    process_status TEXT NOT NULL,
                    discord_status TEXT NOT NULL,
                    database_status TEXT NOT NULL,
                    redis_status TEXT NOT NULL,
                    worker_status TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS status_observations_service_received_idx
                ON status_observations(service_id, source, received_at_epoch DESC);

                CREATE TABLE IF NOT EXISTS latest_status (
                    service_id TEXT NOT NULL,
                    source TEXT NOT NULL,
                    observed_at TEXT NOT NULL,
                    sent_at TEXT NOT NULL,
                    received_at TEXT NOT NULL,
                    status TEXT NOT NULL,
                    version TEXT,
                    process_status TEXT NOT NULL,
                    discord_status TEXT NOT NULL,
                    database_status TEXT NOT NULL,
                    redis_status TEXT NOT NULL,
                    worker_status TEXT NOT NULL,
                    PRIMARY KEY(service_id, source)
                );
                """
            )

    def save_observation(
        self,
        *,
        nonce: str,
        request_id: str,
        payload: dict[str, Any],
        received_at: datetime,
    ) -> None:
        received_epoch = int(received_at.timestamp())
        nonce_cutoff = received_epoch - self.config.nonce_retention_seconds
        observation_cutoff = received_epoch - (
            self.config.observation_retention_days * 86400
        )
        checks = payload["checks"]

        with self.connect() as connection:
            try:
                connection.execute("BEGIN IMMEDIATE")
                connection.execute(
                    "DELETE FROM status_nonces WHERE received_at_epoch < ?",
                    (nonce_cutoff,),
                )
                connection.execute(
                    "DELETE FROM status_observations WHERE received_at_epoch < ?",
                    (observation_cutoff,),
                )
                connection.execute(
                    "INSERT INTO status_nonces(nonce, received_at_epoch) VALUES (?, ?)",
                    (nonce, received_epoch),
                )
                values = (
                    request_id,
                    payload["service_id"],
                    payload["source"],
                    payload["observed_at"],
                    payload["sent_at"],
                    format_rfc3339(received_at),
                    received_epoch,
                    payload["status"],
                    payload["version"],
                    checks["process"],
                    checks["discord"],
                    checks["database"],
                    checks["redis"],
                    checks["worker"],
                )
                connection.execute(
                    """
                    INSERT INTO status_observations(
                        request_id, service_id, source, observed_at, sent_at,
                        received_at, received_at_epoch, status, version,
                        process_status, discord_status, database_status,
                        redis_status, worker_status
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    values,
                )
                connection.execute(
                    """
                    INSERT INTO latest_status(
                        service_id, source, observed_at, sent_at, received_at,
                        status, version, process_status, discord_status,
                        database_status, redis_status, worker_status
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(service_id, source) DO UPDATE SET
                        observed_at = excluded.observed_at,
                        sent_at = excluded.sent_at,
                        received_at = excluded.received_at,
                        status = excluded.status,
                        version = excluded.version,
                        process_status = excluded.process_status,
                        discord_status = excluded.discord_status,
                        database_status = excluded.database_status,
                        redis_status = excluded.redis_status,
                        worker_status = excluded.worker_status
                    """,
                    (
                        payload["service_id"],
                        payload["source"],
                        payload["observed_at"],
                        payload["sent_at"],
                        format_rfc3339(received_at),
                        payload["status"],
                        payload["version"],
                        checks["process"],
                        checks["discord"],
                        checks["database"],
                        checks["redis"],
                        checks["worker"],
                    ),
                )
                connection.execute("COMMIT")
            except sqlite3.IntegrityError as error:
                connection.execute("ROLLBACK")
                if "status_nonces.nonce" in str(error):
                    raise RequestError(
                        HTTPStatus.CONFLICT,
                        "replayed_nonce",
                        "同じNonceは再利用できません",
                    ) from error
                raise
            except Exception:
                connection.execute("ROLLBACK")
                raise

    def latest(self) -> sqlite3.Row | None:
        with self.connect() as connection:
            return connection.execute(
                """
                SELECT * FROM latest_status
                WHERE service_id = ? AND source = ?
                """,
                (
                    self.config.allowed_service_id,
                    self.config.allowed_source,
                ),
            ).fetchone()

    def healthcheck(self) -> None:
        with self.connect() as connection:
            connection.execute("SELECT 1").fetchone()


class StatusServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address: tuple[str, int], config: Config, store: StatusStore):
        super().__init__(address, StatusHandler)
        self.config = config
        self.store = store


class StatusHandler(BaseHTTPRequestHandler):
    server: StatusServer
    protocol_version = "HTTP/1.1"

    def do_POST(self) -> None:  # noqa: N802
        self._handle_request(self._post)

    def do_GET(self) -> None:  # noqa: N802
        self._handle_request(self._get)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._handle_request(self._options)

    def log_message(self, format: str, *args: Any) -> None:
        return

    def _handle_request(self, callback: Any) -> None:
        started = time.monotonic()
        request_id = uuid.uuid4().hex
        status = HTTPStatus.INTERNAL_SERVER_ERROR
        try:
            status = callback(request_id)
        except RequestError as error:
            status = error.status
            self._send_json(
                status,
                {
                    "error": {
                        "code": error.code,
                        "message": error.message,
                        "request_id": request_id,
                    }
                },
            )
        except Exception:
            LOG.exception(
                "request_failed",
                extra={"request_id": request_id, "path": self.path},
            )
            self._send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {
                    "error": {
                        "code": "internal_error",
                        "message": "内部エラーが発生しました",
                        "request_id": request_id,
                    }
                },
            )
        finally:
            duration_ms = round((time.monotonic() - started) * 1000)
            LOG.info(
                json.dumps(
                    {
                        "event": "request_completed",
                        "request_id": request_id,
                        "method": self.command,
                        "path": self.path.split("?", 1)[0],
                        "status": int(status),
                        "duration_ms": duration_ms,
                    },
                    separators=(",", ":"),
                )
            )

    def _post(self, request_id: str) -> HTTPStatus:
        if self.path != "/v1/observations":
            raise RequestError(HTTPStatus.NOT_FOUND, "not_found", "Not Found")

        content_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip()
        if content_type != "application/json":
            raise RequestError(
                HTTPStatus.UNSUPPORTED_MEDIA_TYPE,
                "unsupported_media_type",
                "Content-Typeはapplication/jsonが必要です",
            )

        raw_length = self.headers.get("Content-Length")
        if raw_length is None:
            raise RequestError(
                HTTPStatus.LENGTH_REQUIRED,
                "content_length_required",
                "Content-Lengthが必要です",
            )
        try:
            content_length = int(raw_length)
        except ValueError as error:
            raise RequestError(
                HTTPStatus.BAD_REQUEST,
                "invalid_content_length",
                "Content-Lengthが不正です",
            ) from error
        if content_length <= 0 or content_length > self.server.config.max_body_bytes:
            raise RequestError(
                HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                "payload_too_large",
                "リクエスト本文が上限を超えています",
            )

        body = self.rfile.read(content_length)
        if len(body) != content_length:
            raise RequestError(
                HTTPStatus.BAD_REQUEST,
                "incomplete_body",
                "リクエスト本文が不完全です",
            )

        timestamp_text, nonce = self._verify_signature(body)
        payload = validate_payload(
            body,
            config=self.server.config,
            timestamp_text=timestamp_text,
        )
        received_at = utc_now()
        self.server.store.save_observation(
            nonce=nonce,
            request_id=request_id,
            payload=payload,
            received_at=received_at,
        )
        self._send_json(
            HTTPStatus.ACCEPTED,
            {
                "accepted": True,
                "request_id": request_id,
                "received_at": format_rfc3339(received_at),
            },
        )
        return HTTPStatus.ACCEPTED

    def _verify_signature(self, body: bytes) -> tuple[str, str]:
        version = self.headers.get("X-IVRM-Signature-Version", "")
        timestamp_text = self.headers.get("X-IVRM-Timestamp", "")
        nonce = self.headers.get("X-IVRM-Nonce", "")
        signature_text = self.headers.get("X-IVRM-Signature", "")

        signature_match = SIGNATURE_PATTERN.fullmatch(signature_text)
        if (
            version != "v1"
            or not NONCE_PATTERN.fullmatch(nonce)
            or signature_match is None
        ):
            raise RequestError(
                HTTPStatus.UNAUTHORIZED,
                "invalid_signature",
                "署名を検証できません",
            )

        timestamp = parse_rfc3339(timestamp_text, "X-IVRM-Timestamp")
        difference = abs((utc_now() - timestamp).total_seconds())
        if difference > self.server.config.timestamp_tolerance_seconds:
            raise RequestError(
                HTTPStatus.UNAUTHORIZED,
                "invalid_signature",
                "署名を検証できません",
            )

        canonical = timestamp_text.encode("ascii") + b"\n" + nonce.encode("ascii") + b"\n" + body
        expected = hmac.new(
            self.server.config.signing_secret,
            canonical,
            hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(expected, signature_match.group(1)):
            raise RequestError(
                HTTPStatus.UNAUTHORIZED,
                "invalid_signature",
                "署名を検証できません",
            )
        return timestamp_text, nonce

    def _get(self, request_id: str) -> HTTPStatus:
        path = self.path.split("?", 1)[0]
        if path in ("/healthz", "/readyz"):
            self.server.store.healthcheck()
            self._send_json(
                HTTPStatus.OK,
                {
                    "service": "ivrm-status-ingest",
                    "status": "ok",
                    "database": "ok",
                },
            )
            return HTTPStatus.OK

        if path not in ("/v1/status", "/api/status.json"):
            raise RequestError(HTTPStatus.NOT_FOUND, "not_found", "Not Found")

        row = self.server.store.latest()
        if row is None:
            payload = {
                "schema_version": 1,
                "service_id": self.server.config.allowed_service_id,
                "source": self.server.config.allowed_source,
                "status": "unknown",
                "reported_status": None,
                "version": None,
                "observed_at": None,
                "received_at": None,
                "checks": {key: "unknown" for key in CHECK_KEYS},
                "freshness": {
                    "stale": True,
                    "age_seconds": None,
                    "stale_after_seconds": self.server.config.stale_after_seconds,
                },
            }
        else:
            observed_at = parse_rfc3339(row["observed_at"], "observed_at")
            age_seconds = max(0, int((utc_now() - observed_at).total_seconds()))
            stale = age_seconds > self.server.config.stale_after_seconds
            payload = {
                "schema_version": 1,
                "service_id": row["service_id"],
                "source": row["source"],
                "status": "unknown" if stale else row["status"],
                "reported_status": row["status"],
                "version": row["version"],
                "observed_at": row["observed_at"],
                "received_at": row["received_at"],
                "checks": {
                    "process": row["process_status"],
                    "discord": row["discord_status"],
                    "database": row["database_status"],
                    "redis": row["redis_status"],
                    "worker": row["worker_status"],
                },
                "freshness": {
                    "stale": stale,
                    "age_seconds": age_seconds,
                    "stale_after_seconds": self.server.config.stale_after_seconds,
                },
            }

        self._send_json(HTTPStatus.OK, payload, public=True)
        return HTTPStatus.OK

    def _options(self, request_id: str) -> HTTPStatus:
        path = self.path.split("?", 1)[0]
        if path not in ("/v1/status", "/api/status.json"):
            raise RequestError(HTTPStatus.NOT_FOUND, "not_found", "Not Found")
        self.send_response(HTTPStatus.NO_CONTENT)
        self._send_common_headers(public=True)
        self.send_header("Content-Length", "0")
        self.end_headers()
        return HTTPStatus.NO_CONTENT

    def _send_json(
        self,
        status: HTTPStatus,
        payload: dict[str, Any],
        *,
        public: bool = False,
    ) -> None:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode(
            "utf-8"
        )
        self.send_response(status)
        self._send_common_headers(public=public)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_common_headers(self, *, public: bool) -> None:
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'none'")
        if public and self.server.config.cors_origin:
            self.send_header(
                "Access-Control-Allow-Origin", self.server.config.cors_origin
            )
            self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Vary", "Origin")


def validate_payload(
    body: bytes,
    *,
    config: Config,
    timestamp_text: str,
) -> dict[str, Any]:
    try:
        payload = json.loads(body)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RequestError(
            HTTPStatus.UNPROCESSABLE_ENTITY,
            "invalid_payload",
            "JSON形式が不正です",
        ) from error

    if not isinstance(payload, dict) or set(payload) != TOP_LEVEL_KEYS:
        raise RequestError(
            HTTPStatus.UNPROCESSABLE_ENTITY,
            "invalid_payload",
            "payload schemaが不正です",
        )
    if payload["schema_version"] != 1:
        raise RequestError(
            HTTPStatus.UNPROCESSABLE_ENTITY,
            "unsupported_schema",
            "schema_versionをサポートしていません",
        )
    if (
        payload["service_id"] != config.allowed_service_id
        or payload["source"] != config.allowed_source
    ):
        raise RequestError(
            HTTPStatus.FORBIDDEN,
            "service_not_allowed",
            "ServiceまたはSourceが許可されていません",
        )
    if payload["sent_at"] != timestamp_text:
        raise RequestError(
            HTTPStatus.UNPROCESSABLE_ENTITY,
            "invalid_payload",
            "sent_atと署名Timestampが一致しません",
        )
    if payload["status"] not in OVERALL_STATUSES:
        raise RequestError(
            HTTPStatus.UNPROCESSABLE_ENTITY,
            "invalid_payload",
            "statusが不正です",
        )

    version = payload["version"]
    if version is not None and (
        not isinstance(version, str) or not VERSION_PATTERN.fullmatch(version)
    ):
        raise RequestError(
            HTTPStatus.UNPROCESSABLE_ENTITY,
            "invalid_payload",
            "versionが不正です",
        )

    checks = payload["checks"]
    if not isinstance(checks, dict) or set(checks) != set(CHECK_KEYS):
        raise RequestError(
            HTTPStatus.UNPROCESSABLE_ENTITY,
            "invalid_payload",
            "checksが不正です",
        )
    if any(checks[key] not in CHECK_STATUSES for key in CHECK_KEYS):
        raise RequestError(
            HTTPStatus.UNPROCESSABLE_ENTITY,
            "invalid_payload",
            "check statusが不正です",
        )

    observed_at = parse_rfc3339(payload["observed_at"], "observed_at")
    now = utc_now()
    age = (now - observed_at).total_seconds()
    if age > config.max_observation_age_seconds:
        raise RequestError(
            HTTPStatus.UNPROCESSABLE_ENTITY,
            "stale_observation",
            "観測時刻が古すぎます",
        )
    if age < -config.future_observation_tolerance_seconds:
        raise RequestError(
            HTTPStatus.UNPROCESSABLE_ENTITY,
            "future_observation",
            "観測時刻が未来です",
        )

    parse_rfc3339(payload["sent_at"], "sent_at")
    return payload


def configure_logging() -> None:
    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(message)s",
        stream=sys.stdout,
    )


def main() -> int:
    configure_logging()
    try:
        config = Config.from_env()
        store = StatusStore(config)
    except (ConfigurationError, OSError, sqlite3.Error) as error:
        LOG.error("startup_failed: %s", error)
        return 2

    server = StatusServer((config.host, config.port), config, store)

    def shutdown(signum: int, frame: Any) -> None:
        LOG.info("shutdown_requested signal=%s", signum)
        server.shutdown()

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    LOG.info("status_ingest_started host=%s port=%s", config.host, config.port)
    try:
        server.serve_forever(poll_interval=0.5)
    finally:
        server.server_close()
        LOG.info("status_ingest_stopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
