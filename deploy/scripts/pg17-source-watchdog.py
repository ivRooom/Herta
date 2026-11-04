"""Source-local #675 watchdog. Not installed; production adapters still required.

Run independently of the coordinator. Every start/recovery actor must use the
same Source fence. A killed local process is NOT proof of remote quiescence.
Only the pinned quiescence adapter's positive evidence permits Source recovery.
"""
import contextlib
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import resource
import signal
import stat
import subprocess
import sys
import time


class WatchdogStop(RuntimeError):
    pass


def need(value):
    if not value:
        raise WatchdogStop('watchdog-acceptance-failed')


def boottime():
    return time.clock_gettime(time.CLOCK_BOOTTIME)


QUIESCENCE = ('remote_operations_stopped', 'target_clients_zero',
              'business_start_absent', 'original_environment_restored')
RECOVERY = ('four_services_pg16', 'old_backup_active', 'workflow_restored')


def publish_ready(fence, row, observed):
    """Root-private heartbeat. Unit identity/liveness is checked separately."""
    raw = json.dumps({'format': 'herta-watchdog-ready-v1', 'approval': fence.approval,
                      'image': fence.image, 'boot': row['boot'], 'phase': row['phase'],
                      'deadline': row['deadline'], 'pid': os.getpid(), 'observed': observed}, sort_keys=True).encode()
    temporary = fence.path / ('watchdog.ready.' + str(os.getpid()) + '.tmp')
    created = False
    try:
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        created = True
        with os.fdopen(fd, 'wb') as stream:
            stream.write(raw); stream.flush(); os.fsync(stream.fileno())
        os.replace(temporary, fence.path / 'watchdog.ready')
        created = False
        fd = os.open(fence.path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    finally:
        if created:
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass


def read_private(path, bound=65536):
    path = Path(path)
    need(path.is_absolute() and os.geteuid() == 0)
    for parent in (*reversed(path.parents),):
        info = parent.lstat()
        need(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        need(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1
             and stat.S_IMODE(info.st_mode) == 0o600 and 0 < info.st_size <= bound)
        raw = os.read(fd, bound + 1)
        need(len(raw) == info.st_size)
        return raw
    finally:
        os.close(fd)


class Adapter:
    """Execute verified self-contained Python bytes, not a mutable file path.

    Adapters receive only the BOOTTIME deadline on stdin and return a bounded
    JSON object of booleans. They must cancel/verify remote work themselves.
    No production URL/credential is supplied by this runner.
    """
    def __init__(self, path, sha256):
        need(type(sha256) is str and re.fullmatch('[0-9a-f]{64}', sha256) is not None)
        self.raw = read_private(path)
        need(hashlib.sha256(self.raw).hexdigest() == sha256)
        compile(self.raw, '<pinned-watchdog-adapter>', 'exec')

    def run(self, deadline, *, clock=boottime, reserve_seconds=0):
        need(type(reserve_seconds) is int and 0 <= reserve_seconds <= 60)
        limit = deadline - reserve_seconds
        need(limit - clock() > 2)
        script = os.memfd_create('herta-watchdog-adapter')
        output = os.memfd_create('herta-watchdog-result')
        process = None
        try:
            os.fchmod(script, 0o600); os.fchmod(output, 0o600)
            with os.fdopen(os.dup(script), 'wb') as stream:
                stream.write(self.raw); stream.flush()
            os.lseek(script, 0, os.SEEK_SET)
            def limits():
                resource.setrlimit(resource.RLIMIT_FSIZE, (4096, 4096))
            need(limit - clock() > 2)
            process = subprocess.Popen([sys.executable, '-I', '/proc/self/fd/' + str(script)],
                stdin=subprocess.PIPE, stdout=output, stderr=subprocess.DEVNULL,
                env={'PATH': '/usr/bin:/bin'}, pass_fds=(script,),
                start_new_session=True, preexec_fn=limits)
            process.stdin.write(json.dumps({'deadlineBoottime': deadline}).encode())
            process.stdin.close()
            while process.poll() is None and clock() < limit - 2:
                time.sleep(min(.05, max(.001, limit - 2 - clock())))
            need(process.poll() == 0 and clock() < limit)
            os.lseek(output, 0, os.SEEK_SET)
            raw = os.read(output, 4097)
            need(0 < len(raw) <= 4096)
            def unique(pairs):
                result = {}
                for key, value in pairs:
                    need(key not in result); result[key] = value
                return result
            result = json.loads(raw, object_pairs_hook=unique)
            need(type(result) is dict and all(type(v) is bool for v in result.values()))
            return result
        finally:
            if process is not None:
                # Kill any same-group descendants even when the parent exited.
                # This cleanup alone NEVER becomes remote-quiescence evidence.
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.wait(timeout=2)
            os.close(script); os.close(output)


@contextlib.contextmanager
def singleton(fence):
    fd = os.open(fence.path / 'watchdog.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(fd)
        need(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1
             and stat.S_IMODE(info.st_mode) == 0o600)
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally:
        os.close(fd)


def watch(fence, quiesce, recover, *, reserve_seconds=60, poll_seconds=.2,
          interrupt=None, initial_deadline=None, clock=boottime, sleep=time.sleep):
    """At most one automatic recovery. START_INTENT always forbids old restart.

    Recovery reserve is INSIDE the existing deadline, not added after expiry.
    A watchdog crash after claiming recovery leaves RECOVERY_INTENT for manual
    reconciliation; a replacement never retries an ambiguous recovery.
    """
    need(type(reserve_seconds) is int and 10 <= reserve_seconds <= 60)
    need(type(poll_seconds) in (int, float) and 0 < poll_seconds <= 1)
    need(isinstance(quiesce, Adapter) and isinstance(recover, Adapter))
    need(interrupt is None or isinstance(interrupt, Adapter))
    initial_now = clock() if initial_deadline is not None else None
    need(initial_deadline is None or (type(initial_deadline) in (int, float)
         and math.isfinite(initial_deadline) and initial_now < initial_deadline <= initial_now + 720))
    known_deadline = initial_deadline
    interrupted_at = None
    ready_key = None
    ready_at = None
    def contention():
        nonlocal interrupted_at
        now = clock()
        # Production readiness must observe the Source fence before capture
        # starts or supply its verified initial BOOTTIME deadline. Unknown
        # admission never grants permission to kill an arbitrary actor.
        need(known_deadline is not None)
        remaining = known_deadline - reserve_seconds - now
        if remaining > 0:
            sleep(min(poll_seconds, remaining))
            return
        if interrupted_at is None:
            need(interrupt is not None)
            end = min(now + 10, known_deadline - 6)
            need(end - now > 2)
            # Separate from the locked fence journal: the actor may own that
            # lock. Persist before effect so a lost ACK cannot be replayed.
            intent = fence.path / 'watchdog-interrupt.intent'
            fd = os.open(intent, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, 'wb') as stream:
                stream.write(json.dumps({'approval': fence.approval, 'image': fence.image,
                                         'deadline': known_deadline}, sort_keys=True).encode())
                stream.flush(); os.fsync(stream.fileno())
            fd = os.open(fence.path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
            need(clock() < end - 2)
            proof = interrupt.run(end, clock=clock)
            need(set(proof) == {'ownedUnitStopped', 'ownedCgroupEmpty', 'remoteOperationsStopped'}
                 and proof['ownedUnitStopped'] is True and proof['ownedCgroupEmpty'] is True
                 and proof['remoteOperationsStopped'] is False and clock() < end)
            interrupted_at = clock()
        else:
            # Do not wait indefinitely if some unowned actor still holds it.
            need(now < interrupted_at + 2 and now < known_deadline - 6)
            sleep(poll_seconds)
    with singleton(fence):
        while True:
            try:
                with fence.locked():
                    row = fence.read()[-1]
            except BlockingIOError:
                contention()
                continue
            known_deadline = row['deadline']
            observed = clock()
            key = (row['phase'], row['deadline'])
            if key != ready_key or ready_at is None or observed - ready_at >= 1:
                publish_ready(fence, row, observed)
                ready_key, ready_at = key, observed
            if row['phase'] in ('START_INTENT', 'RECOVERY_INTENT', 'RECOVERED'):
                return {'source_restarted': False, 'phase': row['phase']}
            remaining = row['deadline'] - reserve_seconds - clock()
            if remaining > 0:
                sleep(min(poll_seconds, remaining))
                continue
            try:
                # Rechecks current phase and deadline under the Source lock.
                claim = fence.claim_recovery_if_due(reserve_seconds=reserve_seconds)
            except BlockingIOError:
                contention()
                continue
            if claim is None:
                continue
            # Any other failure remains fail-closed, without a retry. The
            # claimed row, not the earlier poll, owns the recovery deadline.
            deadline = claim['deadline']
            need(deadline - clock() > 45)
            # Supply the original end to nested env rollback, but stop the
            # local quiescence adapter early enough for actual Source recovery.
            proof = quiesce.run(deadline, clock=clock, reserve_seconds=41)
            need(set(proof) == set(QUIESCENCE) and all(proof[k] is True for k in QUIESCENCE))
            need(deadline - clock() > 40)
            result = recover.run(deadline, clock=clock)
            need(set(result) == set(RECOVERY) and all(result[k] is True for k in RECOVERY))
            need(clock() < deadline)
            digest = hashlib.sha256(json.dumps({'quiescence': proof, 'recovery': result},
                                               sort_keys=True).encode()).hexdigest()
            fence.recovery_accepted(digest)
            need(clock() < deadline)
            return {'source_restarted': True, 'phase': 'RECOVERED'}


if __name__ == '__main__':
    print(json.dumps({'selfCheck': 'PASS', 'productionInstalled': False,
                      'cloudCalls': 0, 'serviceActions': 0}))
