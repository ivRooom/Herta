"""Failure injection for #675. Synthetic adapters only; no cloud or DB."""
import asyncio
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("controller", Path(__file__).with_name("pg17-cutover-controller.py"))
import sys
sys.dont_write_bytecode = True
c = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = c
spec.loader.exec_module(c)


class Harness:
    def __init__(self, directory):
        self.now = 1000.0
        self.calls = []
        self.failure = None
        self.drift = None
        self.proof = True
        self.journal = c.Journal(Path(directory) / "attempt", "synthetic-approval", "a" * 40)
        budgets = (60, 40, 70, 40, 100, 20, 40, 30)
        self.stages = {}
        for phase, seconds in zip(c.PHASES, budgets):
            async def run(deadline, phase=phase):
                self.calls.append(phase)
                # Write-ahead must exist before any adapter invocation.
                event = json.loads(sorted(self.journal.path.glob("*.json"))[-1].read_bytes())
                assert event["event"] == phase.upper() + "_INTENT"
                if self.failure == phase:
                    raise RuntimeError("private-exception-must-not-be-logged")
                if self.drift == phase:
                    self.now = deadline + 1
                return {key: True for key in c.GATES[phase]}
            self.stages[phase] = c.Stage(seconds, seconds / 2, "b" * 64, run)

    async def freeze(self, deadline):
        self.calls.append("freeze")
        return {"source_frozen": True, "watchdog_armed": True, "frozen_at": self.now}

    async def quiesce(self, deadline):
        self.calls.append("quiesce")
        return {key: self.proof for key in ("remote_operations_stopped", "target_clients_zero",
            "business_start_absent", "original_environment_restored")}

    async def authorize_start(self, deadline):
        self.calls.append("start_fence")
        return {"source_start_fence_persisted": True}

    async def claim_recovery(self, deadline):
        self.calls.append("recovery_fence")
        return {"source_recovery_fence_persisted": True}

    async def recover(self, deadline):
        self.calls.append("recover")
        return {key: True for key in ("four_services_pg16", "old_backup_active", "workflow_restored")}

    def execute(self, **kwargs):
        return asyncio.run(c.execute(self.stages, self.journal, freeze=self.freeze,
            authorize_start=self.authorize_start, claim_recovery=self.claim_recovery,
            quiesce_target=self.quiesce, recover_source=self.recover, clock=lambda: self.now, **kwargs))


class ControllerTests(unittest.TestCase):
    def test_invalid_prepared_deadline_never_invokes_any_adapter(self):
        for value in (float('nan'), 999, True, 'invalid'):
            with self.subTest(value=value), tempfile.TemporaryDirectory() as directory:
                h = Harness(directory)
                with self.assertRaises(c.Stop):
                    h.execute(prepared_deadline=value)
                self.assertEqual(h.calls, [])

    def test_existing_prepared_fence_uses_earlier_mapped_deadline(self):
        with tempfile.TemporaryDirectory() as directory:
            h = Harness(directory)
            async def lost(deadline):
                self.assertEqual(deadline, 1010)
                h.now = 1011
                raise ConnectionError('synthetic-lost-existing-freeze')
            h.freeze = lost
            result = h.execute(prepared_deadline=1010)
            self.assertFalse(result['source_restarted'])
            self.assertNotIn('recovery_fence', h.calls)

    def test_recovery_receives_more_than_40_seconds_inside_source_deadline(self):
        with tempfile.TemporaryDirectory() as directory:
            h = Harness(directory)
            h.failure = 'restore'
            async def claim(deadline):
                self.assertLessEqual(deadline, h.now + 5)
                h.now += 2
                return {'source_recovery_fence_persisted': True}
            async def quiesce(deadline):
                self.assertEqual(deadline, 1060)
                h.now += 5
                return dict.fromkeys(('remote_operations_stopped', 'target_clients_zero',
                    'business_start_absent', 'original_environment_restored'), True)
            async def recover(deadline):
                self.assertGreater(deadline-h.now, 40)
                self.assertLessEqual(deadline, 1720)
                h.now += 41
                return dict.fromkeys(('four_services_pg16', 'old_backup_active', 'workflow_restored'), True)
            h.claim_recovery, h.quiesce, h.recover = claim, quiesce, recover
            self.assertTrue(h.execute()['source_restarted'])

    def test_expired_source_deadline_never_extends_recovery(self):
        with tempfile.TemporaryDirectory() as directory:
            h = Harness(directory)
            async def late(deadline):
                h.now = 1721
                raise RuntimeError('synthetic-late-restore')
            old = h.stages['restore']
            h.stages['restore'] = c.Stage(old.seconds, old.measured_seconds, old.evidence_sha256, late)
            result = h.execute()
            self.assertFalse(result['source_restarted'])
            self.assertNotIn('recovery_fence', h.calls)
            self.assertNotIn('recover', h.calls)

    def test_slow_quiescence_cannot_consume_source_recovery_reserve(self):
        with tempfile.TemporaryDirectory() as directory:
            h = Harness(directory)
            h.failure = 'restore'
            original = h.quiesce
            async def slow(deadline):
                result = await original(deadline)
                h.now = deadline - 40
                return result
            h.quiesce = slow
            self.assertFalse(h.execute()['source_restarted'])
            self.assertNotIn('recover', h.calls)

    def test_lost_freeze_ack_after_prepared_deadline_never_recovers(self):
        with tempfile.TemporaryDirectory() as directory:
            h = Harness(directory)
            async def lost(deadline):
                h.now = deadline + 1
                raise ConnectionError('synthetic-late-freeze-ack')
            h.freeze = lost
            self.assertFalse(h.execute()['source_restarted'])
            self.assertNotIn('recovery_fence', h.calls)

    def test_slow_recovery_journal_never_dispatches_with_insufficient_time(self):
        with tempfile.TemporaryDirectory() as directory:
            h = Harness(directory)
            h.failure = 'restore'
            original = h.journal.record
            def slow(event, **facts):
                original(event, **facts)
                if event == 'SOURCE_RECOVERY_INTENT':
                    h.now += 21
            h.journal.record = slow
            self.assertFalse(h.execute()['source_restarted'])
            self.assertNotIn('recover', h.calls)

    def test_missing_phase_never_freezes(self):
        for missing in c.PHASES:
            with self.subTest(missing=missing), tempfile.TemporaryDirectory() as directory:
                h = Harness(directory)
                del h.stages[missing]
                with self.assertRaises(c.Stop):
                    h.execute()
                self.assertEqual(h.calls, [])

    def test_guard_conflicting_budget_never_freezes(self):
        with tempfile.TemporaryDirectory() as directory:
            h = Harness(directory)
            h.stages["capture"] = c.Stage(121, 100, "b" * 64, h.stages["capture"].run)
            with self.assertRaises(c.Stop):
                h.execute()
            self.assertEqual(h.calls, [])

    def test_no_measurement_or_invalid_evidence_never_freezes(self):
        for measured, digest in ((0, "b" * 64), (61, "b" * 64), (1, "not-a-pin"), (float("nan"), "b" * 64)):
            with self.subTest(measured=measured, digest=digest), tempfile.TemporaryDirectory() as directory:
                h = Harness(directory)
                h.stages["capture"] = c.Stage(60, measured, digest, h.stages["capture"].run)
                with self.assertRaises(c.Stop):
                    h.execute()
                self.assertEqual(h.calls, [])

    def test_every_pre_writer_failure_recovers_only_after_quiesce(self):
        for phase in c.PHASES[:6]:
            with self.subTest(phase=phase), tempfile.TemporaryDirectory() as directory:
                h = Harness(directory)
                h.failure = phase
                result = h.execute()
                self.assertTrue(result["source_restarted"])
                self.assertEqual(h.calls[-2:], ["quiesce", "recover"])
                self.assertNotIn("start", h.calls)
                self.assertNotIn("private-exception", "".join(p.read_text() for p in h.journal.path.glob("*.json")))

    def test_unknown_start_and_health_failure_never_reopen_source(self):
        for phase in ("start", "health"):
            with self.subTest(phase=phase), tempfile.TemporaryDirectory() as directory:
                h = Harness(directory)
                h.failure = phase
                result = h.execute()
                self.assertTrue(result["reconciliation_required"])
                self.assertNotIn("recover", h.calls)
                self.assertNotIn("quiesce", h.calls)

    def test_timeout_is_not_remote_stop_proof(self):
        with tempfile.TemporaryDirectory() as directory:
            h = Harness(directory)
            h.drift = "restore"
            h.proof = False
            result = h.execute()
            self.assertFalse(result["source_restarted"])
            self.assertIn("quiesce", h.calls)
            self.assertNotIn("recover", h.calls)
            self.assertNotIn("validate", h.calls)

    def test_slow_journal_never_dispatches_expired_stage(self):
        with tempfile.TemporaryDirectory() as directory:
            h = Harness(directory)
            record = h.journal.record
            def slow_record(event, **facts):
                record(event, **facts)
                if event == "CAPTURE_INTENT":
                    h.now += 61
            h.journal.record = slow_record
            result = h.execute()
            self.assertTrue(result["source_restarted"])
            self.assertNotIn("capture", h.calls)

    def test_all_validation_evidence_required(self):
        for missing in c.GATES["validate"]:
            with self.subTest(missing=missing), tempfile.TemporaryDirectory() as directory:
                h = Harness(directory)
                async def incomplete(deadline):
                    return {key: key != missing for key in c.GATES["validate"]}
                old = h.stages["validate"]
                h.stages["validate"] = c.Stage(old.seconds, old.measured_seconds, old.evidence_sha256, incomplete)
                result = h.execute()
                self.assertTrue(result["source_restarted"])
                self.assertNotIn("backup", h.calls)

    def test_unknown_freeze_ack_requires_quiescence_before_recovery(self):
        with tempfile.TemporaryDirectory() as directory:
            h = Harness(directory)
            async def lost(deadline):
                raise ConnectionError("lost-after-stop")
            h.freeze = lost
            self.assertTrue(h.execute()["source_restarted"])
            self.assertEqual(h.calls, ["recovery_fence", "quiesce", "recover"])

    def test_success_still_does_not_claim_retirement(self):
        with tempfile.TemporaryDirectory() as directory:
            h = Harness(directory)
            result = h.execute()
            self.assertTrue(result["cutover_accepted"])
            self.assertFalse(result["retirement_accepted"])
            self.assertEqual(h.calls, ["freeze", *c.PHASES[:6], "start_fence", *c.PHASES[6:]])
            with self.assertRaises(FileExistsError):
                c.Journal(h.journal.path, "synthetic-approval", "a" * 40)

    def test_unknown_remote_start_ack_never_dispatches_start_or_recovers(self):
        with tempfile.TemporaryDirectory() as directory:
            h = Harness(directory)
            async def lost(deadline):
                raise ConnectionError("remote-marker-may-be-durable")
            h.authorize_start = lost
            result = h.execute()
            self.assertTrue(result["reconciliation_required"])
            self.assertNotIn("start", h.calls)
            self.assertNotIn("recover", h.calls)

    def test_recovery_claim_loss_never_restores_old_environment(self):
        with tempfile.TemporaryDirectory() as directory:
            h = Harness(directory)
            h.failure = "restore"
            async def denied(deadline):
                return {"source_recovery_fence_persisted": False}
            h.claim_recovery = denied
            result = h.execute()
            self.assertFalse(result["source_restarted"])
            self.assertNotIn("quiesce", h.calls)
            self.assertNotIn("recover", h.calls)


if __name__ == "__main__":
    unittest.main()
