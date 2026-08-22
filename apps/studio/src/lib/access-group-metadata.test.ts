import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAccessGroupMetadata } from './access-group-metadata.ts';

test('parseAccessGroupMetadata normalizes valid values and ignores unknown fields', () => {
  assert.deepEqual(
    parseAccessGroupMetadata({
      name: ' Moderators ',
      description: ' Staff group ',
      futureField: true,
    }),
    {
      ok: true,
      value: { name: 'Moderators', description: 'Staff group' },
    },
  );

  assert.deepEqual(parseAccessGroupMetadata({ name: 'Members', description: '   ' }), {
    ok: true,
    value: { name: 'Members', description: null },
  });
});

test('parseAccessGroupMetadata enforces Unicode code-point boundaries', () => {
  assert.deepEqual(parseAccessGroupMetadata({ name: '😀'.repeat(100) }), {
    ok: true,
    value: { name: '😀'.repeat(100), description: null },
  });
  assert.deepEqual(
    parseAccessGroupMetadata({ name: 'Members', description: '🧩'.repeat(500) }),
    {
      ok: true,
      value: { name: 'Members', description: '🧩'.repeat(500) },
    },
  );
  assert.deepEqual(parseAccessGroupMetadata({ name: '😀'.repeat(101) }), {
    ok: false,
    field: 'name',
  });
  assert.deepEqual(
    parseAccessGroupMetadata({ name: 'Members', description: '🧩'.repeat(501) }),
    {
      ok: false,
      field: 'description',
    },
  );
});

test('parseAccessGroupMetadata rejects missing names and invalid description types', () => {
  assert.deepEqual(parseAccessGroupMetadata({ description: 'missing name' }), {
    ok: false,
    field: 'name',
  });
  assert.deepEqual(parseAccessGroupMetadata({ name: 'Members', description: 123 }), {
    ok: false,
    field: 'description',
  });
});
