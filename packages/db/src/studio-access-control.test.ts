import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isStudioAccessPrincipalType,
  STUDIO_ACCESS_PRINCIPAL_TYPES,
} from './studio-access-control.js';

test('Studio access principal typeはrole/user/groupだけを受け付ける', () => {
  assert.deepEqual(STUDIO_ACCESS_PRINCIPAL_TYPES, ['role', 'user', 'group']);
  assert.equal(isStudioAccessPrincipalType('role'), true);
  assert.equal(isStudioAccessPrincipalType('user'), true);
  assert.equal(isStudioAccessPrincipalType('group'), true);
  assert.equal(isStudioAccessPrincipalType('plugin'), false);
  assert.equal(isStudioAccessPrincipalType(''), false);
});
