#!/usr/bin/env python3
"""Read-only, fail-closed VC Recap restore erasure-fence reconciliation.

This is an acceptance helper, NOT an external erasure ledger or a replay worker.
The operator must obtain an independently persisted and authenticated ledger,
freeze all VC reads/writes, replay its fences into the restored database, and
then export the restored fences. A zero exit only checks those two snapshots.
It does not authorize restarting traffic or attest to S3/caches/backups.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

USER_ID = re.compile(r"^[0-9]{15,22}$")
SHA256 = re.compile(r"^[a-f0-9]{64}$")
UTC_TIMESTAMP = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$"
)
EXTERNAL_KIND = "vc-recap-independent-erasure-ledger-v1"
RESTORED_KIND = "vc-recap-restored-db-fences-v1"


class GateFailure(Exception):
    """Failure messages must never include user identifiers, S3 keys or secrets."""


def parse_time(value: Any) -> datetime:
    if not isinstance(value, str) or not UTC_TIMESTAMP.fullmatch(value):
        raise GateFailure("Invalid UTC timestamp")
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise GateFailure("Invalid UTC timestamp") from exc


def load_json(path: Path) -> tuple[dict[str, Any], bytes]:
    try:
        data = path.read_bytes()
        if not data or len(data) > 64 * 1024 * 1024:
            raise GateFailure("Snapshot size is invalid")
        value = json.loads(data)
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise GateFailure("Cannot read or parse a snapshot") from exc
    if not isinstance(value, dict):
        raise GateFailure("Snapshot document must be an object")
    return value, data


def read_entries(payload: dict[str, Any], kind: str) -> dict[str, datetime]:
    if set(payload) != ({"kind", "generatedAt", "entries"} if kind == EXTERNAL_KIND else {"kind", "entries"}):
        raise GateFailure("Snapshot schema mismatch")
    if payload.get("kind") != kind or not isinstance(payload.get("entries"), list):
        raise GateFailure("Snapshot kind or entries are invalid")
    entries: dict[str, datetime] = {}
    for item in payload["entries"]:
        if not isinstance(item, dict) or set(item) != {"userId", "requestedAt"}:
            raise GateFailure("Invalid erasure fence row")
        user_id = item["userId"]
        if not isinstance(user_id, str) or not USER_ID.fullmatch(user_id):
            raise GateFailure("Invalid erasure fence owner")
        if user_id in entries:
            raise GateFailure("Duplicate erasure fence owner")
        entries[user_id] = parse_time(item["requestedAt"])
    return entries


def verify(
    ledger_path: Path,
    restored_path: Path,
    expected_sha256: str,
    expected_count: int,
    allow_empty: bool = False,
    max_age_hours: int = 24,
    now: datetime | None = None,
) -> tuple[int, int]:
    if not SHA256.fullmatch(expected_sha256):
        raise GateFailure("An independently verified SHA256 digest is required")
    if expected_count < 0 or max_age_hours < 1 or max_age_hours > 168:
        raise GateFailure("Invalid review count or maximum snapshot age")

    ledger, raw = load_json(ledger_path)
    if hashlib.sha256(raw).hexdigest() != expected_sha256:
        raise GateFailure("External ledger checksum mismatch")
    snapshot, _ = load_json(restored_path)
    external = read_entries(ledger, EXTERNAL_KIND)
    restored = read_entries(snapshot, RESTORED_KIND)

    if len(external) != expected_count:
        raise GateFailure("External ledger count differs from independent audit")
    if not external and not allow_empty:
        raise GateFailure("An empty ledger requires a separate explicit approval")

    checked_at = now or datetime.now(timezone.utc)
    issued_at = parse_time(ledger["generatedAt"])
    if issued_at > checked_at or checked_at - issued_at > timedelta(hours=max_age_hours):
        raise GateFailure("External ledger snapshot is stale or from the future")
    if any(issued_at < requested or requested > checked_at for requested in external.values()):
        raise GateFailure("External ledger timestamps are inconsistent")

    # Never print keys, owner IDs, or timestamps from either input.
    if any(owner not in restored or restored[owner] < requested for owner, requested in external.items()):
        raise GateFailure("Restored database is missing an external erasure fence")
    return len(external), len(restored)


def main() -> int:
    parser = argparse.ArgumentParser(description="Offline VC Recap restore fence comparison; no AWS/DB writes")
    parser.add_argument("--external-ledger", type=Path, required=True)
    parser.add_argument("--restored-fences", type=Path, required=True)
    parser.add_argument("--external-sha256", required=True)
    parser.add_argument("--expected-count", type=int, required=True)
    parser.add_argument("--max-ledger-age-hours", type=int, default=24)
    parser.add_argument("--allow-empty-ledger", action="store_true")
    args = parser.parse_args()
    try:
        count, restored_count = verify(
            args.external_ledger,
            args.restored_fences,
            args.external_sha256,
            args.expected_count,
            args.allow_empty_ledger,
            args.max_ledger_age_hours,
        )
    except GateFailure as exc:
        print(f"NO-GO: {exc}. Keep all VC Recap serving and writing disabled.", file=sys.stderr)
        return 1
    print(
        f"MATCH ONLY: {count} independently audited deletion fences found among "
        f"{restored_count} restored rows. No authorization to resume service."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
