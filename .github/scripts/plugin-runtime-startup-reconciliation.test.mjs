import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const reconciliation = await readFile(
  'apps/bot/src/plugins/runtime-startup-reconciliation.ts',
  'utf8',
);
const runtimeState = await readFile('apps/bot/src/plugins/runtime-state.ts', 'utf8');
const sync = await readFile('apps/bot/src/plugins/sync.ts', 'utf8');
const auditLogs = await readFile('apps/studio/src/lib/audit-logs.ts', 'utf8');

assert.match(reconciliation, /plugin\.runtime_apply_succeeded/);
assert.match(reconciliation, /bot-runtime-startup-recovery/);
assert.match(reconciliation, /metadata:[\s\S]*path: \['configVersion'\]/);
assert.match(reconciliation, /targetId: \{ in: targets\.map/);
assert.match(reconciliation, /errorName: resolveErrorName\(error\)/);
assert.match(reconciliation, /isConfigurationLoaded\(guildId\)/);
assert.match(reconciliation, /resetPluginRuntimeStartupReconciliation/);
assert.match(reconciliation, /startupReconciliationEpochs/);
assert.doesNotMatch(reconciliation, /metadata:[\s\S]*config:/);
assert.match(runtimeState, /isTargetApplied/);
assert.match(runtimeState, /isConfigurationLoaded/);
assert.match(sync, /reconcilePluginRuntimeStartupOnce/);
assert.match(sync, /Events\.GuildDelete/);
assert.match(sync, /resetPluginRuntimeStartupReconciliation\(guild\.id\)/);
assert.match(sync, /WeakSet<Client>/);
assert.match(auditLogs, /Bot Runtime Recovery/);
assert.match(auditLogs, /booleanValue\(metadata\?\.\['recovery'\]\) === true/);
assert.match(auditLogs, /起動時の再同期でPlugin Runtime設定の復旧を確認しました/);

console.log('plugin runtime startup reconciliation contract checks passed');
