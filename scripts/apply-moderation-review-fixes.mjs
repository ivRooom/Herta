import { readFileSync, rmSync, writeFileSync } from 'node:fs';

patchBot();
patchRuntime();
rmSync('scripts/apply-moderation-review-fixes.mjs');
rmSync('.github/workflows/apply-moderation-review-fixes.yml');

function patchBot() {
  const path = 'apps/bot/src/bot.ts';
  let source = readFileSync(path, 'utf8');
  source = replaceOnce(
    source,
    `  if (guildMembersIntentEnabled()) {\n    intents.push(GatewayIntentBits.GuildMembers);\n    logger.info('Moderationブラックリスト再参加監視用Guild Members Intentを有効化します');\n  }\n  return intents;`,
    `  if (guildMembersIntentEnabled()) {\n    intents.push(GatewayIntentBits.GuildMembers);\n    logger.info('Moderationブラックリスト再参加監視用Guild Members Intentを有効化します');\n  } else {\n    logger.warn(\n      'DISCORD_ENABLE_GUILD_MEMBERS_INTENTが無効なためブラックリスト再参加BANは実行されません',\n    );\n  }\n  return intents;`,
  );
  writeFileSync(path, source);
}

function patchRuntime() {
  const path = 'plugins/moderation/src/automatic-runtime.ts';
  let source = readFileSync(path, 'utf8');

  source = replaceOnce(
    source,
    `  getActiveModerationBlacklistEntry,\n  getModerationDetectionIdForFinding,`,
    `  getActiveModerationBlacklistEntry,\n  getModerationDetectionIdForFinding,\n  hasActiveModerationBlacklistEntries,`,
  );

  source = replaceOnce(
    source,
    `    if (enforcementConfig.autoAlertChannelId) {\n      await sendUrgentAlert(context, message, selected, allFindings, true, actionError).catch(\n        (error) => {\n          context.logger.warn({ err: error }, '自動Moderation失敗Alertの送信に失敗しました');\n        },\n      );\n    }`,
    `    if (\n      enforcementConfig.autoAlertChannelId &&\n      shouldSendAlert(\n        context.guildId,\n        message.author.id,\n        \`failed:\${selected.policy.selector}\`,\n        enforcementConfig.autoAlertCooldownSeconds,\n      )\n    ) {\n      await sendUrgentAlert(context, message, selected, allFindings, true, actionError).catch(\n        (error) => {\n          context.logger.warn({ err: error }, '自動Moderation失敗Alertの送信に失敗しました');\n        },\n      );\n    }`,
  );

  source = source.replaceAll(
    'await sendAutomaticWarning(message, policy, reason);',
    'await sendAutomaticWarning(message, policy);',
  );

  source = replaceOnce(
    source,
    `async function sendAutomaticWarning(\n  message: ModerationMessage,\n  policy: AutomaticEnforcementPolicy,\n  reason: string,\n): Promise<void> {\n  const content =\n    policy.warningMessage ??\n    \`このサーバーでルール違反の可能性があるメッセージを検知しました。\\n\${reason}\`;\n  await message.author.send({ content, allowedMentions: { parse: [] } });\n}`,
    `async function sendAutomaticWarning(\n  message: ModerationMessage,\n  policy: AutomaticEnforcementPolicy,\n): Promise<void> {\n  const content =\n    policy.warningMessage ??\n    'このサーバーでルール違反の可能性があるメッセージを検知しました。詳細はサーバーのモデレーターへお問い合わせください。';\n  await message.author.send({ content, allowedMentions: { parse: [] } });\n}`,
  );

  source = replaceOnce(
    source,
    `  if (\n    (action === 'delete' || action === 'warn_delete') &&\n    !bot.permissions.has(MANAGE_MESSAGES_PERMISSION)\n  ) {\n    throw new Error('Botにメッセージ管理権限がありません');\n  }\n  if (\n    action === 'warn' ||`,
    `  if (\n    (action === 'delete' || action === 'warn_delete') &&\n    !bot.permissions.has(MANAGE_MESSAGES_PERMISSION)\n  ) {\n    throw new Error('Botにメッセージ管理権限がありません');\n  }\n  if ((action === 'delete' || action === 'warn_delete') && message.deletable === false) {\n    throw new Error('対象メッセージを削除できません');\n  }\n  if (\n    action === 'warn' ||`,
  );

  source = replaceOnce(
    source,
    `  if (member.user.bot) return;\n  const entry = await getActiveModerationBlacklistEntry(context.prisma, context.guildId, member.id);\n  if (!entry) return;\n  const actorId = getBotActorId(context.client);\n  if (!actorId) return;\n  const reason = entry.reason ?? 'Hertaブラックリストに登録されています';\n  try {\n    if (member.bannable === false) throw new Error('対象ユーザーをBANできません');\n    await member.ban({ reason });\n    await recordModerationAutomaticEventAudit(context.prisma, {\n      guildId: context.guildId,\n      actorId,\n      event: 'moderation.blacklist.rejoin_ban',\n      targetUserId: member.id,\n      detectionId: entry.originDetectionId,\n      metadata: { blacklistCreatedAt: entry.createdAt.toISOString() },\n      severity: 'critical',\n    });\n  } catch (error) {\n    context.logger.error(\n      { err: error, guildId: context.guildId, targetUserId: member.id },\n      'ブラックリスト対象ユーザーの再参加BANに失敗しました',\n    );\n  }`,
    `  if (member.user.bot) return;\n  if (!(await hasActiveModerationBlacklistEntries(context.prisma, context.guildId))) return;\n  const entry = await getActiveModerationBlacklistEntry(context.prisma, context.guildId, member.id);\n  if (!entry) return;\n  const actorId = getBotActorId(context.client);\n  if (!actorId) {\n    context.logger.error(\n      { guildId: context.guildId, targetUserId: member.id },\n      'Bot User IDを取得できずブラックリスト再参加BANを中止しました',\n    );\n    return;\n  }\n  const reason = entry.reason ?? 'Hertaブラックリストに登録されています';\n  try {\n    if (member.bannable === false) throw new Error('対象ユーザーをBANできません');\n    await member.ban({ reason });\n  } catch (error) {\n    context.logger.error(\n      { err: error, guildId: context.guildId, targetUserId: member.id },\n      'ブラックリスト対象ユーザーの再参加BANに失敗しました',\n    );\n    return;\n  }\n\n  try {\n    await recordModerationAutomaticEventAudit(context.prisma, {\n      guildId: context.guildId,\n      actorId,\n      event: 'moderation.blacklist.rejoin_ban',\n      targetUserId: member.id,\n      detectionId: entry.originDetectionId,\n      metadata: { blacklistCreatedAt: entry.createdAt.toISOString() },\n      severity: 'critical',\n    });\n  } catch (error) {\n    context.logger.warn(\n      { err: error, guildId: context.guildId, targetUserId: member.id },\n      '再参加BANのAudit Log保存に失敗しました',\n    );\n  }`,
  );

  source = replaceOnce(
    source,
    `const detectors = new Map<string, AutomaticModerationDetector>();\nconst alertCooldowns = new Map<string, number>();`,
    `const detectors = new Map<string, AutomaticModerationDetector>();\n// 現在の本番はBot単一プロセス構成。将来shard/複数process化する場合はRedis共有へ移行する。\nconst alertCooldowns = new Map<string, number>();`,
  );

  source = replaceOnce(
    source,
    `    for (const [candidate, at] of alertCooldowns) {\n      if (at < threshold) alertCooldowns.delete(candidate);\n    }\n  }\n  return true;`,
    `    for (const [candidate, at] of alertCooldowns) {\n      if (at < threshold) alertCooldowns.delete(candidate);\n    }\n    while (alertCooldowns.size > 10_000) {\n      const oldestKey = alertCooldowns.keys().next().value as string | undefined;\n      if (!oldestKey) break;\n      alertCooldowns.delete(oldestKey);\n    }\n  }\n  return true;`,
  );

  writeFileSync(path, source);
}

function replaceOnce(source, before, after) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`置換対象が見つかりません: ${before.slice(0, 140)}`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`置換対象が複数あります: ${before.slice(0, 140)}`);
  }
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}
