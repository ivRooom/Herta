import { readFileSync, rmSync, writeFileSync } from 'node:fs';

patchAutomaticRuntime();
patchStudioForm();
rmSync('scripts/apply-moderation-enforcement-safety-fixes.mjs');
rmSync('.github/workflows/apply-moderation-enforcement-safety-fixes.yml');

function patchAutomaticRuntime() {
  const path = 'plugins/moderation/src/automatic-runtime.ts';
  let source = readFileSync(path, 'utf8');

  source = replaceOnce(
    source,
    `type ModerationAutomaticRuntimeContext = PluginRuntimeContext<\n  ModerationConfig,\n  ModerationClient,\n  ModerationPrismaClient\n>;`,
    `type ModerationAutomaticRuntimeContext = PluginRuntimeContext<\n  ModerationConfig,\n  unknown,\n  ModerationPrismaClient\n>;`,
  );

  source = replaceOnce(
    source,
    `): PluginEventHandler<ModerationConfig, ModerationClient, ModerationPrismaClient>[] {\n  const config = normalizeModerationConfig(context.config);\n  const events: PluginEventHandler<ModerationConfig, ModerationClient, ModerationPrismaClient>[] = [`,
    `): PluginEventHandler<ModerationConfig, unknown, ModerationPrismaClient>[] {\n  const config = normalizeModerationConfig(context.config);\n  const events: PluginEventHandler<ModerationConfig, unknown, ModerationPrismaClient>[] = [`,
  );

  source = source.replaceAll('context.client.user?.id', 'getBotActorId(context.client)');

  source = replaceOnce(
    source,
    `    assertAutomaticTargetCanBeModerated(message, selected.policy);\n    await executeAutomaticDiscordAction(message, selected.policy, reason);\n    if (action === 'blacklist') {\n      await upsertModerationBlacklistEntry(context.prisma, {\n        guildId: context.guildId,\n        userId: message.author.id,\n        reason,\n        originDetectionId: selected.detectionId,\n        createdBy: actorId,\n      });\n    }`,
    `    assertAutomaticTargetCanBeModerated(message, selected.policy);\n    if (action === 'blacklist') {\n      await upsertModerationBlacklistEntry(context.prisma, {\n        guildId: context.guildId,\n        userId: message.author.id,\n        reason,\n        originDetectionId: selected.detectionId,\n        createdBy: actorId,\n      });\n    }\n    await executeAutomaticDiscordAction(message, selected.policy, reason);`,
  );

  source = replaceOnce(
    source,
    `function sanitizeExcerpt(content: string): string {`,
    `function getBotActorId(client: unknown): string | null {\n  if (typeof client !== 'object' || client === null || !('user' in client)) return null;\n  const user = (client as ModerationClient).user;\n  return typeof user?.id === 'string' && /^\\d+$/.test(user.id) ? user.id : null;\n}\n\nfunction sanitizeExcerpt(content: string): string {`,
  );

  writeFileSync(path, source);
}

function patchStudioForm() {
  const path = 'apps/studio/src/components/moderation-enforcement-form.tsx';
  let source = readFileSync(path, 'utf8');
  source = replaceOnce(
    source,
    `import { useMemo, useState } from 'react';`,
    `import { useMemo, useState, type ReactNode } from 'react';`,
  );
  source = replaceOnce(source, `  children: React.ReactNode;`, `  children: ReactNode;`);
  writeFileSync(path, source);
}

function replaceOnce(source, before, after) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`置換対象が見つかりません: ${before.slice(0, 120)}`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`置換対象が複数あります: ${before.slice(0, 120)}`);
  }
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}
