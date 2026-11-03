import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { validateLightsailHostFingerprint } from './verify-lightsail-ssh-host-key.mjs';

const fingerprint = 'SHA256:' + 'A'.repeat(43);
test('a fully formed OpenSSH SHA256 host fingerprint is accepted', () => {
  assert.equal(validateLightsailHostFingerprint(fingerprint), fingerprint);
  const alternate = 'SHA256:abcd+/'.padEnd(50, 'z');
  assert.equal(validateLightsailHostFingerprint(alternate), alternate);
});

test('missing, unverified and malformed fingerprints fail closed', () => {
  for (const value of [
    undefined,
    null,
    '',
    ' ',
    'MD5:11:22:33',
    'SHA256:' + 'b'.repeat(42),
    'SHA256:' + 'c'.repeat(44),
    'SHA256:' + 'A'.repeat(42) + '=',
    fingerprint + ' extra',
    fingerprint + '\n',
    fingerprint + '\r',
    fingerprint + '\nSSH StrictHostKeyChecking=no',
    'sha256:' + 'A'.repeat(43),
    'SHA256:' + '-'.repeat(43),
    'SHA256:' + '_'.repeat(43),
  ]) {
    assert.throws(() => validateLightsailHostFingerprint(value), /Missing or invalid/);
  }
});

test('both production SSH actions pin the same protected Environment host fingerprint', () => {
  const source = readFileSync(
    new URL('../../.github/workflows/deploy-production.yml', import.meta.url),
    'utf8',
  );
  const deploy = source.split('\n  deploy:\n')[1];
  assert.ok(deploy, 'production job must exist');
  assert.ok(deploy.includes('environment: production'));
  const variable = '${{ vars.LIGHTSAIL_SSH_HOST_FINGERPRINT }}';
  const lines = deploy.split('\n');
  const pins = lines.filter((line) => line.trim() === 'fingerprint: ' + variable);
  assert.equal(pins.length, 2, 'both SSH steps must pin the same host fingerprint');
  const preflightLabel = 'Validate Lightsail SSH host fingerprint before any remote access';
  const preflight = deploy.indexOf(preflightLabel);
  const sshDeploy = deploy.indexOf('LightsailへSSHデプロイ');
  const readback = deploy.indexOf('Read back running API/Bot/Studio/Worker image SHA');
  const publisher = deploy.indexOf('Publish verified production runtime attestation');
  assert.ok(preflight >= 0);
  assert.ok(preflight < sshDeploy);
  assert.ok(sshDeploy < readback);
  assert.ok(readback < publisher);
  assert.ok(
    deploy.includes('run: node deploy/scripts/verify-lightsail-ssh-host-key.mjs'),
    'the production preflight must run before SSH',
  );
  assert.ok(
    deploy.includes('LIGHTSAIL_SSH_HOST_FINGERPRINT: ' + variable),
    'the verifier must use the same pinned value as the SSH action',
  );
  const actions = (deploy.match(/uses: appleboy\/ssh-action@/g) ?? []).length;
  assert.equal(actions, 2, 'all production SSH actions must be covered');
});
