import assert from 'node:assert/strict';
import test from 'node:test';
import { parseStoredRuleStudioView, validateRuleStudioDraft } from './rule-studio.ts';

const baseDraft = {
  name: 'Hourly Event Role',
  description: 'schedule v1',
  enabled: true,
  priority: 10,
  triggerType: 'schedule.minute' as const,
  everyMinutes: 60,
  offsetMinutes: 0,
  conditionHour: null,
  actionType: 'discord.role.create' as const,
  roleName: 'Event Role',
  roleColor: 0x5865f2,
  expiresAfterSeconds: 3600,
  roleId: '',
  cooldownMs: 0,
  maxExecutions: null,
};

test('valid schedule create rule is normalized', () => {
  const result = validateRuleStudioDraft(baseDraft);
  assert.equal(result.valid, true);
  if (!result.valid) return;
  assert.deepEqual(result.definition.trigger, {
    type: 'schedule.minute',
    config: { everyMinutes: 60, offsetMinutes: 0 },
  });
  assert.equal(result.definition.actions[0]?.type, 'discord.role.create');
});

test('member.joined rule is normalized without schedule-only config', () => {
  const result = validateRuleStudioDraft({
    ...baseDraft,
    triggerType: 'member.joined',
    everyMinutes: 0,
    offsetMinutes: -1,
    conditionHour: null,
  });
  assert.equal(result.valid, true);
  if (!result.valid) return;
  assert.deepEqual(result.definition.trigger, { type: 'member.joined', config: {} });
  assert.deepEqual(result.definition.conditions, []);
});

test('member.joined rejects schedule-only UTC condition', () => {
  const result = validateRuleStudioDraft({
    ...baseDraft,
    triggerType: 'member.joined',
    conditionHour: 12,
  });
  assert.equal(result.valid, false);
});

test('member.joined stored rule is exposed as editable', () => {
  const result = parseStoredRuleStudioView({
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Join event',
    description: null,
    enabled: true,
    priority: 0,
    schemaVersion: 1,
    trigger: { type: 'member.joined', config: {} },
    conditions: [],
    actions: [{ type: 'discord.role.create', config: { roleName: 'joined', roleColor: 0 } }],
    cooldownMs: 0,
    maxExecutions: null,
    executionCount: 0,
    updatedAt: new Date('2026-08-17T00:00:00.000Z'),
  });
  assert.equal(result?.triggerType, 'member.joined');
});

test('member.joined accepts event-bound member role add action', () => {
  const result = validateRuleStudioDraft({
    ...baseDraft,
    triggerType: 'member.joined',
    actionType: 'discord.member.role.add',
    roleId: '72345678901234567',
  });
  assert.equal(result.valid, true);
  if (!result.valid) return;
  assert.deepEqual(result.definition.actions, [
    { type: 'discord.member.role.add', config: { roleId: '72345678901234567' } },
  ]);
});

test('member role add rejects schedule trigger', () => {
  const result = validateRuleStudioDraft({
    ...baseDraft,
    actionType: 'discord.member.role.add',
    roleId: '72345678901234567',
  });
  assert.equal(result.valid, false);
});

test('member role add requires a Discord role id', () => {
  const result = validateRuleStudioDraft({
    ...baseDraft,
    triggerType: 'member.joined',
    actionType: 'discord.member.role.add',
    roleId: 'invalid',
  });
  assert.equal(result.valid, false);
});

test('stored member role add rule is exposed as editable', () => {
  const result = parseStoredRuleStudioView({
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Join role',
    description: null,
    enabled: true,
    priority: 0,
    schemaVersion: 1,
    trigger: { type: 'member.joined', config: {} },
    conditions: [],
    actions: [{ type: 'discord.member.role.add', config: { roleId: '72345678901234567' } }],
    cooldownMs: 0,
    maxExecutions: null,
    executionCount: 0,
    updatedAt: new Date('2026-08-17T00:00:00.000Z'),
  });
  assert.equal(result?.actionType, 'discord.member.role.add');
  assert.equal(result?.roleId, '72345678901234567');
});

test('offset must be smaller than schedule interval', () => {
  const result = validateRuleStudioDraft({ ...baseDraft, everyMinutes: 5, offsetMinutes: 5 });
  assert.equal(result.valid, false);
});

test('arbitrary actions fail closed', () => {
  const result = validateRuleStudioDraft({ ...baseDraft, actionType: 'discord.guild.delete' });
  assert.equal(result.valid, false);
});

test('delete action requires a Discord role id', () => {
  const result = validateRuleStudioDraft({
    ...baseDraft,
    actionType: 'discord.role.delete',
    roleId: 'abc',
  });
  assert.equal(result.valid, false);
});

test('unsupported stored rule is not exposed as editable', () => {
  const result = parseStoredRuleStudioView({
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Unsupported',
    description: null,
    enabled: true,
    priority: 0,
    schemaVersion: 1,
    trigger: { type: 'message.created', config: {} },
    conditions: [],
    actions: [{ type: 'discord.role.create', config: { roleName: 'x', roleColor: 0 } }],
    cooldownMs: 0,
    maxExecutions: null,
    executionCount: 0,
    updatedAt: new Date('2026-08-17T00:00:00.000Z'),
  });
  assert.equal(result, null);
});
