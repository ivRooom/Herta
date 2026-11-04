"""Real Linux filesystem/process tests. Root-owned temporary fixtures only."""
import importlib.util
import multiprocessing as mp
import os
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("source_fence", Path(__file__).with_name("pg17-source-fence.py"))
f = importlib.util.module_from_spec(spec)
spec.loader.exec_module(f)
controller_spec = importlib.util.spec_from_file_location("cutover_core", Path(__file__).with_name("pg17-cutover-controller.py"))
c = importlib.util.module_from_spec(controller_spec)
sys.modules[controller_spec.name] = c
controller_spec.loader.exec_module(c)
REF = "synthetic-only-approval"
IMAGE = "a" * 40
PROOF = "b" * 64


def contender(directory, barrier, output, operation):
    fence = f.Fence(directory, REF, IMAGE)
    barrier.wait(5)
    try:
        if operation == "start":
            fence.authorize_start(PROOF)
        else:
            fence.claim_recovery()
        output.put(operation)
    except (f.FenceStop, BlockingIOError):
        output.put("rejected")


def create_contender(base, reference, barrier, output):
    barrier.wait(5)
    try:
        f.Fence.create(base,reference,IMAGE)
        output.put('created')
    except (f.FenceStop,BlockingIOError,FileExistsError):
        output.put('rejected')


def hold_operation(directory, entered, release):
    fence = f.Fence(directory, REF, IMAGE)
    with fence.frozen_operation(minimum_seconds=0):
        entered.set()
        if not release.wait(5):
            raise RuntimeError('fixture-release-timeout')


class FenceTests(unittest.TestCase):
    def test_actual_operation_process_excludes_recovery_then_rejects_late_dispatch(self):
        base = self.base / 'operation'; base.mkdir(mode=0o700)
        fence = f.Fence.create(base, REF, IMAGE)
        fence.arm_frozen(f.current_clock())
        entered, release = mp.Event(), mp.Event()
        process = mp.Process(target=hold_operation, args=(fence.path, entered, release))
        process.start()
        try:
            self.assertTrue(entered.wait(5))
            with self.assertRaises(BlockingIOError):
                fence.claim_recovery()
        finally:
            release.set(); process.join(5)
            if process.is_alive():
                process.kill(); process.join(5)
        self.assertEqual(process.exitcode, 0)
        fence.claim_recovery()
        with self.assertRaises(f.FenceStop):
            with fence.frozen_operation(minimum_seconds=0):
                self.fail('late dispatch admitted')

    def test_prepared_or_started_operation_never_dispatches(self):
        with self.assertRaises(f.FenceStop):
            with self.fence.frozen_operation(minimum_seconds=0):
                self.fail('prepared dispatch admitted')
        self.arm(); self.fence.authorize_start(PROOF)
        with self.assertRaises(f.FenceStop):
            with self.fence.frozen_operation(minimum_seconds=0):
                self.fail('started dispatch admitted')

    def test_operation_guard_rechecks_after_slow_journal_and_cannot_escape_context(self):
        self.arm()
        with self.fence.frozen_operation(minimum_seconds=420) as guard:
            self.now += 301
            with self.assertRaises(f.FenceStop):
                guard()
        with self.assertRaises(f.FenceStop):
            guard()

    def test_operation_exit_deadline_exhaustion_is_not_acceptance(self):
        self.arm()
        with self.assertRaises(f.FenceStop):
            with self.fence.frozen_operation(minimum_seconds=0):
                self.now += 721

    def test_different_approval_cannot_bypass_active_attempt(self):
        with self.assertRaises(FileExistsError):f.Fence.create(self.base,REF+'-other',IMAGE)
        self.arm()
        self.fence.authorize_start(PROOF)
        with self.assertRaises(f.FenceStop):self.fence.release_recovered()
        with self.assertRaises(FileExistsError):f.Fence.create(self.base,REF+'-other',IMAGE)

    def test_release_only_recovered_preserves_consumed_audit(self):
        self.arm();self.fence.claim_recovery();self.fence.recovery_accepted(PROOF)
        self.fence.release_recovered()
        self.assertTrue((self.fence.path/'0003.json').is_file())
        with self.assertRaises(FileExistsError):f.Fence.create(self.base,REF,IMAGE)
        self.assertFalse((self.base/'active.json').exists())
        new=f.Fence.create(self.base,REF+'-other',IMAGE)
        self.assertEqual(new.status()['phase'],'PREPARED')
        with self.assertRaises(f.FenceStop):self.fence.status()

    def test_incomplete_creation_reservation_is_not_automatically_cleared(self):
        base=self.base/'partial';base.mkdir(mode=0o700)
        original=Path.mkdir
        def fail(path,*args,**kwargs):
            if path.parent==base:raise OSError('synthetic-directory-failure')
            return original(path,*args,**kwargs)
        with patch.object(Path,'mkdir',fail),self.assertRaises(OSError):f.Fence.create(base,REF,IMAGE)
        self.assertTrue((base/'active.json').is_file())
        with self.assertRaises(FileExistsError):f.Fence.create(base,REF+'-other',IMAGE)

    def test_actual_cross_approval_creation_race_has_one_winner(self):
        base=self.base/'creation-race';base.mkdir(mode=0o700)
        context=mp.get_context('fork');barrier=context.Barrier(2);output=context.Queue()
        children=[context.Process(target=create_contender,args=(base,REF+suffix,barrier,output)) for suffix in ('-a','-b')]
        for child in children:child.start()
        for child in children:
            child.join(10);self.assertEqual(child.exitcode,0)
        outcomes=[output.get(timeout=2) for _ in children]
        self.assertEqual(sorted(outcomes),['created','rejected'])
        output.close();output.join_thread()

    def setUp(self):
        self.assertEqual(os.geteuid(), 0)
        self.tmp = tempfile.TemporaryDirectory(prefix="herta675-fence-", dir="/root")
        self.base = Path(self.tmp.name)
        self.now = 1000.0
        self.boot = "test-boot"
        self.fence = f.Fence.create(self.base, REF, IMAGE, clock=lambda: self.now, boot=lambda: self.boot)

    def tearDown(self):
        self.tmp.cleanup()

    def arm(self):
        self.fence.arm_frozen(self.now)

    def test_expired_watchdog_claim_prevents_late_start(self):
        self.arm()
        with self.assertRaises(f.FenceStop):
            self.fence.claim_recovery(watchdog=True)
        self.now += 720
        self.fence.claim_recovery(watchdog=True)
        with self.assertRaises(f.FenceStop):
            self.fence.authorize_start(PROOF)
        self.fence.recovery_accepted(PROOF)
        self.assertEqual(self.fence.status()["phase"], "RECOVERED")

    def test_lost_start_ack_never_allows_recovery(self):
        self.arm()
        self.fence.authorize_start(PROOF)
        self.now += 1000
        reopened = f.Fence(self.fence.path, REF, IMAGE, clock=lambda: self.now, boot=lambda: self.boot)
        with self.assertRaises(f.FenceStop):
            reopened.claim_recovery(watchdog=True)
        self.assertTrue(reopened.status()["automatic_recovery_forbidden"])
        with self.assertRaises(f.FenceStop):
            reopened.authorize_start(PROOF)

    def test_reboot_or_clock_rollback_rejects_old_receipt(self):
        self.arm()
        self.boot = "another-boot"
        with self.assertRaises(f.FenceStop):
            self.fence.status()
        self.boot = "test-boot"
        self.now = 999
        with self.assertRaises(f.FenceStop):
            self.fence.status()

    def test_no_rearm_or_consumed_attempt_reuse(self):
        self.arm()
        with self.assertRaises(f.FenceStop):
            self.fence.arm_frozen(self.now)
        with self.assertRaises(FileExistsError):
            f.Fence.create(self.base, REF, IMAGE)

    def test_partial_freeze_can_claim_recovery_but_never_start(self):
        with self.assertRaises(f.FenceStop):
            self.fence.authorize_start(PROOF)
        self.now += 360
        self.fence.claim_recovery(watchdog=True)
        with self.assertRaises(f.FenceStop):
            self.fence.arm_frozen(self.now)

    def test_slow_fsync_preserves_marker_but_refuses_start(self):
        self.arm()
        sync = f.sync_dir
        def slow(path):
            sync(path)
            self.now += 721
        f.sync_dir = slow
        try:
            with self.assertRaises(f.FenceStop):
                self.fence.authorize_start(PROOF)
        finally:
            f.sync_dir = sync
        self.assertEqual(self.fence.status()["phase"], "START_INTENT")
        with self.assertRaises(f.FenceStop):
            self.fence.claim_recovery(watchdog=True)

    def test_invalid_last_record_rejected_without_external_hash(self):
        self.arm()
        path = self.fence.path / "0001.json"
        original = path.read_bytes()
        for field, value in (("phase", "PREPARED"), ("deadline", float("inf")),
                             ("deadline", self.now + 721), ("proof", PROOF)):
            with self.subTest(field=field, value=value):
                row = json.loads(original)
                row[field] = value
                path.write_text(json.dumps(row))
                with self.assertRaises(f.FenceStop):
                    self.fence.status()
        path.write_bytes(original)

    def test_truncated_or_missing_event_fails_closed(self):
        self.arm()
        path = self.fence.path / "0001.json"
        raw = path.read_bytes()
        path.write_bytes(raw[:20])
        with self.assertRaises((f.FenceStop, ValueError)):
            self.fence.authorize_start(PROOF)
        path.write_bytes(raw)
        (self.fence.path / "0000.json").unlink()
        with self.assertRaises(f.FenceStop):
            self.fence.claim_recovery()

    def test_symlink_lock_rejected(self):
        lock = self.fence.path / "lock"
        lock.unlink()
        lock.symlink_to(self.base / "unexpected")
        with self.assertRaises(OSError):
            self.fence.arm_frozen(self.now)

    def test_no_untrusted_group_writer(self):
        self.fence.path.chmod(0o770)
        with self.assertRaises(f.FenceStop):
            self.fence.status()
        self.fence.path.chmod(0o700)

    def test_actual_concurrent_processes_have_only_one_winner(self):
        # Real flock+fsync, not a mocked mutex. Either ordering is valid; never
        # allow both a new business start and old-Source recovery authorization.
        context = mp.get_context("fork")
        for iteration in range(12):
            base = self.base / f"race-{iteration}"
            base.mkdir(mode=0o700)
            fence = f.Fence.create(base, REF, IMAGE)
            fence.arm_frozen(f.current_clock())
            barrier, output = context.Barrier(2), context.Queue()
            children = [context.Process(target=contender, args=(fence.path, barrier, output, action))
                        for action in ("start", "recover")]
            for child in children:
                child.start()
            for child in children:
                child.join(10)
                self.assertEqual(child.exitcode, 0)
            outcomes = [output.get(timeout=2) for _ in children]
            self.assertEqual(outcomes.count("rejected"), 1)
            self.assertIn(fence.status()["phase"], ("START_INTENT", "RECOVERY_INTENT"))
            output.close()
            output.join_thread()

    def test_process_death_after_start_marker_is_durable(self):
        base = self.base / "crash"
        base.mkdir(mode=0o700)
        fence = f.Fence.create(base, REF, IMAGE)
        fence.arm_frozen(f.current_clock())
        pid = os.fork()
        if pid == 0:
            fence.authorize_start(PROOF)
            os._exit(0)  # No Python cleanup or acknowledged application start.
        _, status = os.waitpid(pid, 0)
        self.assertEqual(status, 0)
        reopened = f.Fence(fence.path, REF, IMAGE)
        self.assertEqual(reopened.status()["phase"], "START_INTENT")
        with self.assertRaises(f.FenceStop):
            reopened.claim_recovery()

    def run_integrated_core(self, *, fail_validation=False, lose_start_ack=False):
        import asyncio
        journal = c.Journal(self.base / "controller", REF, IMAGE)
        stages = {}
        calls = []
        for phase in c.PHASES:
            async def run(deadline, phase=phase):
                calls.append(phase)
                if phase == "validate" and fail_validation:
                    raise RuntimeError("synthetic-target-failure")
                if phase == "start":
                    self.assertEqual(self.fence.status()["phase"], "START_INTENT")
                return {key: True for key in c.GATES[phase]}
            stages[phase] = c.Stage(20, 1, PROOF, run)

        async def freeze(deadline):
            self.arm()
            return {"source_frozen": True, "watchdog_armed": True, "frozen_at": self.now}

        async def authorize(deadline):
            self.fence.authorize_start(PROOF)
            if lose_start_ack:
                raise ConnectionError("lost-after-actual-source-marker-fsync")
            return {"source_start_fence_persisted": True}

        async def claim(deadline):
            self.fence.claim_recovery()
            return {"source_recovery_fence_persisted": True}

        async def quiesce(deadline):
            self.assertEqual(self.fence.status()["phase"], "RECOVERY_INTENT")
            return {key: True for key in ("remote_operations_stopped", "target_clients_zero",
                "business_start_absent", "original_environment_restored")}

        async def recover(deadline):
            self.fence.recovery_accepted(PROOF)
            return {key: True for key in ("four_services_pg16", "old_backup_active", "workflow_restored")}

        result = asyncio.run(c.execute(stages, journal, freeze=freeze, authorize_start=authorize,
            claim_recovery=claim, quiesce_target=quiesce, recover_source=recover, clock=lambda: self.now))
        return result, calls

    def test_real_fence_core_start_integration(self):
        result, calls = self.run_integrated_core()
        self.assertTrue(result["cutover_accepted"])
        self.assertIn("start", calls)
        self.assertEqual(self.fence.status()["phase"], "START_INTENT")

    def test_real_fence_core_lost_start_ack_integration(self):
        result, calls = self.run_integrated_core(lose_start_ack=True)
        self.assertTrue(result["reconciliation_required"])
        self.assertNotIn("start", calls)
        self.assertEqual(self.fence.status()["phase"], "START_INTENT")

    def test_real_fence_core_recovery_integration(self):
        result, calls = self.run_integrated_core(fail_validation=True)
        self.assertTrue(result["source_restarted"])
        self.assertNotIn("start", calls)
        self.assertEqual(self.fence.status()["phase"], "RECOVERED")


if __name__ == "__main__":
    unittest.main()
