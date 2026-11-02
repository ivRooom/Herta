import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Offline source-call-edge inspection, NOT an operational restore authority.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const files = {
  privacy: 'apps/bot/src/commands/privacy.ts',
  plugin: 'apps/bot/src/plugins/vc-recap.ts',
  manifest: 'packages/plugin-catalog/src/manifests/vc-recap.ts',
  session: 'apps/bot/src/voice/vc-recap-session-manager.ts',
  consent: 'apps/studio/src/app/api/guilds/[guildId]/vc-recap/consent/route.ts',
  export: 'apps/studio/src/app/api/guilds/[guildId]/vc-recap/export/route.ts',
};
const sources = Object.fromEntries(
  Object.entries(files).map(([key, path]) => [key, readFileSync(resolve(root, path), 'utf8')]),
);
const privacyHandlers = {
  'voice-consent': 'executeVoiceConsent',
  'openai-audio-consent': 'executeOpenAiAudioConsent',
  'web-link': 'executeWebLink',
  'delete-voice-data': 'executeDeleteVoiceData',
  export: 'executeExport',
};
const voiceHandlers = {
  start: 'executeStart',
  stop: 'executeStop',
  list: 'executeList',
};

function between(text, start, end) {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  return from >= 0 && to > from ? text.slice(from, to) : '';
}

function ordered(text, parts) {
  let position = 0;
  for (const part of parts) {
    const found = text.indexOf(part, position);
    if (found < 0) return false;
    position = found + part.length;
  }
  return true;
}

function sameSet(found, expected) {
  return (
    found.length === expected.length &&
    new Set(found).size === found.length &&
    [...found].sort().join('|') === [...expected].sort().join('|')
  );
}

function checkDispatch(declared, source, expected, pattern, error, errors) {
  const pairs = [...source.matchAll(pattern)].map((match) => [match[1], match[2]]);
  if (
    !sameSet(declared, Object.keys(expected)) ||
    !sameSet(
      pairs.map((item) => item[0]),
      Object.keys(expected),
    ) ||
    pairs.some(([name, handler]) => expected[name] !== handler)
  ) {
    errors.push(error);
  }
}

function audit(input) {
  const errors = [];
  const privacyDefs = between(input.privacy, 'subcommands: [', '  async execute(interaction) {');
  const definedPrivacy = [...privacyDefs.matchAll(/^ {8}name: '([^']+)'/gm)].map((m) => m[1]);
  const privacyDispatch = input.privacy.slice(
    input.privacy.indexOf('  async execute(interaction) {'),
  );
  checkDispatch(
    definedPrivacy,
    privacyDispatch,
    privacyHandlers,
    /if \(subcommand === '([^']+)'\) \{\s*await (\w+)\(interaction\);\s*return;\s*\}/g,
    'privacy dispatch/registration drift',
    errors,
  );
  const erased = between(
    input.privacy,
    'async function executeDeleteVoiceData(',
    'async function executeWebLink(',
  );
  if (
    !ordered(erased, [
      'await requestVcRecapErasure(prisma, interaction.user.id);',
      'revokeVcRecapConsent(interaction.user.id);',
      'await deleteUserVoiceData(prisma, interaction.user.id);',
      'await setVoiceTranscriptionConsent(prisma, interaction.user.id, false);',
    ])
  ) {
    errors.push('privacy erasure ordering drift');
  }

  const grant = between(
    input.privacy,
    'async function executeVoiceConsent(',
    'async function executeOpenAiAudioConsent(',
  );
  if (
    !ordered(grant, [
      "interaction.options.getBoolean('consent', true)",
      'await setVoiceTranscriptionConsent(',
      'if (!consent) revokeVcRecapConsent(interaction.user.id);',
    ])
  ) {
    errors.push('privacy consent grant/withdrawal branch drift');
  }

  const personalExport = between(
    input.privacy,
    'async function executeExport(',
    'export const privacyCommand:',
  );
  if (
    !ordered(personalExport, [
      'await interaction.deferReply(',
      'listVcRecapSessionsForUser(prisma, interaction.user.id)',
      'listVcRecapTranscriptSegmentsForUser(prisma, interaction.user.id)',
      'Buffer.from(JSON.stringify(exportPayload, null, 2)',
      'files: [attachment]',
    ])
  ) {
    errors.push('privacy personal export call edge drift');
  }

  const names = [...input.manifest.matchAll(/^ {10}name: '([^']+)'/gm)].map((m) => m[1]);
  checkDispatch(
    names,
    input.plugin,
    voiceHandlers,
    /if \(subcommand === '([^']+)'\) \{\s*await (\w+)\(context, interaction\);\s*return;\s*\}/g,
    'voice manifest/dispatch drift',
    errors,
  );
  const lifecycle = between(
    input.plugin,
    'async function handleVoiceStateUpdate(',
    'export const vcRecapPlugin =',
  );
  const disabled = between(
    input.plugin,
    'async onDisable(context) {',
    '  provideCommands(context) {',
  );
  const stopCall = 'await stopVcRecap(context.prisma, context.logger, context.guildId)';
  if (
    !lifecycle.includes(stopCall) ||
    !disabled.includes(stopCall) ||
    !input.plugin.includes("event: 'voiceStateUpdate'") ||
    !input.plugin.includes(
      'await handleVoiceStateUpdate(context, args[0] as VoiceState, args[1] as VoiceState)',
    )
  ) {
    errors.push('voice non-slash lifecycle stop edge drift');
  }
  const stop = between(
    input.session,
    'export async function stopVcRecap(',
    'async function settleWithin(',
  );
  if (
    !ordered(stop, [
      'listVcRecapTranscriptSegments(prisma, session.sessionId)',
      'summarizeVcRecapSession(prisma, guildId, segments)',
    ])
  ) {
    errors.push('voice stop downstream transcript/summary edge drift');
  }

  const transcriber = between(
    input.session,
    'async function transcribeSpeaker(',
    'function downmixStereoToMono(',
  );
  for (const [name, call] of Object.entries({
    aws: 'await transcribePcmStream(',
    local: 'await transcribePcmWithLocalWhisper(',
    openai: 'await transcribePcmWithOpenAi(',
  })) {
    if (!transcriber.includes(call)) errors.push('voice missing ' + name + ' provider');
  }
  if (
    !transcriber.includes('appendVcRecapTranscriptSegment(prisma, segmentInput)') ||
    !transcriber.includes('appendVcRecapLocalWhisperSegmentIfConsented(prisma, segmentInput)') ||
    !transcriber.includes('hasVcRecapOpenAiAudioConsent(prisma, userId)')
  ) {
    errors.push('voice consent/write call edge drift');
  }

  const consentRead = between(
    input.consent,
    'export async function GET(',
    'export async function POST(',
  );
  const consentWrite = input.consent.slice(input.consent.indexOf('export async function POST('));
  if (
    !ordered(consentRead, [
      'await auth()',
      'resolveStudioAccess(guildId, session.user.id)',
      'hasEffectivePluginPermission(',
      'getGuildMemberById(guildId, userId)',
      'getUserDataConsent(prisma, userId)',
    ]) ||
    consentRead.includes('setVoiceConsentAsAdmin(')
  ) {
    errors.push('studio consent GET read/access edge drift');
  }
  if (
    !ordered(consentWrite, [
      'await auth()',
      'isSameOriginMutationRequest(request)',
      'resolveStudioAccess(guildId, session.user.id)',
      'hasEffectivePluginPermission(',
      'getGuildMemberById(guildId, userId)',
      'setVoiceConsentAsAdmin(prisma, { guildId, actorId: session.user.id, userId, consent })',
    ])
  ) {
    errors.push('studio consent POST write/access edge drift');
  }

  const exported = input.export.slice(input.export.indexOf('export async function GET('));
  if (
    !ordered(exported, [
      'await auth()',
      'resolveStudioAccess(guildId, session.user.id)',
      'hasExplicitVcRecapExportPermission(access.access, guildId)',
      'parseVcRecapExportFilters(',
      'prisma.vcRecapTranscriptSegment.findMany({',
      'prisma.userDataConsent.findMany({',
      'const permitted = new Set(',
      'filter((row) => permitted.has(row.userId))',
      'await prisma.auditLog.create({',
      'serializeVcRecapCsv(records, now)',
      'toVcRecapExportObject(records, now)',
    ])
  ) {
    errors.push('studio export authorization/consent/audit/output drift');
  }
  return errors;
}

test('source call edges for all known Privacy/VC ingress remain accounted for', () => {
  assert.deepEqual(audit(sources), []);
});

test('new or redirected privacy command is blocked by audit', () => {
  const introduced = sources.privacy.replace(
    "        name: 'export',",
    "        name: 'unreviewed-vc',\n      },\n      {\n        name: 'export',",
  );
  assert.match(audit({ ...sources, privacy: introduced }).join('\n'), /privacy dispatch/);
  const changed = sources.privacy.replace(
    'await executeExport(interaction);',
    'await executeWebLink(interaction);',
  );
  assert.match(audit({ ...sources, privacy: changed }).join('\n'), /privacy dispatch/);
});

test('erasure order, owner consent and privacy export drift fail audit', () => {
  for (const [find, replacement, expected] of [
    [
      'await requestVcRecapErasure(prisma, interaction.user.id);',
      'await skipErasure();',
      /erasure ordering/,
    ],
    [
      'if (!consent) revokeVcRecapConsent(interaction.user.id);',
      'if (consent) revokeVcRecapConsent(interaction.user.id);',
      /grant\/withdrawal/,
    ],
    [
      'listVcRecapTranscriptSegmentsForUser(prisma, interaction.user.id)',
      'skipTranscriptExport()',
      /personal export/,
    ],
  ]) {
    assert.match(
      audit({ ...sources, privacy: sources.privacy.replace(find, replacement) }).join('\n'),
      expected,
    );
  }
});

test('voice state auto stop and all transcriber providers remain inventoried', () => {
  const changed = sources.plugin.replace(
    'await handleVoiceStateUpdate(context, args[0] as VoiceState, args[1] as VoiceState)',
    'void 0',
  );
  assert.match(audit({ ...sources, plugin: changed }).join('\n'), /lifecycle stop/);
  const provider = sources.session.replace(
    'await transcribePcmWithOpenAi(',
    'await unreviewedProvider(',
  );
  assert.match(audit({ ...sources, session: provider }).join('\n'), /missing openai provider/);
});

test('Studio permission, consent filter, audit and GET/POST separation cannot drift', () => {
  for (const token of [
    'hasExplicitVcRecapExportPermission(access.access, guildId)',
    'prisma.userDataConsent.findMany({',
    'await prisma.auditLog.create({',
  ]) {
    assert.match(
      audit({ ...sources, export: sources.export.replace(token, 'unreviewed()') }).join('\n'),
      /studio export/,
    );
  }
  const post = sources.consent.replace('isSameOriginMutationRequest(request)', 'true');
  assert.match(audit({ ...sources, consent: post }).join('\n'), /studio consent POST/);
});
