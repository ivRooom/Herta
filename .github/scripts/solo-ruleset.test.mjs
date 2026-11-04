import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rules = JSON.parse(readFileSync(new URL('../rulesets/main-solo-maintainer.json', import.meta.url), 'utf8'));
const ci = readFileSync(new URL('../workflows/ci.yml', import.meta.url), 'utf8');

test('solo maintainer protection only targets main and disallows bypass', () => {
  assert.equal(rules.target, 'branch');
  assert.equal(rules.enforcement, 'active');
  assert.deepEqual(rules.bypass_actors, []);
  assert.deepEqual(rules.conditions.ref_name.include, ['refs/heads/main']);
  assert.deepEqual(rules.conditions.ref_name.exclude, []);
  const types = rules.rules.map(({ type }) => type);
  for (const required of ['deletion', 'non_fast_forward', 'required_linear_history', 'pull_request', 'required_status_checks']) {
    assert.ok(types.includes(required), required);
  }
});

test('solo ruleset uses pull requests and avoids impossible self-approval', () => {
  const pr = rules.rules.find(({ type }) => type === 'pull_request').parameters;
  assert.equal(pr.required_approving_review_count, 0);
  assert.equal(pr.require_code_owner_review, false);
  assert.equal(pr.require_last_push_approval, false);
  assert.equal(pr.required_review_thread_resolution, true);
  assert.deepEqual(pr.allowed_merge_methods, ['squash']);
});

test('strict required CI jobs must exist and run for every PR to main', () => {
  const checks = rules.rules.find(({ type }) => type === 'required_status_checks').parameters;
  assert.equal(checks.strict_required_status_checks_policy, true);
  const names = checks.required_status_checks.map(({ context }) => context);
  assert.deepEqual(names, [
    'Format / Lint / Typecheck / Test / Build',
    'ARM64 Production Image / Node / Grype',
  ]);
  assert.match(ci, /on:\s*\n\s*push:/);
  assert.match(ci, /\n\s*pull_request:\s*\n\s*branches:\s*\[main, develop\]/);
  assert.doesNotMatch(ci.split('\npermissions:')[0], /\n\s*paths:/);
  for (const name of names) assert.ok(ci.includes('name: ' + name), name);
});
