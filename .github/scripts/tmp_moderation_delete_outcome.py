from pathlib import Path

runtime_path = Path('plugins/moderation/src/automatic-runtime.ts')
test_path = Path('plugins/moderation/src/automatic-runtime.test.ts')

runtime = runtime_path.read_text()

def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, found {count}')
    return text.replace(old, new, 1)

runtime = replace_once(
    runtime,
    "type InsertedFinding = {\n  finding: AutomaticModerationFinding;\n  policy: AutomaticEnforcementPolicy;\n  detectionId: string | null;\n};\n",
    "type InsertedFinding = {\n  finding: AutomaticModerationFinding;\n  policy: AutomaticEnforcementPolicy;\n  detectionId: string | null;\n};\n\nexport interface AutomaticDiscordActionResult {\n  outcome: 'executed' | 'already_satisfied';\n  discordErrorCode: string | number | null;\n}\n",
    'action result type',
)

runtime = replace_once(
    runtime,
    "  const action = selected.policy.action;\n  let actionError: unknown;\n",
    "  const action = selected.policy.action;\n  let actionError: unknown;\n  let actionResult: AutomaticDiscordActionResult | null = null;\n",
    'action result variable',
)

runtime = replace_once(
    runtime,
    "      await executeAutomaticDiscordAction(message, selected.policy, reason);\n      context.logger.info(\n        {\n          guildId: context.guildId,\n          messageId: message.id,\n          targetUserId: message.author.id,\n          action,\n          selector: selected.policy.selector,\n          severity: selected.policy.severity,\n        },\n        '自動Moderation Discord操作を実行しました',\n      );\n",
    "      actionResult = await executeAutomaticDiscordAction(message, selected.policy, reason);\n      context.logger.info(\n        {\n          guildId: context.guildId,\n          messageId: message.id,\n          targetUserId: message.author.id,\n          action,\n          selector: selected.policy.selector,\n          severity: selected.policy.severity,\n          actionOutcome: actionResult.outcome,\n          discordErrorCode: actionResult.discordErrorCode,\n        },\n        '自動Moderation Discord操作を実行しました',\n      );\n",
    'action execution logging',
)

runtime = replace_once(
    runtime,
    "      metadata: {\n        action,\n        selector: selected.policy.selector,\n        severity: selected.policy.severity,\n        channelId: message.channelId,\n        messageId: message.id,\n      },\n",
    "      metadata: {\n        action,\n        selector: selected.policy.selector,\n        severity: selected.policy.severity,\n        channelId: message.channelId,\n        messageId: message.id,\n        actionOutcome: actionError ? 'failed' : (actionResult?.outcome ?? 'executed'),\n        discordErrorCode: actionError\n          ? getDiscordErrorCode(actionError)\n          : (actionResult?.discordErrorCode ?? null),\n        discordHttpStatus: actionError ? getDiscordHttpStatus(actionError) : null,\n      },\n",
    'audit metadata',
)

old_action = """export async function executeAutomaticDiscordAction(
  message: ModerationMessage,
  policy: AutomaticEnforcementPolicy,
  reason: string,
): Promise<void> {
  const member = message.member;
  switch (policy.action) {
    case 'observe':
      return;
    case 'warn':
      await sendAutomaticWarning(message, policy);
      return;
    case 'delete':
      await message.delete();
      return;
    case 'warn_delete': {
      await message.delete();
      await sendAutomaticWarning(message, policy);
      return;
    }
    case 'timeout':
      if (!member) throw new Error('対象Guild Memberを取得できません');
      await member.timeout(policy.timeoutMinutes * 60 * 1000, reason);
      return;
    case 'role':
      if (!member || !policy.roleId) throw new Error('付与対象ロールを取得できません');
      await member.roles.add(policy.roleId, reason);
      return;
    case 'blacklist':
      if (!member) throw new Error('対象Guild Memberを取得できません');
      await member.ban({ reason, deleteMessageSeconds: policy.banDeleteMessageSeconds });
      return;
    case 'kick':
      if (!member) throw new Error('対象Guild Memberを取得できません');
      await member.kick(reason);
      return;
    case 'ban':
      if (!member) throw new Error('対象Guild Memberを取得できません');
      await member.ban({ reason, deleteMessageSeconds: policy.banDeleteMessageSeconds });
  }
}
"""
new_action = """export async function executeAutomaticDiscordAction(
  message: ModerationMessage,
  policy: AutomaticEnforcementPolicy,
  reason: string,
): Promise<AutomaticDiscordActionResult> {
  const member = message.member;
  switch (policy.action) {
    case 'observe':
      return executedActionResult();
    case 'warn':
      await sendAutomaticWarning(message, policy);
      return executedActionResult();
    case 'delete':
      return deleteModerationMessage(message);
    case 'warn_delete': {
      const deleteResult = await deleteModerationMessage(message);
      await sendAutomaticWarning(message, policy);
      return deleteResult;
    }
    case 'timeout':
      if (!member) throw new Error('対象Guild Memberを取得できません');
      await member.timeout(policy.timeoutMinutes * 60 * 1000, reason);
      return executedActionResult();
    case 'role':
      if (!member || !policy.roleId) throw new Error('付与対象ロールを取得できません');
      await member.roles.add(policy.roleId, reason);
      return executedActionResult();
    case 'blacklist':
      if (!member) throw new Error('対象Guild Memberを取得できません');
      await member.ban({ reason, deleteMessageSeconds: policy.banDeleteMessageSeconds });
      return executedActionResult();
    case 'kick':
      if (!member) throw new Error('対象Guild Memberを取得できません');
      await member.kick(reason);
      return executedActionResult();
    case 'ban':
      if (!member) throw new Error('対象Guild Memberを取得できません');
      await member.ban({ reason, deleteMessageSeconds: policy.banDeleteMessageSeconds });
      return executedActionResult();
  }
}

async function deleteModerationMessage(
  message: ModerationMessage,
): Promise<AutomaticDiscordActionResult> {
  try {
    await message.delete();
    return executedActionResult();
  } catch (error) {
    if (isDiscordUnknownMessageError(error)) {
      return { outcome: 'already_satisfied', discordErrorCode: 10008 };
    }
    throw error;
  }
}

function executedActionResult(): AutomaticDiscordActionResult {
  return { outcome: 'executed', discordErrorCode: null };
}

function isDiscordUnknownMessageError(error: unknown): boolean {
  const code = getDiscordErrorCode(error);
  return code === 10008 || code === '10008';
}

function getDiscordErrorCode(error: unknown): string | number | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' || typeof code === 'number' ? code : null;
}

function getDiscordHttpStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null || !('status' in error)) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' && Number.isInteger(status) ? status : null;
}
"""
runtime = replace_once(runtime, old_action, new_action, 'Discord action implementation')
runtime_path.write_text(runtime)

test = test_path.read_text()
test = replace_once(
    test,
    "    await executeAutomaticDiscordAction(message as never, BASE_POLICY, 'test reason');\n    expect(deleteMessage).toHaveBeenCalledTimes(1);\n",
    "    const result = await executeAutomaticDiscordAction(message as never, BASE_POLICY, 'test reason');\n    expect(deleteMessage).toHaveBeenCalledTimes(1);\n    expect(result).toEqual({ outcome: 'executed', discordErrorCode: null });\n",
    'delete success test',
)

test = replace_once(
    test,
    "  it('warn_deleteでは削除後に警告DMを送る', async () => {\n",
    "  it('Discord 10008 Unknown Messageは既に削除済みとして冪等成功にする', async () => {\n    const message = {\n      delete: vi.fn(async () => {\n        throw Object.assign(new Error('Unknown Message'), { code: 10008, status: 404 });\n      }),\n      member: null,\n      author: { send: vi.fn(async () => undefined) },\n    };\n\n    const result = await executeAutomaticDiscordAction(message as never, BASE_POLICY, 'test reason');\n    expect(result).toEqual({ outcome: 'already_satisfied', discordErrorCode: 10008 });\n  });\n\n  it('Unknown Message以外のDiscord削除失敗は握り潰さない', async () => {\n    const error = Object.assign(new Error('Missing Permissions'), { code: 50013, status: 403 });\n    const message = {\n      delete: vi.fn(async () => {\n        throw error;\n      }),\n      member: null,\n      author: { send: vi.fn(async () => undefined) },\n    };\n\n    await expect(\n      executeAutomaticDiscordAction(message as never, BASE_POLICY, 'test reason'),\n    ).rejects.toBe(error);\n  });\n\n  it('warn_deleteでは既に削除済みでも警告DMを送る', async () => {\n    const calls: string[] = [];\n    const message = {\n      delete: vi.fn(async () => {\n        calls.push('delete');\n        throw Object.assign(new Error('Unknown Message'), { code: '10008', status: 404 });\n      }),\n      member: null,\n      author: {\n        send: vi.fn(async () => {\n          calls.push('warn');\n        }),\n      },\n    };\n\n    const result = await executeAutomaticDiscordAction(\n      message as never,\n      { ...BASE_POLICY, action: 'warn_delete' },\n      'test reason',\n    );\n    expect(calls).toEqual(['delete', 'warn']);\n    expect(result).toEqual({ outcome: 'already_satisfied', discordErrorCode: 10008 });\n  });\n\n  it('warn_deleteでは削除後に警告DMを送る', async () => {\n",
    'Discord delete regression tests',
)

test_path.write_text(test)
