"""Linux Source-local #675 fence. Library only; no production installation.

Every business-start adapter and recovery/watchdog adapter must use this same
root-owned fence. An old-Source restart is forbidden after START_INTENT, even
if the new start's acknowledgement was lost. No SQL or service action here.
"""
import contextlib
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import stat
import time


class FenceStop(RuntimeError):
    pass


def need(value):
    if not value:
        raise FenceStop("source-fence-rejected")


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def current_clock():
    # BOOTTIME includes host suspend; boot ID prevents reuse across reboot.
    return time.clock_gettime(time.CLOCK_BOOTTIME)


def boot_id():
    value = Path("/proc/sys/kernel/random/boot_id").read_text().strip()
    need(re.fullmatch(r"[0-9a-f-]{36}", value) is not None)
    return value


def sync_dir(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def protected_directory(path):
    need(os.geteuid() == 0 and path.is_absolute())
    for parent in (*reversed(path.parents), path):
        info = parent.lstat()
        need(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022)
    need(stat.S_IMODE(path.stat().st_mode) == 0o700)


@contextlib.contextmanager
def registry_locked(base):
    protected_directory(base)
    fd = os.open(base / 'registry.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(fd)
        need(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1
             and stat.S_IMODE(info.st_mode) == 0o600)
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally:
        os.close(fd)


class Fence:
    def __init__(self, directory, approval_reference, image_sha, *, clock=current_clock, boot=boot_id):
        self.path = Path(directory)
        protected_directory(self.path)
        need(re.fullmatch(r"[0-9a-f]{40}", image_sha) is not None)
        need(type(approval_reference) is str and 0 < len(approval_reference) <= 256)
        self.approval = digest(approval_reference.encode())
        need(self.path.name == self.approval)
        self.image = image_sha
        self.clock, self.boot = clock, boot

    @classmethod
    def create(cls, base, approval_reference, image_sha, **kwargs):
        base = Path(base)
        protected_directory(base)
        need(type(approval_reference) is str and 0 < len(approval_reference) <= 256)
        need(type(image_sha) is str and re.fullmatch(r'[0-9a-f]{40}', image_sha) is not None)
        approval = digest(approval_reference.encode())
        directory = base / approval
        with registry_locked(base):
            try:
                directory.lstat()
            except FileNotFoundError:
                pass
            else:
                raise FileExistsError('consumed-source-fence')
            # Persist reservation first. Interrupted creation remains blocked
            # for explicit reconciliation rather than admitting another run.
            fd = os.open(base / 'active.json', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, 'wb') as stream:
                stream.write(json.dumps({'approvalSha256':approval,'imageSha':image_sha},sort_keys=True).encode())
                stream.flush();os.fsync(stream.fileno())
            sync_dir(base)
            directory.mkdir(mode=0o700, exist_ok=False)
            sync_dir(base)
            fence = cls(directory, approval_reference, image_sha, **kwargs)
            fd = os.open(directory / "lock", os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            os.fsync(fd)
            os.close(fd)
            sync_dir(directory)
            with fence.attempt_locked():
                fence.append([], "PREPARED", deadline=fence.clock() + 360)
        return fence

    @contextlib.contextmanager
    def locked(self):
        # Fixed lock order: host registry, then attempt. Every mutating/status
        # API rejects old, released or foreign reservations on reopen.
        with registry_locked(self.path.parent):
            fd = os.open(self.path.parent/'active.json',os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
            with os.fdopen(fd,'rb') as stream:
                info=os.fstat(stream.fileno())
                need(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1
                     and stat.S_IMODE(info.st_mode) == 0o600 and 0 < info.st_size <= 1024)
                raw=stream.read(1025)
            need(raw == json.dumps({'approvalSha256':self.approval,'imageSha':self.image},sort_keys=True).encode())
            with self.attempt_locked():
                yield

    @contextlib.contextmanager
    def attempt_locked(self):
        protected_directory(self.path)
        fd = os.open(self.path / "lock", os.O_RDWR | os.O_NOFOLLOW)
        try:
            info = os.fstat(fd)
            need(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1
                 and stat.S_IMODE(info.st_mode) == 0o600)
            # Contention is bounded/fail-closed, never wait beyond a deadline.
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            yield
        finally:
            os.close(fd)

    def release_recovered(self):
        with self.locked():
            need(self.read()[-1]['phase'] == 'RECOVERED')
            os.unlink(self.path.parent/'active.json')
            sync_dir(self.path.parent)

    def read(self):
        paths = sorted(self.path.glob("*.json"))
        need(0 < len(paths) <= 8)
        result, previous = [], "0" * 64
        for index, path in enumerate(paths):
            need(path.name == f"{index:04d}.json")
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
            with os.fdopen(fd, "rb") as stream:
                info = os.fstat(stream.fileno())
                need(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1
                     and stat.S_IMODE(info.st_mode) == 0o600 and 0 < info.st_size <= 4096)
                raw = stream.read(4097)
            row = json.loads(raw)
            need(set(row) == {"index", "previous", "phase", "boot", "time", "deadline", "approval", "image", "proof"})
            need(type(row["index"]) is int and row["index"] == index and row["previous"] == previous
                 and row["approval"] == self.approval and row["image"] == self.image
                 and row["boot"] == self.boot())
            need(type(row["time"]) in (int, float) and math.isfinite(row["time"])
                 and 0 <= row["time"] <= self.clock())
            need(type(row["deadline"]) in (int, float) and math.isfinite(row["deadline"]))
            transitions = {"PREPARED": ("FROZEN", "RECOVERY_INTENT"),
                           "FROZEN": ("START_INTENT", "RECOVERY_INTENT"),
                           "RECOVERY_INTENT": ("RECOVERED",),
                           "START_INTENT": (), "RECOVERED": ()}
            need(row["phase"] in transitions)
            if row["phase"] in ("START_INTENT", "RECOVERED"):
                need(type(row["proof"]) is str and re.fullmatch(r"[0-9a-f]{64}", row["proof"]) is not None)
            else:
                need(row["proof"] is None)
            if result:
                need(row["time"] >= result[-1]["time"])
                need(row["phase"] in transitions[result[-1]["phase"]])
                if row["phase"] == "FROZEN":
                    need(row["time"] < result[-1]["deadline"]
                         and 0 < row["deadline"] - row["time"] <= 720)
                else:
                    need(row["deadline"] == result[-1]["deadline"])
                    if row["phase"] == "START_INTENT":
                        need(row["time"] < row["deadline"])
            else:
                need(row["phase"] == "PREPARED" and 0 < row["deadline"] - row["time"] <= 360)
            result.append(row)
            previous = digest(raw)
        return result

    def append(self, rows, phase, *, deadline, proof=None):
        index = len(rows)
        previous = digest((self.path / f"{index-1:04d}.json").read_bytes()) if rows else "0" * 64
        row = {"index": index, "previous": previous, "phase": phase,
               "boot": self.boot(), "time": self.clock(), "deadline": deadline,
               "approval": self.approval, "image": self.image, "proof": proof}
        raw = json.dumps(row, sort_keys=True).encode()
        fd = os.open(self.path / f"{index:04d}.json", os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "wb") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        sync_dir(self.path)
        return row

    def arm_frozen(self, frozen_at, *, seconds=720):
        with self.locked():
            rows = self.read()
            now = self.clock()
            need(rows[-1]["phase"] == "PREPARED" and type(seconds) is int and 0 < seconds <= 720)
            need(type(frozen_at) in (int, float) and math.isfinite(frozen_at)
                 and rows[-1]["time"] <= frozen_at <= now < frozen_at + seconds
                 and now < rows[-1]["deadline"])
            row = self.append(rows, "FROZEN", deadline=frozen_at + seconds)
            need(self.clock() < row["deadline"])
            return row

    def authorize_start(self, proof_sha256):
        # Must return durably before the caller sends ANY business-start request.
        with self.locked():
            rows = self.read()
            need(rows[-1]["phase"] == "FROZEN" and self.clock() < rows[-1]["deadline"])
            need(type(proof_sha256) is str and re.fullmatch(r"[0-9a-f]{64}", proof_sha256) is not None)
            row = self.append(rows, "START_INTENT", deadline=rows[-1]["deadline"], proof=proof_sha256)
            # A slow fsync can exhaust the remaining window. Preserve the
            # durable marker but never acknowledge a late business start.
            need(self.clock() < row["deadline"])
            return row

    def claim_recovery(self, *, watchdog=False):
        # Claim BEFORE restoring the old env or starting old services. Holding
        # the same lock prevents a concurrent authorize_start from winning too.
        with self.locked():
            rows = self.read()
            need(rows[-1]["phase"] in ("PREPARED", "FROZEN") and type(watchdog) is bool)
            need(not watchdog or self.clock() >= rows[-1]["deadline"])
            return self.append(rows, "RECOVERY_INTENT", deadline=rows[-1]["deadline"])

    def recovery_accepted(self, proof_sha256):
        with self.locked():
            rows = self.read()
            need(rows[-1]["phase"] == "RECOVERY_INTENT")
            need(type(proof_sha256) is str and re.fullmatch(r"[0-9a-f]{64}", proof_sha256) is not None)
            return self.append(rows, "RECOVERED", deadline=rows[-1]["deadline"], proof=proof_sha256)

    def claim_recovery_if_due(self, *, reserve_seconds):
        # Atomic watchdog observation/claim. PREPARED may become FROZEN between
        # polling and this lock, changing the deadline in either direction.
        with self.locked():
            rows = self.read()
            need(type(reserve_seconds) is int and 10 <= reserve_seconds <= 60)
            row = rows[-1]
            if row['phase'] not in ('PREPARED', 'FROZEN'):
                return None
            if self.clock() < row['deadline'] - reserve_seconds:
                return None
            return self.append(rows, 'RECOVERY_INTENT', deadline=row['deadline'])

    def frozen_operation(self, *, minimum_seconds):
        return self._phase_operation('FROZEN', minimum_seconds=minimum_seconds)

    def prepared_operation(self, *, minimum_seconds):
        return self._phase_operation('PREPARED', minimum_seconds=minimum_seconds)

    def recovery_operation(self, *, minimum_seconds):
        return self._phase_operation('RECOVERY_INTENT', minimum_seconds=minimum_seconds)

    @contextlib.contextmanager
    def _phase_operation(self, phase, *, minimum_seconds):
        """Serialize actual Source dispatch against recovery/start claims.

        The process supervisor must still kill the owning actor/children and
        prove remote quiescence. This lock alone has no process cancellation.
        Yield a fresh guard for slow pre-dispatch journal persistence. It must
        only be called inside this context; no nested status/lock acquisition.
        """
        need(type(minimum_seconds) is int and 0 <= minimum_seconds <= 720)
        with self.locked():
            active = True
            def before_dispatch():
                need(active)
                row = self.read()[-1]
                need(row['phase'] == phase and self.clock() + minimum_seconds < row['deadline'])
            before_dispatch()
            try:
                yield before_dispatch
                row = self.read()[-1]
                need(row['phase'] == phase and self.clock() < row['deadline'])
            finally:
                active = False

    def status(self):
        with self.locked():
            row = self.read()[-1]
            return {"phase": row["phase"], "expired": self.clock() >= row["deadline"],
                    "business_start_forbidden": row["phase"] != "FROZEN" or self.clock() >= row["deadline"],
                    "automatic_recovery_forbidden": row["phase"] not in ("PREPARED", "FROZEN")}
