import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateExternalDatabase } from './validate-external-database.mjs';

test('strict effective database configuration and secret-safe rejection', () => {
  const dir = mkdtempSync(join(tmpdir(), 'herta-ca-test-'));
  try {
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-days',
        '1',
        '-subj',
        '/CN=fixture',
        '-addext',
        'basicConstraints=critical,CA:TRUE',
        '-keyout',
        join(dir, 'key'),
        '-out',
        join(dir, 'ca'),
      ],
      { stdio: 'ignore' },
    );
    const pem = readFileSync(join(dir, 'ca'), 'utf8');
    const url = (user, limit) =>
      `postgresql://${user}:fixture-${user}@ivrm-db-postgres.internal:5432/herta?schema=public&sslmode=require&sslaccept=strict&sslcert=%2Frun%2Fivrm%2Fpostgresql-ca.crt&connect_timeout=3&pool_timeout=3&connection_limit=${limit}`;
    const env = {
      HERTA_DATABASE_MODE: 'external',
      HERTA_DATABASE_PRIVATE_IP: '10.0.0.2',
      DATABASE_URL: url('herta_migrator', 1),
      HERTA_RUNTIME_DATABASE_URL: url('herta_runtime', 2),
    };
    validateExternalDatabase(env, pem);
    const bad = [
      { HERTA_DATABASE_MODE: 'local' },
      { HERTA_DATABASE_PRIVATE_IP: '8.8.8.8' },
      { HERTA_DATABASE_PRIVATE_IP: '10.0.0.999' },
      ...['sslmode=disable', 'sslaccept=accept_invalid_certs', 'connection_limit=99'].map(
        (pair) => ({
          DATABASE_URL: env.DATABASE_URL.replace(new RegExp(`${pair.split('=')[0]}=[^&]+`), pair),
        }),
      ),
      { DATABASE_URL: `${env.DATABASE_URL}&sslmode=require` },
      { DATABASE_URL: `${env.DATABASE_URL}&password=sentinel-secret` },
      { DATABASE_URL: env.DATABASE_URL.replace('/herta?', '/another?') },
      { DATABASE_URL: env.DATABASE_URL.replace('ivrm-db-postgres.internal', 'localhost') },
      { DATABASE_URL: env.DATABASE_URL.replace('herta_migrator:', 'herta_runtime:') },
      { DATABASE_URL: env.DATABASE_URL.replace('fixture-herta_migrator', 'fixture-herta_runtime') },
    ];
    for (const change of bad)
      assert.throws(() => validateExternalDatabase({ ...env, ...change }, pem), {
        message: 'External database configuration rejected.',
      });
    for (const invalid of ['', `${pem}\nPRIVATE KEY`, 'sentinel-secret'])
      assert.throws(() => validateExternalDatabase(env, invalid), {
        message: 'External database configuration rejected.',
      });
    assert.throws(() => validateExternalDatabase(env, pem, Date.now() + 2 * 86400000));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
