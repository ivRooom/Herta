import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const operationsPageSource = readFileSync(
  new URL('../app/dashboard/plugins/operations/page.tsx', import.meta.url),
  'utf8',
);

function getInventoryMobileCardSource(): string {
  const start = operationsPageSource.indexOf('function InventoryMobileCard');
  const end = operationsPageSource.indexOf('function attentionDetail', start);

  assert.ok(start >= 0, 'InventoryMobileCard should exist');
  assert.ok(end > start, 'InventoryMobileCard should have a stable boundary');

  return operationsPageSource.slice(start, end);
}

test('Plugin Operations keeps separate mobile and desktop inventory views', () => {
  assert.ok(operationsPageSource.includes('className="mt-5 space-y-3 md:hidden"'));
  assert.ok(operationsPageSource.includes('function InventoryMobileCard'));
  assert.ok(operationsPageSource.includes('shadow-card md:block'));
  assert.ok(operationsPageSource.includes('min-w-[960px]'));
});

test('Plugin Operations mobile card exposes only safe inventory metadata', () => {
  const mobileCardSource = getInventoryMobileCardSource();

  assert.ok(mobileCardSource.includes('<StatusBadge status={entry.status} />'));
  assert.ok(mobileCardSource.includes('states={entry.runtimeConsumers}'));
  assert.ok(mobileCardSource.includes('entry.configVersion'));
  assert.ok(mobileCardSource.includes('formatJst(entry.updatedAt)'));
  assert.ok(mobileCardSource.includes('break-all text-[11px] text-muted'));
  assert.doesNotMatch(mobileCardSource, /entry\.config(?!Version)/u);
});

test('Plugin Operations navigation has explicit keyboard focus treatment', () => {
  assert.ok(operationsPageSource.includes('focus-visible:outline-none'));
  assert.ok(operationsPageSource.includes('focus-visible:ring-2'));
  assert.ok(operationsPageSource.includes('focus-visible:ring-ring'));
});
