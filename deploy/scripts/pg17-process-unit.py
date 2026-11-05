"""#675 root-local owned systemd process containment. Not installed on production.

This proves only the identified local cgroup is stopped. Docker exec jobs and
remote requests/backends require separate quiescence evidence before recovery.
Actors must be self-contained Python; credential values never belong in argv.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import time


class UnitStop(RuntimeError):
    pass


def need(ok):
    if not ok:
        raise UnitStop('owned-unit-rejected')


def protected_directory(path):
    need(os.geteuid() == 0 and path.is_absolute())
    for parent in (*reversed(path.parents), path):
        info = parent.lstat()
        need(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022)
    need(stat.S_IMODE(path.stat().st_mode) == 0o700)


def read_private(path):
    protected_directory(path.parent)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        need(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1
             and stat.S_IMODE(info.st_mode) == 0o600 and 0 < info.st_size <= 65536)
        raw = os.read(fd, 65537)
        need(len(raw) == info.st_size)
        return raw
    finally:
        os.close(fd)


def durable_new(path, raw):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(raw); stream.flush(); os.fsync(stream.fileno())
    fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def command(args, timeout=10):
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            timeout=timeout, env={'PATH': '/usr/bin:/bin', 'LC_ALL': 'C'})
    need(result.returncode == 0 and len(result.stdout) <= 16384)
    return result.stdout


def cgroup_v2():
    # An absent v2 path is NOT evidence of empty processes on a v1/unmounted
    # host. Require the actual complete unified hierarchy before any mutation.
    root = Path('/sys/fs/cgroup')
    info = root.lstat()
    need(stat.S_ISDIR(info.st_mode) and info.st_uid == 0)
    mounts = []
    for line in Path('/proc/self/mountinfo').read_text().splitlines():
        before, separator, after = line.partition(' - ')
        fields = before.split()
        if separator and len(fields) >= 6 and fields[4] == str(root):
            mounts.append((fields[3], after.split()[0]))
    need(mounts == [('/', 'cgroup2')])
    controllers = (root / 'cgroup.controllers').read_text().split()
    need('pids' in controllers and len(controllers) == len(set(controllers)))
    # Root cgroups have no cgroup.events on some kernels. The system.slice
    # used explicitly below must expose the real v2 population interface.
    events = dict(line.split() for line in (root / 'system.slice/cgroup.events').read_text().splitlines())
    need(events.get('populated') in ('0', '1'))
    return root


class ProcessUnit:
    def __init__(self, directory, approval_reference, operation_id):
        self.path = Path(directory)
        protected_directory(self.path)
        need(type(approval_reference) is str and 0 < len(approval_reference) <= 256)
        need(type(operation_id) is str and re.fullmatch('[0-9a-f]{32}', operation_id) is not None)
        self.approval = hashlib.sha256(approval_reference.encode()).hexdigest()
        self.operation = operation_id
        self.name = 'herta-pg17-' + self.approval[:16] + '-' + operation_id + '.service'
        self.description = 'Herta675:' + self.approval + ':' + operation_id
        self.cgroup = '/system.slice/' + self.name
        self.intent = self.path / ('unit-' + operation_id + '.intent')
        self.actor = self.path / ('actor-' + operation_id + '.py')

    def start(self, script, script_sha256, *, runtime_seconds, arguments=(), supervisor=False):
        cgroup_v2()
        need(type(supervisor) is bool)
        need(type(runtime_seconds) is int and 1 <= runtime_seconds <= (1200 if supervisor else 720))
        need(type(script_sha256) is str and re.fullmatch('[0-9a-f]{64}', script_sha256) is not None)
        need(type(arguments) in (tuple, list) and len(arguments) <= 16
             and all(type(value) is str and 0 < len(value) <= 1024 and '\0' not in value for value in arguments))
        raw = read_private(Path(script))
        need(hashlib.sha256(raw).hexdigest() == script_sha256)
        compile(raw, '<pinned-owned-actor>', 'exec')
        # Intent is consumed even if staging or the provider acknowledgement
        # fails. No automatic retry or regenerated operation ID is allowed.
        intent = {'format': 'herta-owned-unit-v1', 'approval': self.approval,
                  'operation': self.operation, 'unit': self.name, 'description': self.description,
                  'scriptSha256': script_sha256, 'runtimeSeconds': runtime_seconds, 'supervisor': supervisor}
        durable_new(self.intent, json.dumps(intent, sort_keys=True).encode())
        durable_new(self.actor, raw)
        need(read_private(self.actor) == raw)
        # argv contains reviewed paths/options only. Standard streams never
        # send actor output or credential-bearing errors to the journal.
        command(['systemd-run', '--quiet', '--no-ask-password', '--unit=' + self.name,
                 '--description=' + self.description, '--service-type=exec', '--remain-after-exit', '--slice=system.slice',
                 '--property=KillMode=control-group', '--property=TimeoutStopSec=3',
                 '--property=RuntimeMaxSec=' + str(runtime_seconds), '--property=Restart=no',
                 '--property=StandardOutput=null', '--property=StandardError=null',
                 '--property=User=root', '--property=Group=root',
                 '--property=Environment=PATH=/usr/bin:/bin',
                 sys.executable, '-I', str(self.actor), *arguments])
        self.owned()
        return {'ownedUnitStarted': True, 'unit': self.name, 'remoteOperationsStopped': False}

    def properties(self):
        raw = command(['systemctl', 'show', self.name, '--no-pager',
                       '--property=Id,Description,Transient,LoadState,ActiveState,SubState,ControlGroup,MainPID,KillMode,User,RuntimeMaxUSec,ActiveEnterTimestampMonotonic,ExecMainStartTimestampMonotonic'])
        result = {}
        for line in raw.decode().splitlines():
            key, separator, value = line.partition('=')
            need(separator and key not in result)
            result[key] = value
        need(set(result) == {'Id', 'Description', 'Transient', 'LoadState', 'ActiveState',
                             'SubState', 'ControlGroup', 'MainPID', 'KillMode', 'User',
                             'RuntimeMaxUSec', 'ActiveEnterTimestampMonotonic', 'ExecMainStartTimestampMonotonic'})
        return result

    def owned(self):
        root = cgroup_v2()
        raw = read_private(self.intent)
        intent = json.loads(raw)
        need(intent.get('format') == 'herta-owned-unit-v1' and intent.get('approval') == self.approval
             and intent.get('operation') == self.operation and intent.get('unit') == self.name
             and intent.get('description') == self.description)
        info = self.properties()
        need(info['Id'] == self.name and info['Description'] == self.description
             and info['Transient'] == 'yes' and info['LoadState'] == 'loaded'
             and info['KillMode'] == 'control-group' and info['User'] == 'root'
             and info['ControlGroup'] in ('', self.cgroup))
        need(re.fullmatch('[0-9]+', info['MainPID']) is not None)
        if int(info['MainPID']) > 0:
            need(info['ControlGroup'] == self.cgroup)
            events = dict(line.split() for line in (root / self.cgroup.lstrip('/') / 'cgroup.events').read_text().splitlines())
            need(events.get('populated') == '1')
        return info

    def remaining_runtime(self):
        info = self.owned()
        need(info['ActiveState'] == 'active' and info['SubState'] == 'running'
             and info['MainPID'].isdigit() and int(info['MainPID']) > 0)
        intent = json.loads(read_private(self.intent))
        need(intent.get('supervisor') is True)
        duration = 0
        for part in info['RuntimeMaxUSec'].split():
            match = re.fullmatch(r'([0-9]+)(min|s)', part)
            need(match is not None)
            duration += int(match[1]) * (60 if match[2] == 'min' else 1)
        need(type(intent.get('runtimeSeconds')) is int and duration == intent['runtimeSeconds']
             and 1 <= duration <= 1200)
        starts = []
        for key in ('ActiveEnterTimestampMonotonic', 'ExecMainStartTimestampMonotonic'):
            need(re.fullmatch('[0-9]+', info[key]) is not None and int(info[key]) > 0)
            starts.append(int(info[key]) / 1000000)
        # Count from the earlier observed main start/active entry, never extend
        # lifetime by the manager's delay acknowledging the exec transition.
        entered = min(starts)
        now = time.clock_gettime(time.CLOCK_MONOTONIC)
        need(0 < entered <= now)
        remaining = entered + duration - now
        need(remaining > 0)
        return remaining

    def stop(self):
        # Never issue a mutation against a missing/foreign/unverified unit.
        # Unknown start acknowledgement requires reconciliation if no matching
        # unit is observable; absence alone does not prove delayed work stopped.
        self.owned()
        command(['systemctl', 'stop', self.name], timeout=8)
        info = self.properties()
        if info['LoadState'] != 'not-found':
            self.owned()
            need(info['ActiveState'] in ('inactive', 'failed') and info['MainPID'] == '0')
        root = cgroup_v2()
        cgroup = root / self.cgroup.lstrip('/')
        try:
            events = (cgroup / 'cgroup.events').read_text()
        except FileNotFoundError:
            need(not cgroup.exists())
        else:
            parsed = dict(line.split() for line in events.splitlines())
            need(parsed.get('populated') == '0')
        durable_new(self.path / ('unit-' + self.operation + '.stopped'),
                    json.dumps({'unit': self.name, 'ownedCgroupEmpty': True}, sort_keys=True).encode())
        return {'ownedUnitStopped': True, 'ownedCgroupEmpty': True, 'remoteOperationsStopped': False}


if __name__ == '__main__':
    print(json.dumps({'selfCheck': 'PASS', 'productionInstalled': False,
                      'cloudCalls': 0, 'serviceActions': 0}))
