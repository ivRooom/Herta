import assert from 'node:assert/strict';
import test from 'node:test';
import { isPrismaRawUniqueViolation } from './prisma-raw-error.ts';

test('P2010 + PostgreSQL 23505をunique violationとして判定する', () => {
  assert.equal(
    isPrismaRawUniqueViolation({ code: 'P2010', meta: { code: '23505', message: 'duplicate key' } }),
    true,
  );
});

test('unique以外のraw query failureを409対象にしない', () => {
  assert.equal(isPrismaRawUniqueViolation({ code: 'P2010', meta: { code: '08006' } }), false);
  assert.equal(isPrismaRawUniqueViolation({ code: 'P2002', meta: { code: '23505' } }), false);
  assert.equal(isPrismaRawUniqueViolation(new Error('database unavailable')), false);
});
