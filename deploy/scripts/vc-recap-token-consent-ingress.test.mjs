import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Offline source-only call-edge assertions. NEVER authorize or block runtime traffic.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const files = Object.freeze({
  bot: 'apps/bot/src/bot.ts',
  button: 'apps/bot/src/voice/vc-recap-consent-interaction.ts',
  page: 'apps/studio/src/app/consent/[token]/page.tsx',
  legacyPost: 'apps/studio/src/app/api/consent/[token]/route.ts',
  longTermPost: 'apps/studio/src/app/api/consent/[token]/long-term/route.ts',
});
const sources = Object.fromEntries(
  Object.entries(files).map(([key, path]) => [key, readFileSync(resolve(root, path), 'utf8')]),
);

function ordered(source, fragments) {
  let offset = 0;
  for (const fragment of fragments) {
    const at = source.indexOf(fragment, offset);
    if (at < 0) return false;
    offset = at + fragment.length;
  }
  return true;
}


/** Source-shape drift checks only: these patterns do not execute consent handlers. */
const OWNER_REFUSAL =
  /if\s*\(\s*interaction\.user\.id\s*!==\s*parsed\.userId\s*\)\s*\{\s*await interaction\.reply\(\{\s*content:[^\n]+,\s*flags:\s*MessageFlags\.Ephemeral,\s*\}\);\s*return;\s*\}/;
const ORIGIN_REFUSAL =
  /if\s*\(\s*!isSameOriginMutationRequest\(request\)\s*\)\s*\{\s*return json\(\{\s*error:\s*'[^']+'\s*\},\s*403\);\s*\}/;

function deniesBefore(source, denialBranch, protectedCall) {
  const match = denialBranch.exec(source);
  const actionAt = source.indexOf(protectedCall);
  return match?.index !== undefined && actionAt >= 0 && match.index < actionAt;
}

function audit(input) {
  const errors = [];
  if (
    !ordered(input.bot, [
      'interaction.isButton() && interaction.customId.startsWith(CONSENT_CUSTOM_ID_PREFIX)',
      'await handleConsentButton(interaction, this.prisma, this.logger);',
    ])
  ) {
    errors.push('Discord button dispatch');
  }

  if (
    !ordered(input.button, [
      'parseConsentCustomId(interaction.customId)',
      'interaction.user.id !== parsed.userId',
      "if (parsed.action === 'web')",
      'buildConsentWebLinkMessage(prisma, parsed.userId, logger)',
      "const consent = parsed.action === 'yes';",
      'await setVoiceTranscriptionConsent(',
      'if (!consent) revokeVcRecapConsent(parsed.userId);',
    ]) ||
    !deniesBefore(input.button, OWNER_REFUSAL, "if (parsed.action === 'web')")
  ) {
    errors.push('Discord button owner and grant/revoke branches');
  }

  if (
    !ordered(input.page, [
      'resolveVoiceConsentAccess(prisma, token)',
      'getUserDataConsent(prisma, access.userId)',
      'getVcRecapLongTermConsentView(prisma, access.userId)',
      '<VoiceConsentForm',
      '<LongTermConsentForm',
    ])
  ) {
    errors.push('token page owner read paths');
  }

  if (
    !ordered(input.legacyPost, [
      'isSameOriginMutationRequest(request)',
      'resolveVoiceConsentAccess(prisma, token)',
      "typeof consent !== 'boolean'",
      'setVoiceTranscriptionConsent(prisma, access.userId, consent',
    ]) ||
    !deniesBefore(input.legacyPost, ORIGIN_REFUSAL, 'const { token } = await params;')
  ) {
    errors.push('token 30-day POST origin, owner, grant/revoke');
  }

  if (
    !ordered(input.longTermPost, [
      'isSameOriginMutationRequest(request)',
      'resolveVoiceConsentAccess(prisma, token)',
      "payload['policyVersion'] !== VC_RECAP_LONG_TERM_CONSENT_VERSION",
      'updateVcRecapLongTermConsentChoices(prisma, access.userId',
      "case 'erasure_requested':",
    ]) ||
    !deniesBefore(input.longTermPost, ORIGIN_REFUSAL, 'const { token } = await params;')
  ) {
    errors.push('token three-purpose POST policy, owner, erasure');
  }
  return errors;
}

test('all persistent button and bearer-token consent call edges remain inventoried', () => {
  assert.deepEqual(audit(sources), []);
});

// Preserve mutation fixture layout for source-drift tests.
// prettier-ignore
test('owner dispatch, origin, policy version and revocation path drift is rejected', () => {
  for (const [file, from, to, error] of [
    [
      'bot',
      'await handleConsentButton(interaction, this.prisma, this.logger);',
      'void 0;',
      /Discord button dispatch/,
    ],
    ['button', 'interaction.user.id !== parsed.userId', 'false', /Discord button owner/],
    [
      'button',
      'if (interaction.user.id !== parsed.userId) {',
      'if (false && interaction.user.id !== parsed.userId) {',
      /Discord button owner/,
    ],
    [
      'button',
      '    return;\n  }\n\n  if (parsed.action === \'web\')',
      '    void 0;\n  }\n\n  if (parsed.action === \'web\')',
      /Discord button owner/,
    ],
    [
      'button',
      'if (!consent) revokeVcRecapConsent(parsed.userId);',
      'void 0;',
      /Discord button owner/,
    ],
    [
      'page',
      'getVcRecapLongTermConsentView(prisma, access.userId)',
      'ignored()',
      /token page/,
    ],
    ['legacyPost', 'isSameOriginMutationRequest(request)', 'true', /token 30-day POST/],
    [
      'legacyPost',
      'if (!isSameOriginMutationRequest(request)) {',
      'if (isSameOriginMutationRequest(request)) {',
      /token 30-day POST/,
    ],
    [
      'longTermPost',
      "payload['policyVersion'] !== VC_RECAP_LONG_TERM_CONSENT_VERSION",
      'false',
      /token three-purpose POST/,
    ],
    [
      'longTermPost',
      'if (!isSameOriginMutationRequest(request)) {',
      'if (isSameOriginMutationRequest(request)) {',
      /token three-purpose POST/,
    ],
  ]) {
    assert.ok(sources[file].includes(from), `missing source fixture for ${file}`);
    assert.match(audit({ ...sources, [file]: sources[file].replace(from, to) }).join('\n'), error);
  }
});
