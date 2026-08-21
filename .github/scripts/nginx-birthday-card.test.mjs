import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const nginx = readFileSync('deploy/docker/nginx/default.conf', 'utf8');

test('Birthday Card upload endpoints alone receive the larger nginx body limit', () => {
  const birthdayLocation = nginx.match(
    /location ~ "\^\/api\/guilds\/\[0-9\]\{17,20\}\/birthday\/card-\(background\|test\|assets\)\$" \{(?<body>[\s\S]*?)\n    \}/u,
  );

  assert.ok(birthdayLocation?.groups?.body, 'Birthday Card upload location must exist');
  assert.match(birthdayLocation.groups.body, /client_max_body_size 9m;/u);
  assert.match(birthdayLocation.groups.body, /proxy_pass http:\/\/studio;/u);

  const genericApiLocation = nginx.match(/location \/api\/ \{(?<body>[\s\S]*?)\n    \}/u);
  assert.ok(genericApiLocation?.groups?.body, 'generic Studio API location must exist');
  assert.doesNotMatch(
    genericApiLocation.groups.body,
    /client_max_body_size/u,
    'larger request bodies must not be enabled for every Studio API',
  );

  const relaxedRoute = /^\/api\/guilds\/[0-9]{17,20}\/birthday\/card-(background|test|assets)$/u;
  assert.equal(relaxedRoute.test('/api/guilds/12345678901234567/birthday/card-assets'), true);
  assert.equal(
    relaxedRoute.test('/api/guilds/12345678901234567/birthday/card-assets/asset-id'),
    false,
  );
  assert.equal(
    relaxedRoute.test('/api/guilds/12345678901234567/birthday/card-assets/asset-id/content'),
    false,
  );
});
