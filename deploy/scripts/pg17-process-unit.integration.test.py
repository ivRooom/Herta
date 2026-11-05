"""Explicit local root/systemd test. Synthetic owned units only; no cloud/DB."""
import importlib.util
import base64
import json
import os
from pathlib import Path
import sys
import tempfile
import time
import uuid

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('unit', Path(__file__).with_name('pg17-process-unit.py'))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
fence_path = Path(__file__).with_name('pg17-source-fence.py')
fence_spec = importlib.util.spec_from_file_location('fence', fence_path)
f = importlib.util.module_from_spec(fence_spec); fence_spec.loader.exec_module(f)
watchdog_path = Path(__file__).with_name('pg17-source-watchdog.py')
watchdog_spec = importlib.util.spec_from_file_location('watchdog', watchdog_path)
w = importlib.util.module_from_spec(watchdog_spec); watchdog_spec.loader.exec_module(w)


def active(pid):
    try:
        raw = Path('/proc/' + str(pid) + '/stat').read_text()
    except FileNotFoundError:
        return False
    return raw.rsplit(')', 1)[1].split()[0] not in ('Z', 'X')


def unload_fixture(unit, stopped):
    m.need(unit.name in stopped)
    info = unit.properties()
    if info['LoadState'] != 'not-found':
        unit.owned()
        assert info['ActiveState'] in ('inactive', 'failed') and info['MainPID'] == '0'
        m.command(['systemctl', 'reset-failed', unit.name])
        end = time.monotonic() + 3
        while unit.properties()['LoadState'] != 'not-found' and time.monotonic() < end:
            time.sleep(.05)
        assert unit.properties()['LoadState'] == 'not-found'


def main():
    units = []
    stopped = set()
    with tempfile.TemporaryDirectory(dir='/root', prefix='herta675-cgroup-') as directory:
        base = Path(directory); base.chmod(0o700)
        script = base / 'synthetic.py'
        child = "import os,signal,sys,time;signal.signal(signal.SIGTERM,signal.SIG_IGN);open(sys.argv[1],'w').write(str(os.getpid()));time.sleep(120)"
        embedded = base64.b64encode(fence_path.read_bytes()).decode()
        script.write_text('import os,signal,subprocess,sys,time,base64\n'
                          'signal.signal(signal.SIGTERM,signal.SIG_IGN)\n'
                          'namespace={}\n'
                          'exec(compile(base64.b64decode(' + repr(embedded) + '),"<actual-fence>","exec"),namespace)\n'
                          'fence=namespace["Fence"](sys.argv[2],"local-systemd-synthetic-only","a"*40)\n'
                          'with fence.frozen_operation(minimum_seconds=0):\n'
                          ' subprocess.Popen([sys.executable,"-I","-c",' + repr(child) + ',sys.argv[1]],start_new_session=True)\n'
                          ' time.sleep(120)\n')
        script.chmod(0o600)
        sha = m.hashlib.sha256(script.read_bytes()).hexdigest()
        try:
            pids = []
            fences = []
            deadlines = []
            for _ in range(2):
                operation = uuid.uuid4().hex
                unit = m.ProcessUnit(base, 'local-systemd-synthetic-only', operation)
                units.append(unit)
                fence_base = base / ('fence-' + operation); fence_base.mkdir(mode=0o700)
                fence = f.Fence.create(fence_base, 'local-systemd-synthetic-only', 'a' * 40)
                row = fence.arm_frozen(f.current_clock(), seconds=61 if not fences else 720)
                deadlines.append(row['deadline']); fences.append(fence)
                pidfile = base / ('child-' + operation)
                unit.start(script, sha, runtime_seconds=60, arguments=[str(pidfile), str(fence.path)])
                end = time.monotonic() + 5
                while not pidfile.exists() and time.monotonic() < end:
                    time.sleep(.05)
                assert pidfile.exists()
                pids.append(int(pidfile.read_text()))
            assert all(active(pid) for pid in pids)
            try:
                fences[0].claim_recovery()
            except BlockingIOError:
                pass
            else:
                raise AssertionError('live-actor-must-own-source-lock')
            def adapter(filename, source):
                path = base / filename; path.write_text(source); path.chmod(0o600)
                return w.Adapter(path, m.hashlib.sha256(path.read_bytes()).hexdigest())
            module_bytes = base64.b64encode(Path(m.__file__).read_bytes()).decode()
            interrupt = adapter('interrupt.py', 'import base64,json,sys\n'
                'json.load(sys.stdin)\nnamespace={}\n'
                'exec(compile(base64.b64decode(' + repr(module_bytes) + '),"<owned-unit>","exec"),namespace)\n'
                'unit=namespace["ProcessUnit"](' + repr(str(base)) + ',"local-systemd-synthetic-only",' + repr(units[0].operation) + ')\n'
                'print(json.dumps(unit.stop()))\n')
            # Production-service/remote gates below are explicitly synthetic;
            # actual systemd interruption and fence transitions are real.
            quiesce = adapter('quiesce.py', 'import json;print(json.dumps(' + repr(dict.fromkeys(w.QUIESCENCE, True)) + '))')
            recover = adapter('recover.py', 'import json;print(json.dumps(' + repr(dict.fromkeys(w.RECOVERY, True)) + '))')
            result = w.watch(fences[0], quiesce, recover, interrupt=interrupt, initial_deadline=deadlines[0])
            stopped.add(units[0].name)
            assert result['source_restarted'] and result['phase'] == 'RECOVERED'
            assert not active(pids[0]), 'new-session TERM-ignoring child survived'
            assert active(pids[1]) and units[1].owned()['ActiveState'] == 'active'
            assert units[0].intent.exists(), 'audit must survive stop'
            assert fences[0].status()['phase'] == 'RECOVERED'
            try:
                with fences[0].frozen_operation(minimum_seconds=0):
                    raise AssertionError('late-dispatch-must-be-rejected')
            except f.FenceStop:
                pass
        finally:
            errors = []
            for unit in reversed(units):
                if unit.name in stopped:
                    continue
                try:
                    unit.stop(); stopped.add(unit.name)
                except Exception:
                    errors.append(unit.name)
            # A forced stop leaves a failed transient definition on systemd.
            # Remove only this test's verified, stopped units before deleting
            # the private fixture directory. Production audit is not reset.
            for unit in units:
                try:
                    unload_fixture(unit, stopped)
                except Exception:
                    errors.append(unit.name)
            if errors:
                raise RuntimeError('local-owned-unit-cleanup-incomplete')
    print(json.dumps({'realLocalSystemdContainment': 'PASS', 'newSessionTermIgnoringChildStopped': True,
                      'unrelatedOwnedUnitPreserved': True, 'ownedCgroupsEmpty': True,
                      'actualSourceFenceReleased': True, 'lateDispatchRejected': True,
                      'actualWatchdogInterruption': True, 'serviceRecoveryEvidenceSynthetic': True,
                      'remoteOperationsAccepted': False, 'fixturesCleaned': True,
                      'cloudCalls': 0, 'productionAccess': False}))


if __name__ == '__main__':
    main()
