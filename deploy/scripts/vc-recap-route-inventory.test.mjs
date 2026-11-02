import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { VC_RECAP_TRAFFIC_ROUTES } from './vc-recap-restore-traffic-gate.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const inventory = JSON.parse(
  readFileSync(resolve(root, 'deploy/scripts/vc-recap-route-inventory.json'), 'utf8'),
);
const SOURCE_PATH = /^(apps|packages)\/[a-zA-Z0-9_./\[\]-]+\.(?:ts|tsx)$/;
const STATES = new Set(['live', 'dormant', 'planned', 'unresolved']);

function sameKeys(value, expected) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === [...expected].sort().join(',')
  );
}

/**
 * Offline source anchors are NOT enforcement evidence. They detect accidental
 * route-map drift and missing symbols; dynamic dispatch/indirect imports and
 * bypass paths still require independent manual and integration review.
 */
const readRepoFile = (path) => readFileSync(resolve(root, path), 'utf8');

function validateRouteInventory(doc, readSource = readRepoFile) {
  const errors = [];
  if (
    !sameKeys(doc, ['schemaVersion', 'safetyNotice', 'parentIssue', 'routes']) ||
    doc.schemaVersion !== 1 ||
    doc.parentIssue !== 728 ||
    typeof doc.safetyNotice !== 'string' ||
    !doc.safetyNotice.includes('No runtime quarantine') ||
    !Array.isArray(doc.routes)
  ) {
    return ['invalid inventory root or unsafe missing disclaimer'];
  }

  const seen = new Set();
  for (const [index, item] of doc.routes.entries()) {
    if (!sameKeys(item, ['route', 'state', 'evidence', 'gap'])) {
      errors.push(`route[${index}] has an invalid shape`);
      continue;
    }
    if (typeof item.route !== 'string' || !VC_RECAP_TRAFFIC_ROUTES.includes(item.route)) {
      errors.push(`route[${index}] is not in the gate contract`);
      continue;
    }
    if (seen.has(item.route)) errors.push(`duplicate route: ${item.route}`);
    seen.add(item.route);
    if (!STATES.has(item.state)) errors.push(`invalid state: ${item.route}`);
    if (typeof item.gap !== 'string' || item.gap.trim().length < 25) {
      errors.push(`missing unguarded/unknown gap description: ${item.route}`);
    }
    if (!Array.isArray(item.evidence)) {
      errors.push(`missing evidence list: ${item.route}`);
      continue;
    }
    if (['live', 'dormant'].includes(item.state) && item.evidence.length === 0) {
      errors.push(`missing source evidence: ${item.route}`);
    }
    if (['planned', 'unresolved'].includes(item.state) && item.evidence.length > 0) {
      errors.push(`planned or unresolved route requires state review: ${item.route}`);
    }
    const unique = new Set();
    for (const entry of item.evidence) {
      if (
        !sameKeys(entry, ['path', 'symbol']) ||
        typeof entry.path !== 'string' ||
        !SOURCE_PATH.test(entry.path) ||
        entry.path.includes('..') ||
        typeof entry.symbol !== 'string' ||
        entry.symbol.trim().length < 8
      ) {
        errors.push(`invalid source anchor: ${item.route}`);
        continue;
      }
      const key = `${entry.path}\0${entry.symbol}`;
      if (unique.has(key)) errors.push(`duplicate source anchor: ${item.route}`);
      unique.add(key);
      try {
        if (!readSource(entry.path).includes(entry.symbol)) {
          errors.push(`source symbol not found: ${item.route} in ${entry.path}`);
        }
      } catch {
        errors.push(`source file inaccessible: ${item.route} in ${entry.path}`);
      }
    }
  }
  for (const route of VC_RECAP_TRAFFIC_ROUTES) {
    if (!seen.has(route)) errors.push(`unmapped route: ${route}`);
  }
  return errors;
}

test('all 16 traffic gate IDs have audited source or explicit unresolved state', () => {
  assert.equal(VC_RECAP_TRAFFIC_ROUTES.length, 16);
  assert.deepEqual(validateRouteInventory(inventory), []);
  assert.equal(inventory.routes.filter((item) => item.state === 'live').length, 10);
  // A passing test does not demonstrate runtime prevention or bypass-zero.
  assert.equal(
    inventory.routes.some((item) => item.state === 'unresolved'),
    true,
  );
});

test('missing, duplicate and unknown routes are rejected', () => {
  const missing = structuredClone(inventory);
  missing.routes.pop();
  assert.match(validateRouteInventory(missing).join('\n'), /unmapped route/);
  const duplicate = structuredClone(inventory);
  duplicate.routes.push(structuredClone(duplicate.routes[0]));
  assert.match(validateRouteInventory(duplicate).join('\n'), /duplicate route/);
  const unexpected = structuredClone(inventory);
  unexpected.routes[0].route = 'api.unknown-access';
  assert.match(validateRouteInventory(unexpected).join('\n'), /not in the gate contract/);
});

test('stale/missing or untrusted source evidence never passes', () => {
  const stale = structuredClone(inventory);
  stale.routes[0].evidence[0].symbol = 'removedSymbolMustNotMatch(';
  assert.match(validateRouteInventory(stale).join('\n'), /source symbol not found/);
  const absent = structuredClone(inventory);
  absent.routes[0].evidence[0].path = 'apps/bot/src/does-not-exist.ts';
  assert.match(validateRouteInventory(absent).join('\n'), /source file inaccessible/);
  const traversal = structuredClone(inventory);
  traversal.routes[0].evidence[0].path = 'apps/../../secrets.ts';
  assert.match(validateRouteInventory(traversal).join('\n'), /invalid source anchor/);
  const lostEvidence = structuredClone(inventory);
  lostEvidence.routes[0].evidence = [];
  assert.match(validateRouteInventory(lostEvidence).join('\n'), /missing source evidence/);
});

test('no inventory status can claim guard coverage or traffic authorization', () => {
  const falseProtected = structuredClone(inventory);
  falseProtected.routes[0].state = 'guarded';
  assert.match(validateRouteInventory(falseProtected).join('\n'), /invalid state/);
  const missingDisclaimer = structuredClone(inventory);
  missingDisclaimer.safetyNotice = 'all routes safe';
  assert.match(validateRouteInventory(missingDisclaimer).join('\n'), /unsafe missing disclaimer/);
  const shapeChange = structuredClone(inventory);
  shapeChange.routes[0].isProtected = true;
  assert.match(validateRouteInventory(shapeChange).join('\n'), /invalid shape/);
});
