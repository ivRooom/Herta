"""Offline identity/admission tests. No systemd or production operations."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from unittest.mock import Mock

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('unit', Path(__file__).with_name('pg17-process-unit.py'))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
real_cgroup_v2 = m.cgroup_v2


class UnitTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir='/root', prefix='herta675-unit-')
        self.path = Path(self.tmp.name); self.path.chmod(0o700)
        self.script = self.path / 'fixture.py'; self.script.write_text('pass'); self.script.chmod(0o600)
        self.sha = m.hashlib.sha256(self.script.read_bytes()).hexdigest()
        self.unit = m.ProcessUnit(self.path, 'synthetic-only', 'a' * 32)
        self.capability = patch.object(m, 'cgroup_v2', return_value=Path('/synthetic-cgroup-v2'))
        self.capability.start()

    def tearDown(self):
        self.capability.stop()
        self.tmp.cleanup()

    def test_bad_hash_or_runtime_rejected_without_unit_or_intent(self):
        with patch.object(m, 'command') as command:
            for sha, runtime in (('0' * 64, 30), (self.sha, 721), (self.sha, True)):
                with self.assertRaises(m.UnitStop):
                    self.unit.start(self.script, sha, runtime_seconds=runtime)
            command.assert_not_called()
        self.assertFalse(self.unit.intent.exists())

    def test_start_failure_consumes_durable_intent_and_cannot_relaunch(self):
        with patch.object(m, 'command', side_effect=RuntimeError('synthetic-ack-loss')) as command:
            with self.assertRaises(RuntimeError):
                self.unit.start(self.script, self.sha, runtime_seconds=30)
            with self.assertRaises(FileExistsError):
                self.unit.start(self.script, self.sha, runtime_seconds=30)
        self.assertEqual(command.call_count, 1)
        self.assertEqual(json.loads(m.read_private(self.unit.intent))['scriptSha256'], self.sha)

    def test_verified_copy_not_original_path_is_dispatched(self):
        with patch.object(m, 'command', return_value=b'') as command, patch.object(self.unit, 'owned'):
            self.unit.start(self.script, self.sha, runtime_seconds=30)
        self.assertIn(str(self.unit.actor), command.call_args.args[0])
        self.assertNotIn(str(self.script), command.call_args.args[0])
        self.assertIn('--property=KillMode=control-group', command.call_args.args[0])
        self.assertEqual(m.read_private(self.unit.actor), self.script.read_bytes())

    def test_supervisor_remaining_lifetime_uses_verified_duration_and_earlier_start(self):
        with patch.object(m, 'command', return_value=b''), patch.object(self.unit, 'owned'):
            self.unit.start(self.script, self.sha, runtime_seconds=1200, supervisor=True)
        info = {'RuntimeMaxUSec': '20min', 'ActiveEnterTimestampMonotonic': '20000000',
                'ActiveState': 'active', 'SubState': 'running', 'MainPID': '1234',
                'ExecMainStartTimestampMonotonic': '10000000'}
        with patch.object(self.unit, 'owned', return_value=info), patch.object(m.time, 'clock_gettime', return_value=100.):
            self.assertEqual(self.unit.remaining_runtime(), 1110.)
            for duration in ('infinity', '30s', 'unsupported'):
                info['RuntimeMaxUSec'] = duration
                with self.assertRaises(m.UnitStop):
                    self.unit.remaining_runtime()

    def test_regular_actor_cannot_be_used_as_supervisor_lifetime_proof(self):
        with patch.object(m, 'command', return_value=b''), patch.object(self.unit, 'owned'):
            self.unit.start(self.script, self.sha, runtime_seconds=30)
        info = {'ActiveState': 'active', 'SubState': 'running', 'MainPID': '1234'}
        with patch.object(self.unit, 'owned', return_value=info), self.assertRaises(m.UnitStop):
            self.unit.remaining_runtime()

    def test_foreign_unit_is_never_stopped(self):
        with patch.object(self.unit, 'owned', side_effect=m.UnitStop), patch.object(m, 'command') as command:
            with self.assertRaises(m.UnitStop):
                self.unit.stop()
        command.assert_not_called()

    def test_changed_identity_or_kill_mode_never_sends_stop(self):
        with patch.object(m, 'command', return_value=b''), patch.object(self.unit, 'owned'):
            self.unit.start(self.script, self.sha, runtime_seconds=30)
        valid = {'Id': self.unit.name, 'Description': self.unit.description, 'Transient': 'yes',
                 'LoadState': 'loaded', 'ActiveState': 'active', 'SubState': 'exited',
                 'ControlGroup': '', 'MainPID': '0', 'KillMode': 'control-group', 'User': 'root'}
        for key, value in (('Description', 'foreign'), ('KillMode', 'process'), ('User', 'someone'),
                           ('Transient', 'no'), ('ControlGroup', '/system.slice/foreign.service')):
            with self.subTest(key=key), patch.object(self.unit, 'properties', return_value={**valid, key: value}), \
                 patch.object(m, 'command') as command:
                with self.assertRaises(m.UnitStop):
                    self.unit.stop()
                command.assert_not_called()

    def test_missing_or_unprotected_staging_rejected(self):
        self.path.chmod(0o755)
        with self.assertRaises(m.UnitStop):
            m.ProcessUnit(self.path, 'synthetic-only', 'a' * 32)

    def test_fixture_reset_requires_positive_stop_evidence(self):
        fixture_spec = importlib.util.spec_from_file_location('fixture', Path(__file__).with_name('pg17-process-unit.integration.test.py'))
        fixture = importlib.util.module_from_spec(fixture_spec); fixture_spec.loader.exec_module(fixture)
        unit = Mock(); unit.name = 'synthetic-unproven.service'
        with patch.object(fixture.m, 'command') as command, self.assertRaises(fixture.m.UnitStop):
            fixture.unload_fixture(unit, set())
        unit.properties.assert_not_called()
        command.assert_not_called()

    def test_unavailable_cgroup_v2_never_starts_or_records_stop_proof(self):
        with patch.object(m, 'cgroup_v2', side_effect=m.UnitStop), patch.object(m, 'command') as command:
            with self.assertRaises(m.UnitStop):
                self.unit.start(self.script, self.sha, runtime_seconds=30)
            with self.assertRaises(m.UnitStop):
                self.unit.stop()
            command.assert_not_called()
        self.assertFalse(self.unit.intent.exists())
        self.assertFalse((self.path / ('unit-' + self.unit.operation + '.stopped')).exists())

    def test_wrong_mount_type_or_partial_hierarchy_rejected(self):
        original = Path.read_text
        for replacement in ('77 1 0:1 / /sys/fs/cgroup rw - cgroup cgroup rw\n',
                            '77 1 0:1 /subtree /sys/fs/cgroup rw - cgroup2 cgroup rw\n', ''):
            def read(path, *args, **kwargs):
                if str(path) == '/proc/self/mountinfo':
                    return replacement
                return original(path, *args, **kwargs)
            with self.subTest(mount=replacement), patch.object(Path, 'read_text', read), self.assertRaises(m.UnitStop):
                real_cgroup_v2()


if __name__ == '__main__':
    unittest.main()
