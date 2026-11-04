"""Herta #675 sequential cutover core. No cloud/SQL/production CLI adapter.

Adapters must implement actual evidence collection and cancellation. This core
alone never authorizes a cutover. A timeout is not proof that remote work stopped.
"""
import asyncio
import hashlib
import json
import math
import os
import re
import time
from dataclasses import dataclass
from pathlib import Path


PHASES = ("capture", "transfer", "restore", "validate", "backup", "overlay", "start", "health")
GATES = {
    "capture": ("source_frozen", "source_custody", "inventory_pinned"),
    "transfer": ("version_pinned", "archive_verified"),
    "restore": ("restore_finished", "history_matched"),
    "validate": ("inventory_matched", "strict_acl", "durable_crud", "canary_removed", "crypto_verified"),
    "backup": ("target_custody", "independent_restore", "inventory_matched"),
    "overlay": ("fresh_freeze", "db_only_change", "original_preserved"),
    "start": ("migrator_accepted", "four_services_pg17"),
    "health": ("service_health", "discord_e2e", "monitoring"),
}
# Existing downstream helpers require strictly more than these remaining times.
MIN_REMAINING = {"transfer": 600, "restore": 360, "backup": 360}


class Stop(RuntimeError):
    pass


def require(value):
    if not value:
        raise Stop("cutover-admission-failed")


@dataclass(frozen=True)
class Stage:
    seconds: float
    # Measured rehearsal upper bound; missing/zero evidence cannot grant GO.
    measured_seconds: float
    evidence_sha256: str
    run: object


def admit(stages, *, frozen_seconds=720, recovery_seconds=60):
    require(set(stages) == set(PHASES))
    require(type(frozen_seconds) is int and 0 < frozen_seconds <= 720)
    # Actual Source Recovery needs >40 seconds; quiescence/claim must run first.
    require(type(recovery_seconds) is int and 60 <= recovery_seconds < frozen_seconds)
    elapsed = 0
    for phase in PHASES:
        stage = stages[phase]
        require(callable(stage.run))
        require(all(type(x) in (int, float) and math.isfinite(x) and x > 0
                    for x in (stage.seconds, stage.measured_seconds)))
        require(stage.measured_seconds <= stage.seconds)
        require(re.fullmatch(r"[0-9a-f]{64}", stage.evidence_sha256) is not None)
        require(frozen_seconds - elapsed > MIN_REMAINING.get(phase, 0))
        elapsed += stage.seconds
    require(elapsed + recovery_seconds < frozen_seconds)


class Journal:
    """New attempt only. Durable write-ahead events; never record adapter data."""
    def __init__(self, directory, approval_reference, image_sha):
        require(re.fullmatch(r"[0-9a-f]{40}", image_sha) is not None)
        require(isinstance(approval_reference, str) and 0 < len(approval_reference) <= 256)
        self.path = Path(directory)
        # Parent protection/ownership is an operator precondition. No reuse,
        # symlink following, or resume after an ambiguous prior attempt.
        self.path.mkdir(mode=0o700, exist_ok=False)
        if os.name == "posix":
            fd = os.open(self.path.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
        self.sequence = 0
        self.record("PREPARED", approval_sha256=hashlib.sha256(approval_reference.encode()).hexdigest(),
                    image_sha=image_sha)

    def record(self, event, **facts):
        require(re.fullmatch(r"[A-Z_]+", event) is not None)
        raw = json.dumps({"event": event, **facts}, sort_keys=True).encode()
        name = self.path / f"{self.sequence:04d}.json"
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
        fd = os.open(name, flags, 0o600)
        with os.fdopen(fd, "wb") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        # Linux operator directory durability. Windows production adapter must
        # supply its existing private ACL/write-through journal implementation.
        if os.name == "posix":
            fd = os.open(self.path, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
        self.sequence += 1


async def execute(stages, journal, *, freeze, authorize_start, claim_recovery,
                  quiesce_target, recover_source,
                  frozen_seconds=720, recovery_seconds=60, prepared_deadline=None, clock=time.monotonic):
    """All callbacks are async and must not block the event loop.

    freeze receives its own bounded deadline and returns the actual monotonic
    frozen_at plus positive evidence. Its implementation owns the remote
    watchdog: a lost controller must never leave Source stopped indefinitely.
    Caller must independently verify approval, pins, protected paths, current
    production version, remote watchdog and adapters before calling this core.
    An already-created PREPARED fence requires its conservatively mapped local
    prepared_deadline. Omitting it requires creation inside the freeze callback.
    Remote BOOTTIME values must never be compared to this host's monotonic clock.
    """
    admit(stages, frozen_seconds=frozen_seconds, recovery_seconds=recovery_seconds)
    require(all(callable(x) for x in (freeze, authorize_start, claim_recovery,
                                     quiesce_target, recover_source)))
    if prepared_deadline is not None:
        require(type(prepared_deadline) in (int, float) and math.isfinite(prepared_deadline)
                and prepared_deadline > clock())
    business_intent = False
    freeze_intent = False
    source_deadline = None
    try:
        journal.record("FREEZE_INTENT")
        before = clock()
        source_deadline = before + 360
        if prepared_deadline is not None:
            require(type(prepared_deadline) in (int, float) and math.isfinite(prepared_deadline))
            source_deadline = min(source_deadline, prepared_deadline)
        available = source_deadline - clock()
        require(available > 0)
        freeze_intent = True
        receipt = await asyncio.wait_for(freeze(source_deadline), timeout=available)
        now = clock()
        require(receipt.get("source_frozen") is True and receipt.get("watchdog_armed") is True)
        frozen_at = receipt.get("frozen_at")
        require(type(frozen_at) in (float, int) and math.isfinite(frozen_at)
                and before <= frozen_at <= now)
        end = frozen_at + frozen_seconds
        source_deadline = end
        journal.record("SOURCE_FROZEN")
        for index, phase in enumerate(PHASES):
            now = clock()
            remaining_work = sum(stages[p].seconds for p in PHASES[index:])
            require(end - now > remaining_work + recovery_seconds)
            require(end - now > MIN_REMAINING.get(phase, 0))
            stage = stages[phase]
            # Persist before sending any request that might start a writer.
            # A lost acknowledgement must never reopen the old Source.
            if phase == "start":
                business_intent = True
            journal.record(phase.upper() + "_INTENT")
            stage_end = min(now + stage.seconds, end - recovery_seconds)
            # Journal fsync can consume the stage budget. Do not dispatch an
            # effect after its deadline, even if the pre-journal clock was safe.
            available = stage_end - clock()
            require(available > 0)
            if phase == "start":
                ack = await asyncio.wait_for(authorize_start(stage_end), timeout=available)
                require(isinstance(ack, dict) and ack.get("source_start_fence_persisted") is True)
                available = stage_end - clock()
                require(available > 0)
            result = await asyncio.wait_for(stage.run(stage_end), timeout=available)
            require(clock() <= stage_end)
            require(isinstance(result, dict) and all(result.get(k) is True for k in GATES[phase]))
            journal.record(phase.upper() + "_ACCEPTED")
        journal.record("CUTOVER_ACCEPTED")
        return {"cutover_accepted": True, "retirement_accepted": False}
    except BaseException:
        # Cancellation/timeouts/journal faults all preserve the write boundary.
        # No adapter exception text or returned secrets are written to receipts.
        if business_intent:
            journal.record("RECONCILIATION_REQUIRED")
            return {"cutover_accepted": False, "reconciliation_required": True,
                    "source_restarted": False}
        if freeze_intent:
            try:
                # Source remote fence must be claimed before old env restoration
                # or recovery. It serializes this path against business start.
                require(source_deadline is not None)
                # Recovery stays inside the original Source deadline. A lost
                # freeze ACK retains the earlier PREPARED bound, never grants
                # a new 60-second window after that bound has expired.
                recovery_end = min(source_deadline, clock() + recovery_seconds)
                require(recovery_end - clock() > 45)
                claim_end = min(recovery_end - 41, clock() + 5)
                available = claim_end - clock()
                require(available > 0)
                claim = await asyncio.wait_for(claim_recovery(claim_end), timeout=available)
                require(isinstance(claim, dict) and claim.get("source_recovery_fence_persisted") is True)
                # Keep >40 seconds for the actual Source recovery adapter.
                # Quiescence receives the common absolute end so its nested
                # env rollback guards can verify the same Source deadline.
                available = recovery_end - clock() - 41
                require(available > 0)
                proof = await asyncio.wait_for(quiesce_target(recovery_end), timeout=available)
                require(isinstance(proof, dict) and all(proof.get(k) is True for k in
                    ("remote_operations_stopped", "target_clients_zero", "business_start_absent",
                     "original_environment_restored")))
                journal.record("SOURCE_RECOVERY_INTENT")
                available = recovery_end - clock()
                require(available > 40)
                restored = await asyncio.wait_for(recover_source(recovery_end), timeout=available)
                require(isinstance(restored, dict) and all(restored.get(k) is True for k in
                    ("four_services_pg16", "old_backup_active", "workflow_restored")))
                require(clock() < recovery_end)
                journal.record("SOURCE_RECOVERED")
                require(clock() < recovery_end)
                return {"cutover_accepted": False, "source_restarted": True}
            except BaseException:
                journal.record("RECOVERY_UNPROVEN")
        return {"cutover_accepted": False, "source_restarted": False,
                "manual_reconciliation_required": True}
