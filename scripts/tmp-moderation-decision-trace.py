from pathlib import Path

path = Path('plugins/moderation/src/automatic-runtime.ts')
text = path.read_text(encoding='utf-8')
old = '''  if (!enforcementConfig.autoEnforcementEnabled) return;
  const enforcement = selectStrongestEnforcement(insertedFindings);
  if (!enforcement || enforcement.policy.action === 'observe') return;

  await executeAutomaticEnforcement(context, message, enforcement, insertedFindings);
}

async function executeAutomaticEnforcement(
'''
new = '''  const enforcement = selectStrongestEnforcement(insertedFindings);
  if (!enforcement) return;

  const decision = !enforcementConfig.autoEnforcementEnabled
    ? 'disabled'
    : enforcement.policy.action === 'observe'
      ? 'observe'
      : 'execute';
  await recordAutomaticDecisionTrace(context, message, enforcement, decision);
  if (decision !== 'execute') return;

  await executeAutomaticEnforcement(context, message, enforcement, insertedFindings);
}

async function recordAutomaticDecisionTrace(
  context: ModerationAutomaticRuntimeContext,
  message: ModerationMessage,
  selected: InsertedFinding,
  outcome: 'disabled' | 'observe' | 'execute',
): Promise<void> {
  const actorId = getBotActorId(context.client);
  const bot = message.guild?.members.me;
  const action = selected.policy.action;
  const metadata = {
    outcome,
    action,
    selector: selected.policy.selector,
    severity: selected.policy.severity,
    channelId: message.channelId,
    messageId: message.id,
    messageDeletable: message.deletable ?? null,
    botCanManageMessages: bot?.permissions.has(MANAGE_MESSAGES_PERMISSION) ?? null,
  };

  context.logger.info(
    {
      guildId: context.guildId,
      targetUserId: message.author.id,
      ...metadata,
    },
    'Moderation自動対応ポリシーを選択しました',
  );

  if (!actorId) return;
  try {
    await recordModerationAutomaticEventAudit(context.prisma, {
      guildId: context.guildId,
      actorId,
      event: 'moderation.automatic.decision',
      targetUserId: message.author.id,
      detectionId: selected.detectionId,
      metadata,
      severity: selected.policy.severity === 'critical' ? 'warning' : 'info',
    });
  } catch (error) {
    context.logger.warn(
      { err: error, guildId: context.guildId, messageId: message.id },
      '自動Moderation Decision Auditの保存に失敗しました',
    );
  }
}

async function executeAutomaticEnforcement(
'''
if text.count(old) != 1:
    raise SystemExit(f'expected one decision block, got {text.count(old)}')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
print('Moderation decision trace applied')
