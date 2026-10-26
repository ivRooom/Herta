import assert from 'node:assert/strict';
import { PrismaClient, Prisma } from '@prisma/client';

// These are disposable, public fixture values. Never accept a caller-provided URL.
const url = new URL('postgresql://herta_runtime:synthetic-runtime@localhost:5432/herta');
url.search = new URLSearchParams({
  sslmode: 'require',
  sslaccept: 'strict',
  sslcert: '/tls/ca.crt',
  connection_limit: '2',
  connect_timeout: '3',
  pool_timeout: '3',
}).toString();

async function use(connection, action) {
  const db = new PrismaClient({ datasources: { db: { url: connection.toString() } } });
  try {
    return await action(db);
  } finally {
    await db.$disconnect();
  }
}

async function denied(label, change, pattern) {
  const connection = new URL(url);
  change(connection);
  await assert.rejects(
    use(connection, (db) => db.$queryRaw`SELECT 1`),
    (error) => pattern.test(String(error)),
    label,
  );
  console.log(`PASS: ${label}`);
}

await use(url, async (db) => {
  const [tls] = await db.$queryRaw`SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()`;
  assert.equal(tls.ssl, true);
  const guild = await db.guild.create({ data: { id: 'synthetic-guild', name: 'Synthetic' } });
  assert.equal(guild.id, 'synthetic-guild');
  await db.user.create({ data: { id: 'synthetic-user', username: 'Synthetic' } });
  await db.guildMember.create({
    data: { guildId: guild.id, userId: 'synthetic-user', roles: ['fixture-role'] },
  });
  assert.equal(await db.guildMember.count({ where: { guildId: guild.id } }), 1);
  await assert.rejects(
    db.guildMember.create({
      data: { guildId: 'missing-guild', userId: 'synthetic-user', roles: [] },
    }),
    (error) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003',
  );
  await assert.rejects(
    db.$executeRawUnsafe('CREATE TABLE forbidden_runtime_ddl (id int)'),
    /permission denied/,
  );
  await db.guild.delete({ where: { id: guild.id } });
  assert.equal(await db.guildMember.count(), 0);
  await db.user.delete({ where: { id: 'synthetic-user' } });
});
console.log('PASS: actual Prisma TLS, full schema client CRUD/FK/cascade and runtime DDL denial');
await denied(
  'wrong CA rejected',
  (x) => x.searchParams.set('sslcert', '/tls/wrong.crt'),
  /certificate|TLS|SSL/i,
);
await denied(
  'wrong hostname rejected',
  (x) => {
    x.hostname = '127.0.0.1';
  },
  /certificate|TLS|SSL/i,
);
await denied(
  'wrong password rejected',
  (x) => {
    x.password = 'wrong-fixture';
  },
  /authentication failed|P1000/i,
);
await denied(
  'plaintext rejected',
  (x) => x.searchParams.set('sslmode', 'disable'),
  /pg_hba|denied access|P1010/i,
);
await denied(
  'cross-service database rejected',
  (x) => {
    x.pathname = '/ivrm_ai';
  },
  /pg_hba|denied access|P1010/i,
);
await denied(
  'superuser database rejected',
  (x) => {
    x.pathname = '/postgres';
  },
  /pg_hba|denied access|P1010/i,
);
console.log(
  `PASS: Prisma ${Prisma.prismaVersion.client}; pool limit2 and timeouts3s are fixture settings, not measured production capacity`,
);
