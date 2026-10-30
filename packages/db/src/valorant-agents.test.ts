import assert from 'node:assert/strict';
import test from 'node:test';
import { validateValorantAgent } from './valorant-agents.js';

test('agent validation rejects cross-guild fields, unsafe IDs, controls, long/empty names and non-booleans', () => {
  const agent = { agentId: 'kay-o', agentName: 'KAY/O', displayName: 'KAY/O', enabled: true };
  assert.deepEqual(validateValorantAgent(agent), agent);
  for (const patch of [
    { guildId: 'other' },
    { agentId: '../bad' },
    { displayName: '\n' },
    { agentName: 'x'.repeat(51) },
    { enabled: 'true' },
    { displayName: 'x\u200by' },
  ]) {
    assert.throws(() => validateValorantAgent({ ...agent, ...patch }));
  }
});
