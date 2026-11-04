"""Root-only local Linux tests. No cloud, Docker or production service action."""
import hashlib
import contextlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True


def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


f = load('pg17-source-fence')
w = load('pg17-source-watchdog')
real_publish_ready = w.publish_ready


class FakeAdapter(w.Adapter):
    def __init__(self, callback):
        self.callback = callback

    def run(self, deadline, **kwargs):
        return self.callback(deadline)


class WatchdogTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir='/root', prefix='herta-watchdog-')
        self.base = Path(self.tmp.name)
        os.chmod(self.base, 0o700)
        self.now = 100.
        self.fence = f.Fence.create(self.base, 'synthetic-watchdog', 'a' * 40,
                                    clock=lambda: self.now, boot=lambda: 'synthetic-boot')
        self.calls = []
        def quiesce(deadline):
            self.calls.append('quiesce'); self.now += 1
            return dict.fromkeys(w.QUIESCENCE, True)
        def recover(deadline):
            self.calls.append('recover'); self.now += 1
            return dict.fromkeys(w.RECOVERY, True)
        self.quiesce, self.recover = FakeAdapter(quiesce), FakeAdapter(recover)
        self.publisher = patch.object(w, 'publish_ready')
        self.publisher.start()

    def tearDown(self):
        self.publisher.stop()
        self.tmp.cleanup()

    def test_actual_private_readiness_record_binds_fence_phase_pid_and_boot(self):
        with self.fence.locked():
            row = self.fence.read()[-1]
        real_publish_ready(self.fence, row, self.now)
        path = self.fence.path / 'watchdog.ready'
        ready = json.loads(path.read_bytes())
        self.assertEqual((ready['approval'], ready['image'], ready['boot'], ready['phase'], ready['pid']),
                         (self.fence.approval, self.fence.image, 'synthetic-boot', 'PREPARED', os.getpid()))
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.fence.arm_frozen(self.now, seconds=100)
        with self.fence.locked():
            row = self.fence.read()[-1]
        real_publish_ready(self.fence, row, self.now)
        self.assertEqual(json.loads(path.read_bytes())['phase'], 'FROZEN')
        self.assertFalse(list(self.fence.path.glob('watchdog.ready.*.tmp')))

    def test_readiness_temporary_collision_never_deletes_existing_file(self):
        row = self.fence.read()[-1]
        path = self.fence.path / ('watchdog.ready.' + str(os.getpid()) + '.tmp')
        path.write_bytes(b'existing-fixture-audit')
        with self.assertRaises(FileExistsError):
            real_publish_ready(self.fence, row, self.now)
        self.assertEqual(path.read_bytes(), b'existing-fixture-audit')

    def run_watch(self, **kwargs):
        def sleep(seconds):
            self.now += seconds
        return w.watch(self.fence, self.quiesce, self.recover,
                       clock=lambda: self.now, sleep=sleep, **kwargs)

    def busy_frozen(self):
        self.fence.arm_frozen(self.now, seconds=100)
        self.now = 140.
        original = self.fence.locked
        busy = {'value': True}
        @contextlib.contextmanager
        def locked():
            if busy['value']:
                raise BlockingIOError('synthetic-owned-actor')
            with original():
                yield
        self.fence.locked = locked
        return busy

    def interrupt_proof(self):
        return {'ownedUnitStopped': True, 'ownedCgroupEmpty': True, 'remoteOperationsStopped': False}

    def test_busy_actor_interrupted_before_claim_and_separate_quiescence(self):
        busy = self.busy_frozen()
        def stop(_):
            self.calls.append('interrupt'); busy['value'] = False
            return self.interrupt_proof()
        result = self.run_watch(interrupt=FakeAdapter(stop), initial_deadline=200.)
        self.assertTrue(result['source_restarted'])
        self.assertEqual(self.calls, ['interrupt', 'quiesce', 'recover'])
        self.assertTrue((self.fence.path / 'watchdog-interrupt.intent').exists())

    def test_lost_interrupt_ack_is_never_replayed(self):
        self.busy_frozen()
        def lost(_):
            self.calls.append('interrupt')
            raise RuntimeError('lost-ack')
        with self.assertRaisesRegex(RuntimeError, 'lost-ack'):
            self.run_watch(interrupt=FakeAdapter(lost), initial_deadline=200.)
        with self.assertRaises(FileExistsError):
            self.run_watch(interrupt=FakeAdapter(lost), initial_deadline=200.)
        self.assertEqual(self.calls, ['interrupt'])

    def test_negative_interrupt_proof_never_recovers(self):
        self.busy_frozen()
        proof = self.interrupt_proof(); proof['ownedCgroupEmpty'] = False
        with self.assertRaises(w.WatchdogStop):
            self.run_watch(interrupt=FakeAdapter(lambda _: proof), initial_deadline=200.)
        self.assertEqual(self.calls, [])

    def test_slow_interrupt_intent_never_dispatches_after_budget(self):
        self.busy_frozen()
        def slow(_):
            self.now = 149.
        def stop(_):
            self.calls.append('interrupt')
            return self.interrupt_proof()
        with patch.object(w.os, 'fsync', slow), self.assertRaises(w.WatchdogStop):
            self.run_watch(interrupt=FakeAdapter(stop), initial_deadline=200.)
        self.assertEqual(self.calls, [])
        self.assertTrue((self.fence.path / 'watchdog-interrupt.intent').exists())

    def test_start_marker_after_interrupt_prevents_source_restart(self):
        busy = self.busy_frozen()
        def stop(_):
            busy['value'] = False
            self.fence.authorize_start('b' * 64)
            return self.interrupt_proof()
        result = self.run_watch(interrupt=FakeAdapter(stop), initial_deadline=200.)
        self.assertEqual(result['phase'], 'START_INTENT')
        self.assertFalse(result['source_restarted'])
        self.assertEqual(self.calls, [])

    def test_unknown_deadline_or_unreleased_lock_never_recovers(self):
        self.busy_frozen()
        with self.assertRaises(w.WatchdogStop):
            self.run_watch(interrupt=FakeAdapter(lambda _: self.interrupt_proof()))
        with self.assertRaises(w.WatchdogStop):
            self.run_watch(interrupt=FakeAdapter(lambda _: self.interrupt_proof()), initial_deadline=200.)
        self.assertEqual(self.calls, [])

    def test_recovers_inside_frozen_deadline(self):
        self.fence.arm_frozen(self.now, seconds=100)
        result = self.run_watch()
        self.assertTrue(result['source_restarted'])
        self.assertEqual(self.calls, ['quiesce', 'recover'])
        self.assertLess(self.now, 200)
        self.assertEqual(self.fence.status()['phase'], 'RECOVERED')

    def test_partial_freeze_prepared_is_also_recovered(self):
        self.assertTrue(self.run_watch()['source_restarted'])
        self.assertLess(self.now, 460)

    def test_prepared_to_frozen_race_uses_atomically_claimed_deadline(self):
        for seconds in (20, 100):
            with self.subTest(seconds=seconds):
                if seconds == 100:
                    self.tearDown(); self.setUp()
                original = self.fence.claim_recovery_if_due
                armed = []
                def claim(**kwargs):
                    if not armed:
                        self.fence.arm_frozen(self.now, seconds=seconds)
                        armed.append(self.now + seconds)
                    return original(**kwargs)
                self.fence.claim_recovery_if_due = claim
                deadlines = []
                def quiesce(deadline):
                    deadlines.append(deadline)
                    return dict.fromkeys(w.QUIESCENCE, True)
                def recover(deadline):
                    deadlines.append(deadline)
                    return dict.fromkeys(w.RECOVERY, True)
                self.quiesce, self.recover = FakeAdapter(quiesce), FakeAdapter(recover)
                self.assertTrue(self.run_watch()['source_restarted'])
                self.assertEqual(deadlines[-1], armed[0])
                self.assertLessEqual(deadlines[0], armed[0])

    def test_sleep_uses_one_clock_sample_at_recovery_threshold(self):
        samples = iter((399.999, 400.001))
        sleeps = []
        def clock():
            self.now = next(samples, 400.001)
            return self.now
        def sleep(seconds):
            self.assertGreaterEqual(seconds, 0)
            sleeps.append(seconds)
        result = w.watch(self.fence, self.quiesce, self.recover, clock=clock, sleep=sleep)
        self.assertTrue(result['source_restarted'])
        self.assertLessEqual(len(sleeps), 1)

    def test_start_marker_never_recovers(self):
        self.fence.arm_frozen(self.now, seconds=100)
        self.fence.authorize_start('b' * 64)
        self.assertEqual(self.run_watch()['phase'], 'START_INTENT')
        self.assertEqual(self.calls, [])

    def test_existing_recovery_intent_never_retries(self):
        self.fence.claim_recovery()
        self.assertEqual(self.run_watch()['phase'], 'RECOVERY_INTENT')
        self.assertEqual(self.calls, [])

    def test_negative_remote_proof_prevents_source_restart_and_retry(self):
        self.quiesce = FakeAdapter(lambda _: dict.fromkeys(w.QUIESCENCE, False))
        with self.assertRaises(w.WatchdogStop):
            self.run_watch()
        self.assertEqual(self.calls, [])
        self.assertEqual(self.fence.status()['phase'], 'RECOVERY_INTENT')
        self.assertEqual(self.run_watch()['phase'], 'RECOVERY_INTENT')

    def test_late_quiescence_cannot_dispatch_recovery(self):
        def late(_):
            self.now = 461
            return dict.fromkeys(w.QUIESCENCE, True)
        self.quiesce = FakeAdapter(late)
        with self.assertRaises(w.WatchdogStop):
            self.run_watch()
        self.assertEqual(self.calls, [])

    def test_singleton_excludes_second_watchdog(self):
        with w.singleton(self.fence), self.assertRaises(BlockingIOError):
            self.run_watch()

    def test_early_watchdog_claim_cannot_use_recovery_reserve_to_start_early(self):
        self.assertIsNone(self.fence.claim_recovery_if_due(reserve_seconds=60))
        self.assertEqual(self.fence.status()['phase'], 'PREPARED')
        with self.assertRaises(f.FenceStop):
            self.fence.claim_recovery_if_due(reserve_seconds=61)

    def adapter(self, source):
        path = self.base / 'adapter.py'
        raw = source.encode()
        path.write_bytes(raw); path.chmod(0o600)
        return w.Adapter(path, hashlib.sha256(raw).hexdigest())

    def test_actual_pinned_process_executes_original_bytes_after_path_replaced(self):
        adapter = self.adapter('import json; print(json.dumps({"accepted": True}))')
        (self.base / 'adapter.py').write_text('raise RuntimeError("replacement")')
        self.assertEqual(adapter.run(w.boottime() + 5), {'accepted': True})

    def test_actual_process_timeout_is_not_acceptance(self):
        adapter = self.adapter('import time; time.sleep(30)')
        before = time.monotonic()
        with self.assertRaises(w.WatchdogStop):
            adapter.run(w.boottime() + 3)
        self.assertLess(time.monotonic() - before, 4)

    def test_duplicate_or_nonboolean_output_rejected(self):
        for output in ('{"accepted":true,"accepted":true}', '{"accepted":1}'):
            adapter = self.adapter('print(' + repr(output) + ')')
            with self.assertRaises(w.WatchdogStop):
                adapter.run(w.boottime() + 5)

    def test_unpinned_or_unprotected_adapter_rejected(self):
        path = self.base / 'bad.py'; path.write_text('print("{}")'); path.chmod(0o600)
        with self.assertRaises(w.WatchdogStop):
            w.Adapter(path, '0' * 64)
        path.chmod(0o644)
        with self.assertRaises(w.WatchdogStop):
            w.Adapter(path, hashlib.sha256(path.read_bytes()).hexdigest())


if __name__ == '__main__':
    unittest.main()
