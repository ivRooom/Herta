import { readFileSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const caPath = '/run/ivrm/postgresql-ca.crt';
const required = {
  schema: 'public',
  sslmode: 'require',
  sslaccept: 'strict',
  sslcert: caPath,
  connect_timeout: '3',
  pool_timeout: '3',
};

/** Validate effective container values; never include inputs or parser errors in failures. */
export function validateExternalDatabase(env, pem, now = Date.now()) {
  try {
    if (env.HERTA_DATABASE_MODE !== 'external') throw new Error();
    const ip = (env.HERTA_DATABASE_PRIVATE_IP ?? '').split('.');
    if (ip.length !== 4 || ip.some((x) => !/^(0|[1-9]\d{0,2})$/.test(x) || Number(x) > 255))
      throw new Error();
    const n = ip.map(Number);
    if (!(
      n[0] === 10 ||
      (n[0] === 172 && n[1] >= 16 && n[1] <= 31) ||
      (n[0] === 192 && n[1] === 168)
    ))
      throw new Error();
    const parsed = [];
    for (const [key, user, limit] of [
      ['DATABASE_URL', 'herta_migrator', '1'],
      ['HERTA_RUNTIME_DATABASE_URL', 'herta_runtime', '2'],
    ]) {
      const url = new URL(env[key]);
      if (
        url.protocol !== 'postgresql:' ||
        url.hostname !== 'ivrm-db-postgres.internal' ||
        url.port !== '5432' ||
        url.pathname !== '/herta' ||
        url.hash
      )
        throw new Error();
      if (
        decodeURIComponent(url.username) !== user ||
        !decodeURIComponent(url.password) ||
        /[\u0000-\u001f\u007f]/.test(decodeURIComponent(url.password))
      )
        throw new Error();
      const params = { ...required, connection_limit: limit };
      if ([...url.searchParams.keys()].some((x) => !Object.hasOwn(params, x))) throw new Error();
      for (const [k, value] of Object.entries(params))
        if (url.searchParams.getAll(k).length !== 1 || url.searchParams.get(k) !== value)
          throw new Error();
      parsed.push(url);
    }
    if (decodeURIComponent(parsed[0].password) === decodeURIComponent(parsed[1].password))
      throw new Error();
    if (Buffer.byteLength(pem) > 65536 || /PRIVATE KEY/.test(pem)) throw new Error();
    const certs = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
    if (!certs || certs.length > 3) throw new Error();
    for (const text of certs) {
      const cert = new X509Certificate(text);
      if (!cert.ca || Date.parse(cert.validFrom) > now || Date.parse(cert.validTo) <= now)
        throw new Error();
    }
  } catch {
    throw new Error('External database configuration rejected.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    validateExternalDatabase(process.env, readFileSync(caPath, 'utf8'));
    console.log(
      'External database configuration accepted; server trust/reachability is checked by Prisma status.',
    );
  } catch {
    console.error('External database configuration rejected.');
    process.exitCode = 2;
  }
}
