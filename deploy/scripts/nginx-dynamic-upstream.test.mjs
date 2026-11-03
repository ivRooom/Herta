import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const nginxConfig = readFileSync(new URL('../docker/nginx/default.conf', import.meta.url), 'utf8');

function proxyFor(location) {
  const afterLocation = nginxConfig.split(location)[1];
  assert.ok(afterLocation, `Missing nginx location: ${location}`);
  const firstProxy = afterLocation.match(/proxy_pass\s+([^;]+);/);
  assert.ok(firstProxy, `Missing nginx proxy_pass: ${location}`);
  return firstProxy[1];
}

test('all proxy targets use re-resolvable internal Docker DNS names', () => {
  assert.match(nginxConfig, /^resolver 127\.0\.0\.11 valid=10s ipv6=off;$/m);
  assert.match(nginxConfig, /^resolver_timeout 3s;$/m);
  assert.match(nginxConfig, /^\s+set \$api_backend api:3001;$/m);
  assert.match(nginxConfig, /^\s+set \$studio_backend studio:3000;$/m);
  assert.doesNotMatch(nginxConfig, /^upstream\s+(?:api|studio)\s*\{/m);

  // No trailing slash (or explicit URI) on proxy_pass: Next.js Auth.js and
  // NestJS retain the exact route path and query sent by the client.
  const targets = [...nginxConfig.matchAll(/^\s*proxy_pass\s+([^;\r\n]+);/gm)].map(
    (match) => match[1],
  );
  assert.equal(targets.length, 8);
  assert.equal(targets.filter((target) => target === 'http://$api_backend').length, 5);
  assert.equal(targets.filter((target) => target === 'http://$studio_backend').length, 3);
});

test('existing NestJS and Studio/Auth.js path ownership is preserved', () => {
  for (const path of [
    'location ^~ /api/v1/ {',
    'location = /api/docs {',
    'location ^~ /api/docs/ {',
    'location = /api/docs-json {',
    'location = /api/docs-yaml {',
  ]) {
    assert.equal(proxyFor(path), 'http://$api_backend', path);
  }
  for (const path of ['location ~ "^/api/guilds/', 'location /api/ {', 'location / {']) {
    assert.equal(proxyFor(path), 'http://$studio_backend', path);
  }
});
