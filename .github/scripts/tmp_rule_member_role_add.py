from pathlib import Path


def replace(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    if old not in text:
        raise SystemExit(f"anchor not found: {path}: {old[:120]!r}")
    file.write_text(text.replace(old, new, 1))


# Rule runtime: typed member role service and member.joined-only Action.
replace(
    'apps/bot/src/rules/runtime.ts',
    "export const RULE_ACTION_ROLE_DELETE = 'discord.role.delete';\n",
    "export const RULE_ACTION_ROLE_DELETE = 'discord.role.delete';\nexport const RULE_ACTION_MEMBER_ROLE_ADD = 'discord.member.role.add';\n",
)
replace(
    'apps/bot/src/rules/runtime.ts',
    "export interface RuleProductionRuntimeOptions {\n  store: RuleRuntimeStore;\n  security: RuleRuntimeSecurity;\n  logger: Logger;\n  now?: () => Date;\n}\n",
    "export interface RuleRuntimeMemberRoleService {\n  addRole(input: {\n    guildId: string;\n    userId: string;\n    roleId: string;\n    actorId: string;\n    ruleId: string;\n    triggerExecutionId: string;\n  }): Promise<{ status: 'added' | 'already-present'; auditRecorded: boolean }>;\n}\n\nexport interface RuleProductionRuntimeOptions {\n  store: RuleRuntimeStore;\n  security: RuleRuntimeSecurity;\n  memberRoles: RuleRuntimeMemberRoleService;\n  logger: Logger;\n  now?: () => Date;\n}\n",
)
replace(
    'apps/bot/src/rules/runtime.ts',
    "interface RoleActionContext {\n  guildId: string;\n  triggerExecutionId: string;\n  ruleId: string;\n  actionIndex: number;\n  actorId: string;\n  eventTimestamp: Date;\n}\n",
    "interface RoleActionContext {\n  guildId: string;\n  triggerExecutionId: string;\n  ruleId: string;\n  actionIndex: number;\n  actorId: string;\n  eventTimestamp: Date;\n  eventType: string;\n  eventData: Record<string, unknown>;\n}\n",
)
replace(
    'apps/bot/src/rules/runtime.ts',
    "      actorId: metadata.actorId,\n      eventTimestamp: input.event.timestamp,\n    };",
    "      actorId: metadata.actorId,\n      eventTimestamp: input.event.timestamp,\n      eventType: input.event.type,\n      eventData: input.event.data,\n    };",
)
replace(
    'apps/bot/src/rules/runtime.ts',
    "    this.actions.register({\n      type: RULE_ACTION_ROLE_DELETE,\n      name: 'Delete Discord role',\n      description: 'Role Lifecycle Operationへ削除をenqueueする',\n      configSchema: { roleId: 'Discord snowflake' },\n      execute: (context, config) => this.executeRoleDelete(context, config),\n    });\n  }",
    "    this.actions.register({\n      type: RULE_ACTION_ROLE_DELETE,\n      name: 'Delete Discord role',\n      description: 'Role Lifecycle Operationへ削除をenqueueする',\n      configSchema: { roleId: 'Discord snowflake' },\n      execute: (context, config) => this.executeRoleDelete(context, config),\n    });\n\n    this.actions.register({\n      type: RULE_ACTION_MEMBER_ROLE_ADD,\n      name: 'Add role to joined member',\n      description: 'member.joined event本人へ既存Discord Roleを付与する',\n      configSchema: { roleId: 'Discord snowflake' },\n      execute: (context, config) => this.executeMemberRoleAdd(context, config),\n    });\n  }",
)
replace(
    'apps/bot/src/rules/runtime.ts',
    "  private async executeRoleDelete(\n    context: unknown,\n    config: Record<string, unknown>,\n  ): Promise<ActionResult> {",
    "  private async executeMemberRoleAdd(\n    context: unknown,\n    config: Record<string, unknown>,\n  ): Promise<ActionResult> {\n    let actionContext: RoleActionContext;\n    let roleId: string;\n    let userId: string;\n    try {\n      actionContext = requireRoleActionContext(context);\n      if (actionContext.eventType !== RULE_TRIGGER_MEMBER_JOINED) {\n        throw new Error('DiscordMemberRoleAddRequiresMemberJoinedTrigger');\n      }\n      userId = parseSnowflake(actionContext.eventData['userId'], 'event.userId');\n      roleId = parseSnowflake(config['roleId'], 'roleId');\n    } catch (error) {\n      return { success: false, error: resolveErrorName(error) };\n    }\n\n    try {\n      const result = await this.options.memberRoles.addRole({\n        guildId: actionContext.guildId,\n        userId,\n        roleId,\n        actorId: actionContext.actorId,\n        ruleId: actionContext.ruleId,\n        triggerExecutionId: actionContext.triggerExecutionId,\n      });\n      return {\n        success: true,\n        data: { userId, roleId, status: result.status, auditRecorded: result.auditRecorded },\n      };\n    } catch (error) {\n      return { success: false, error: resolveErrorName(error) };\n    }\n  }\n\n  private async executeRoleDelete(\n    context: unknown,\n    config: Record<string, unknown>,\n  ): Promise<ActionResult> {",
)
replace(
    'apps/bot/src/rules/runtime.ts',
    "    actionIndex,\n    eventTimestamp: record['eventTimestamp'],\n  };",
    "    actionIndex,\n    eventTimestamp: record['eventTimestamp'],\n    eventType: parseNonEmptyString(record['eventType'], 'eventType', 96),\n    eventData: requireRecord(record['eventData'], 'eventData'),\n  };",
)

# HertaBot: keep privileged Discord mutation inside Bot boundary with live checks + audit.
replace(
    'apps/bot/src/bot.ts',
    "  MessageFlags,\n  Partials,",
    "  MessageFlags,\n  Partials,\n  PermissionFlagsBits,",
)
replace(
    'apps/bot/src/bot.ts',
    "  HERTA_WORKER_HEARTBEAT_KEY,\n",
    "  HERTA_STUDIO_ROOT_DISCORD_ROLE_ID,\n  HERTA_WORKER_HEARTBEAT_KEY,\n",
)
replace(
    'apps/bot/src/bot.ts',
    "function envFlagEnabled(name: string): boolean {",
    "function namedError(name: string): Error {\n  const error = new Error(name);\n  error.name = name;\n  return error;\n}\n\nfunction envFlagEnabled(name: string): boolean {",
)
replace(
    'apps/bot/src/bot.ts',
    "  async searchGuildMembers(\n    guildId: string,\n    query: string,\n    limit: number,\n  ): Promise<GuildMemberOption[] | null> {\n    return searchGuildMemberOptions(this.client, guildId, query, limit);\n  }\n\n  async reconcileXpRewardRoles(",
    "  async searchGuildMembers(\n    guildId: string,\n    query: string,\n    limit: number,\n  ): Promise<GuildMemberOption[] | null> {\n    return searchGuildMemberOptions(this.client, guildId, query, limit);\n  }\n\n  async addRuleMemberRole(input: {\n    guildId: string;\n    userId: string;\n    roleId: string;\n    actorId: string;\n    ruleId: string;\n    triggerExecutionId: string;\n  }): Promise<{ status: 'added' | 'already-present'; auditRecorded: boolean }> {\n    if (input.roleId === HERTA_STUDIO_ROOT_DISCORD_ROLE_ID) {\n      throw namedError('DiscordMemberRoleRootProtected');\n    }\n\n    const guild = this.client.guilds.cache.get(input.guildId);\n    if (!guild) throw namedError('DiscordGuildNotAvailable');\n\n    let botMember = guild.members.me;\n    if (!botMember) {\n      try {\n        botMember = await guild.members.fetchMe();\n      } catch (error) {\n        this.logger.warn({ err: error, guildId: input.guildId }, 'Bot member状態を取得できませんでした');\n        throw namedError('DiscordBotMemberNotAvailable');\n      }\n    }\n    if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {\n      throw namedError('DiscordManageRolesPermissionMissing');\n    }\n\n    let role;\n    try {\n      role = await guild.roles.fetch(input.roleId);\n    } catch (error) {\n      this.logger.warn(\n        { err: error, guildId: input.guildId, roleId: input.roleId },\n        'Rule Role付与対象の取得に失敗しました',\n      );\n      throw namedError('DiscordRoleNotAvailable');\n    }\n    if (!role) throw namedError('DiscordRoleNotAvailable');\n    if (role.managed || !role.editable) throw namedError('DiscordRoleNotAssignable');\n\n    let member;\n    try {\n      member = await guild.members.fetch(input.userId);\n    } catch (error) {\n      this.logger.warn(\n        { err: error, guildId: input.guildId, userId: input.userId },\n        'Rule Role付与対象memberの取得に失敗しました',\n      );\n      throw namedError('DiscordMemberNotAvailable');\n    }\n    if (member.user.bot) throw namedError('DiscordBotMemberRoleAssignmentDenied');\n    if (member.roles.cache.has(input.roleId)) {\n      return { status: 'already-present', auditRecorded: true };\n    }\n    if (!member.manageable) throw namedError('DiscordMemberNotManageable');\n\n    try {\n      await member.roles.add(role, `Herta Rule ${input.ruleId}`);\n    } catch (error) {\n      this.logger.warn(\n        { err: error, guildId: input.guildId, userId: input.userId, roleId: input.roleId },\n        'RuleからDiscord Roleを付与できませんでした',\n      );\n      throw namedError('DiscordMemberRoleAddFailed');\n    }\n\n    let auditRecorded = true;\n    try {\n      await this.prisma.auditLog.create({\n        data: {\n          guildId: input.guildId,\n          actorId: input.actorId,\n          event: 'rule.member_role_added',\n          targetType: 'member',\n          targetId: input.userId,\n          changes: { roleId: input.roleId, status: 'added' },\n          severity: 'warning',\n          metadata: {\n            ruleId: input.ruleId,\n            triggerExecutionId: input.triggerExecutionId,\n            operationSource: 'rule-engine',\n            securitySensitive: true,\n          },\n        },\n      });\n    } catch (error) {\n      auditRecorded = false;\n      this.logger.error(\n        { err: error, guildId: input.guildId, userId: input.userId, roleId: input.roleId, ruleId: input.ruleId },\n        'Rule Role付与のAudit Log保存に失敗しました',\n      );\n    }\n\n    return { status: 'added', auditRecorded };\n  }\n\n  async reconcileXpRewardRoles(",
)

# Wire Rule runtime member-role adapter to Bot boundary.
replace(
    'apps/bot/src/main.ts',
    "      security: {\n",
    "      memberRoles: {\n        addRole: (input) => bot.addRuleMemberRole(input),\n      },\n      security: {\n",
)

# Runtime tests: service invocation, event-bound user, duplicate protection and schedule rejection.
replace(
    'apps/bot/src/rules/runtime.test.ts',
    "  RULE_ACTION_ROLE_CREATE,\n",
    "  RULE_ACTION_MEMBER_ROLE_ADD,\n  RULE_ACTION_ROLE_CREATE,\n",
)
replace(
    'apps/bot/src/rules/runtime.test.ts',
    "const ACTOR_ID = '22345678901234567';\nconst ROLE_ID = '72345678901234567';",
    "const ACTOR_ID = '22345678901234567';\nconst JOINED_USER_ID = '32345678901234567';\nconst ROLE_ID = '72345678901234567';",
)
replace(
    'apps/bot/src/rules/runtime.test.ts',
    "  canDelete?: boolean;\n}) {",
    "  canDelete?: boolean;\n  memberRoleStatus?: 'added' | 'already-present';\n}) {",
)
replace(
    'apps/bot/src/rules/runtime.test.ts',
    "  const recordExecution = vi.fn(async () => undefined);\n",
    "  const recordExecution = vi.fn(async () => undefined);\n  const addMemberRole = vi.fn(async () => ({\n    status: input?.memberRoleStatus ?? ('added' as const),\n    auditRecorded: true,\n  }));\n",
)
replace(
    'apps/bot/src/rules/runtime.test.ts',
    "  const runtime = new RuleProductionRuntime({ store, security, logger, now: () => NOW });",
    "  const memberRoles = { addRole: addMemberRole };\n  const runtime = new RuleProductionRuntime({\n    store,\n    security,\n    memberRoles,\n    logger,\n    now: () => NOW,\n  });",
)
replace(
    'apps/bot/src/rules/runtime.test.ts',
    "    enqueueRoleDelete,\n    recordExecution,",
    "    enqueueRoleDelete,\n    addMemberRole,\n    memberRoles,\n    recordExecution,",
)
replace(
    'apps/bot/src/rules/runtime.test.ts',
    "      security: harness.security,\n      logger:",
    "      security: harness.security,\n      memberRoles: harness.memberRoles,\n      logger:",
)
replace(
    'apps/bot/src/rules/runtime.test.ts',
    "  it('同一minuteはprocess内で再評価せず、再配送claimでもRoleを重複作成しない', async () => {",
    "  it('member.joined本人へ既存Roleを一度だけ付与する', async () => {\n    const joinedAt = new Date('2026-08-17T11:59:59.000Z');\n    const harness = createHarness({\n      rules: [\n        storedRule({\n          trigger: { type: RULE_TRIGGER_MEMBER_JOINED, config: {} },\n          actions: [{ type: RULE_ACTION_MEMBER_ROLE_ADD, config: { roleId: ROLE_ID } }],\n        }),\n      ],\n    });\n\n    await harness.runtime.dispatchMemberJoined({\n      guildId: GUILD_ID,\n      userId: JOINED_USER_ID,\n      joinedAt,\n    });\n    await harness.runtime.dispatchMemberJoined({\n      guildId: GUILD_ID,\n      userId: JOINED_USER_ID,\n      joinedAt,\n    });\n\n    expect(harness.addMemberRole).toHaveBeenCalledTimes(1);\n    expect(harness.addMemberRole).toHaveBeenCalledWith({\n      guildId: GUILD_ID,\n      userId: JOINED_USER_ID,\n      roleId: ROLE_ID,\n      actorId: ACTOR_ID,\n      ruleId: RULE_ID,\n      triggerExecutionId: `member-joined:${GUILD_ID}:${JOINED_USER_ID}:${joinedAt.getTime()}`,\n    });\n    expect(harness.recordExecution).toHaveBeenCalledWith(\n      expect.objectContaining({\n        result: expect.objectContaining({\n          actionsExecuted: true,\n          actionResults: [\n            expect.objectContaining({\n              success: true,\n              data: expect.objectContaining({ status: 'added', userId: JOINED_USER_ID, roleId: ROLE_ID }),\n            }),\n          ],\n        }),\n      }),\n    );\n  });\n\n  it('schedule Triggerからmember role addを実行せずfail closedする', async () => {\n    const harness = createHarness({\n      rules: [storedRule({ actions: [{ type: RULE_ACTION_MEMBER_ROLE_ADD, config: { roleId: ROLE_ID } }] })],\n    });\n\n    await harness.runtime.scanNow(NOW);\n\n    expect(harness.addMemberRole).not.toHaveBeenCalled();\n    expect(harness.recordExecution).toHaveBeenCalledWith(\n      expect.objectContaining({\n        result: expect.objectContaining({\n          actionResults: [\n            expect.objectContaining({\n              success: false,\n              error: 'DiscordMemberRoleAddRequiresMemberJoinedTrigger',\n            }),\n          ],\n        }),\n      }),\n    );\n  });\n\n  it('同一minuteはprocess内で再評価せず、再配送claimでもRoleを重複作成しない', async () => {",
)

# Studio model: member role add is member.joined-only and uses a Guild-scoped role id.
replace(
    'apps/studio/src/lib/rule-studio.ts',
    "  'discord.role.delete',\n] as const;",
    "  'discord.role.delete',\n  'discord.member.role.add',\n] as const;",
)
replace(
    'apps/studio/src/lib/rule-studio.ts',
    "    | { type: 'discord.role.delete'; config: { roleId: string } }\n",
    "    | { type: 'discord.role.delete'; config: { roleId: string } }\n    | { type: 'discord.member.role.add'; config: { roleId: string } }\n",
)
replace(
    'apps/studio/src/lib/rule-studio.ts',
    "  if (actionType === 'discord.role.delete' && !DISCORD_ID_PATTERN.test(roleId))\n    errors.push('削除対象Role IDが不正です');",
    "  if (\n    (actionType === 'discord.role.delete' || actionType === 'discord.member.role.add') &&\n    !DISCORD_ID_PATTERN.test(roleId)\n  ) {\n    errors.push('対象Role IDが不正です');\n  }\n  if (actionType === 'discord.member.role.add' && triggerType !== 'member.joined') {\n    errors.push('Role自動付与Actionはmember.joined Triggerでのみ利用できます');\n  }",
)
replace(
    'apps/studio/src/lib/rule-studio.ts',
    "  if (actionType === 'discord.role.delete') {\n",
    "  if (actionType === 'discord.role.delete' || actionType === 'discord.member.role.add') {\n",
)

# Studio tests.
replace(
    'apps/studio/src/lib/rule-studio.test.ts',
    "test('offset must be smaller than schedule interval', () => {",
    "test('member.joined accepts event-bound member role add action', () => {\n  const result = validateRuleStudioDraft({\n    ...baseDraft,\n    triggerType: 'member.joined',\n    actionType: 'discord.member.role.add',\n    roleId: '72345678901234567',\n  });\n  assert.equal(result.valid, true);\n  if (!result.valid) return;\n  assert.deepEqual(result.definition.actions, [\n    { type: 'discord.member.role.add', config: { roleId: '72345678901234567' } },\n  ]);\n});\n\ntest('member role add rejects schedule trigger', () => {\n  const result = validateRuleStudioDraft({\n    ...baseDraft,\n    actionType: 'discord.member.role.add',\n    roleId: '72345678901234567',\n  });\n  assert.equal(result.valid, false);\n});\n\ntest('member role add requires a Discord role id', () => {\n  const result = validateRuleStudioDraft({\n    ...baseDraft,\n    triggerType: 'member.joined',\n    actionType: 'discord.member.role.add',\n    roleId: 'invalid',\n  });\n  assert.equal(result.valid, false);\n});\n\ntest('stored member role add rule is exposed as editable', () => {\n  const result = parseStoredRuleStudioView({\n    id: '11111111-1111-4111-8111-111111111111',\n    name: 'Join role',\n    description: null,\n    enabled: true,\n    priority: 0,\n    schemaVersion: 1,\n    trigger: { type: 'member.joined', config: {} },\n    conditions: [],\n    actions: [{ type: 'discord.member.role.add', config: { roleId: '72345678901234567' } }],\n    cooldownMs: 0,\n    maxExecutions: null,\n    executionCount: 0,\n    updatedAt: new Date('2026-08-17T00:00:00.000Z'),\n  });\n  assert.equal(result?.actionType, 'discord.member.role.add');\n  assert.equal(result?.roleId, '72345678901234567');\n});\n\ntest('offset must be smaller than schedule interval', () => {",
)

# Studio API: validate every existing-role target, including root and live Bot manageability.
replace(
    'apps/studio/src/app/api/guilds/[guildId]/rules/route.ts',
    "  const targetCheck = await validateDeleteTarget(guildId, validation.definition.actions[0]);",
    "  const targetCheck = await validateRoleTarget(guildId, validation.definition.actions[0]);",
)
replace(
    'apps/studio/src/app/api/guilds/[guildId]/rules/route.ts',
    "  const targetCheck = await validateDeleteTarget(guildId, validation.definition.actions[0]);",
    "  const targetCheck = await validateRoleTarget(guildId, validation.definition.actions[0]);",
)
replace(
    'apps/studio/src/app/api/guilds/[guildId]/rules/route.ts',
    "async function validateDeleteTarget(\n  guildId: string,\n  action: { type: string; config: Record<string, unknown> } | undefined,\n): Promise<Response | null> {\n  if (action?.type !== 'discord.role.delete') return null;\n  const roleId = typeof action.config.roleId === 'string' ? action.config.roleId : '';\n  const options = await getGuildConfigurationOptions(guildId);\n  if (!options)\n    return NextResponse.json({ error: 'Discord Role状態を確認できませんでした' }, { status: 503 });\n  const role = options.roles.find((candidate) => candidate.id === roleId);\n  if (!role)\n    return NextResponse.json({ error: '削除対象RoleはこのGuildに存在しません' }, { status: 400 });\n  if (role.id === STUDIO_ROOT_DISCORD_ROLE_ID) {\n    return NextResponse.json({ error: 'OWNER root RoleはRuleから削除できません' }, { status: 400 });\n  }\n  if (role.managed || !role.editable) {\n    return NextResponse.json(\n      { error: 'Botから編集できないRoleは削除対象にできません' },\n      { status: 400 },\n    );\n  }\n  return null;\n}",
    "async function validateRoleTarget(\n  guildId: string,\n  action: { type: string; config: Record<string, unknown> } | undefined,\n): Promise<Response | null> {\n  if (\n    action?.type !== 'discord.role.delete' &&\n    action?.type !== 'discord.member.role.add'\n  ) {\n    return null;\n  }\n  const roleId = typeof action.config.roleId === 'string' ? action.config.roleId : '';\n  const options = await getGuildConfigurationOptions(guildId);\n  if (!options) {\n    return NextResponse.json({ error: 'Discord Role状態を確認できませんでした' }, { status: 503 });\n  }\n  if (!options.bot.manageRoles) {\n    return NextResponse.json({ error: 'BotにManage Roles権限がありません' }, { status: 400 });\n  }\n  const role = options.roles.find((candidate) => candidate.id === roleId);\n  if (!role) {\n    return NextResponse.json({ error: '対象RoleはこのGuildに存在しません' }, { status: 400 });\n  }\n  if (role.id === STUDIO_ROOT_DISCORD_ROLE_ID) {\n    return NextResponse.json({ error: 'OWNER root RoleはRuleの操作対象にできません' }, { status: 400 });\n  }\n  if (role.managed || !role.editable) {\n    return NextResponse.json(\n      { error: 'Botから編集できないRoleはRuleの操作対象にできません' },\n      { status: 400 },\n    );\n  }\n  return null;\n}",
)

# Rule Studio page + UI.
replace(
    'apps/studio/src/app/dashboard/guilds/[guildId]/rules/page.tsx',
    "  const deleteRoleOptions = options.roles\n",
    "  const editableRoleOptions = options.roles\n",
)
replace(
    'apps/studio/src/app/dashboard/guilds/[guildId]/rules/page.tsx',
    "              Schedule TriggerからDiscord Role Lifecycleを実行するproduction\n              Ruleを管理します。Runtime側のroot再認証・idempotency・Role\n              hierarchy検証は保存後も継続します。",
    "              Schedule / Member joined TriggerからDiscord Role Actionを実行するproduction\n              Ruleを管理します。Runtime側のroot再認証・idempotency・Role hierarchy・Guild\n              boundary検証は保存後も継続します。",
)
replace(
    'apps/studio/src/app/dashboard/guilds/[guildId]/rules/page.tsx',
    "        deleteRoleOptions={deleteRoleOptions}\n",
    "        editableRoleOptions={editableRoleOptions}\n",
)
replace(
    'apps/studio/src/components/rule-studio-manager.tsx',
    "  deleteRoleOptions,\n",
    "  editableRoleOptions,\n",
)
replace(
    'apps/studio/src/components/rule-studio-manager.tsx',
    "  deleteRoleOptions: RoleOption[];\n",
    "  editableRoleOptions: RoleOption[];\n",
)
replace(
    'apps/studio/src/components/rule-studio-manager.tsx',
    "      conditionHour: triggerType === 'schedule.minute' ? current.conditionHour : null,\n",
    "      conditionHour: triggerType === 'schedule.minute' ? current.conditionHour : null,\n      actionType:\n        triggerType === 'schedule.minute' && current.actionType === 'discord.member.role.add'\n          ? 'discord.role.create'\n          : current.actionType,\n      roleId:\n        triggerType === 'schedule.minute' && current.actionType === 'discord.member.role.add'\n          ? ''\n          : current.roleId,\n",
)
replace(
    'apps/studio/src/components/rule-studio-manager.tsx',
    "                    <option value=\"discord.role.delete\">Roleを削除</option>\n",
    "                    <option value=\"discord.role.delete\">Roleを削除</option>\n                    {draft.triggerType === 'member.joined' ? (\n                      <option value=\"discord.member.role.add\">参加メンバーへRoleを付与</option>\n                    ) : null}\n",
)
replace(
    'apps/studio/src/components/rule-studio-manager.tsx',
    "                {draft.actionType === 'discord.role.delete' ? (\n                  <Field label=\"削除対象Role\">",
    "                {draft.actionType === 'discord.role.delete' ||\n                draft.actionType === 'discord.member.role.add' ? (\n                  <Field\n                    label={\n                      draft.actionType === 'discord.member.role.add'\n                        ? '付与するRole'\n                        : '削除対象Role'\n                    }\n                  >",
)
replace(
    'apps/studio/src/components/rule-studio-manager.tsx',
    "                      {deleteRoleOptions.map((role) => (\n",
    "                      {editableRoleOptions.map((role) => (\n",
)
replace(
    'apps/studio/src/components/rule-studio-manager.tsx',
    "              {draft.actionType !== 'discord.role.delete' ? (\n",
    "              {draft.actionType === 'discord.role.create' ||\n              draft.actionType === 'discord.role.create-temporary' ? (\n",
)
replace(
    'apps/studio/src/components/rule-studio-manager.tsx',
    "                </div>\n              ) : null}\n            </div>\n\n            <Field label=\"最大実行回数（任意）\">",
    "                </div>\n              ) : null}\n\n              {draft.actionType === 'discord.member.role.add' ? (\n                <div className=\"mt-4 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-sm leading-6 text-muted\">\n                  Triggerで参加したメンバー本人へRoleを付与します。User IDは入力できません。OWNER\n                  root / managed / Botから編集不能なRoleはserver-sideでも拒否されます。\n                </div>\n              ) : null}\n            </div>\n\n            <Field label=\"最大実行回数（任意）\">",
)

print('member role add source patch applied')
