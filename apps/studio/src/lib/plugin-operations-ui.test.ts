import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const operationsPageSource = readFileSync(
  new URL('../app/dashboard/plugins/operations/page.tsx', import.meta.url),
  'utf8',
);

test('Plugin Operations inventory keeps separate mobile cards and desktop table views', () => {
  assert.match(operationsPageSource, /className="mt-5 space-y-3 md:hidden"/u);
  assert.match(operationsPageSource, /function InventoryMobileCard/u);
  assert.match(
    operationsPageSource,
    /className="mt-5 hidden overflow-hidden rounded-2xl border border-border bg-surface shadow-card md:block"/u,
  );
  assert.match(
    operationsPageSource,
    /<table className="w-full min-w-\[960px\] text-left text-sm">/u,
  );
});

test('Plugin Operations mobile cards expose the same safe inventory metadata', () => {
  assert.match(operationsPageSource, /<StatusBadge status=\{entry\.status\} \/>/u);
  assert.match(
    operationsPageSource,
    /<RuntimeConsumerBadges states=\{entry\.runtimeConsumers\} \/>/u,
  );
  assert.match(operationsPageSource, /configVersion/u);
  assert.match(operationsPageSource, /formatJst\(entry\.updatedAt\)/u);
  assert.match(operationsPageSource, /break-all text-\[11px\] text-muted/u);
  assert.doesNotMatch(operationsPageSource, /JSON\.stringify\(entry\.config/u);
});

test('Plugin Operations navigation has explicit keyboard focus treatment', () => {
  assert.match(
    operationsPageSource,
    /focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2/u,
  );
});
