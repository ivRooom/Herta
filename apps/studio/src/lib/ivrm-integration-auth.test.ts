import assert from 'node:assert/strict';
import test from 'node:test';
import {
  authorizeIvrmIntegrationRequest,
  readIvrmIntegrationConfig,
} from './ivrm-integration-auth.ts';

const TOKEN = '0123456789abcdef0123456789abcdef';
const GUILD_ID = '123456789012345678';

function request(authorization?: string) {
  return new Request('https://herta.ivrm.jp/api/integrations/ivrm/guilds/test/iam', {
    headers: authorization ? { authorization } : undefined,
  });
}

test('readIvrmIntegrationConfig rejects missing or weak configuration', () => {
  assert.equal(readIvrmIntegrationConfig({}), null);
  assert.equal(
    readIvrmIntegrationConfig({
      IVRM_INTEGRATION_TOKEN: 'short-token',
      IVRM_INTEGRATION_GUILD_ID: GUILD_ID,
    }),
    null,
  );
  assert.equal(
    readIvrmIntegrationConfig({
      IVRM_INTEGRATION_TOKEN: TOKEN,
      IVRM_INTEGRATION_GUILD_ID: 'not-a-snowflake',
    }),
    null,
  );
});

test('readIvrmIntegrationConfig trims valid values', () => {
  assert.deepEqual(
    readIvrmIntegrationConfig({
      IVRM_INTEGRATION_TOKEN: ` ${TOKEN} `,
      IVRM_INTEGRATION_GUILD_ID: ` ${GUILD_ID} `,
    }),
    { token: TOKEN, guildId: GUILD_ID },
  );
});

test('authorizeIvrmIntegrationRequest fails closed when integration is unconfigured', () => {
  assert.deepEqual(authorizeIvrmIntegrationRequest(request(), {}), {
    status: 'unconfigured',
  });
});

test('authorizeIvrmIntegrationRequest rejects missing and invalid bearer tokens', () => {
  const environment = {
    IVRM_INTEGRATION_TOKEN: TOKEN,
    IVRM_INTEGRATION_GUILD_ID: GUILD_ID,
  };

  assert.deepEqual(authorizeIvrmIntegrationRequest(request(), environment), {
    status: 'unauthorized',
  });
  assert.deepEqual(
    authorizeIvrmIntegrationRequest(request('Bearer definitely-not-the-token'), environment),
    { status: 'unauthorized' },
  );
  assert.deepEqual(
    authorizeIvrmIntegrationRequest(request(`bearer ${TOKEN}`), environment),
    { status: 'unauthorized' },
  );
});

test('authorizeIvrmIntegrationRequest accepts the configured bearer token', () => {
  const environment = {
    IVRM_INTEGRATION_TOKEN: TOKEN,
    IVRM_INTEGRATION_GUILD_ID: GUILD_ID,
  };

  assert.deepEqual(authorizeIvrmIntegrationRequest(request(`Bearer ${TOKEN}`), environment), {
    status: 'authorized',
    config: { token: TOKEN, guildId: GUILD_ID },
  });
});
