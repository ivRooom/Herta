from pathlib import Path


def replace(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise RuntimeError(f'pattern not found: {path}: {old[:80]!r}')
    p.write_text(text.replace(old, new))

# config test coverage
replace(
    'plugins/team-split/src/config.test.ts',
    "  it('不正値を既定値へ戻す', () => {\n",
    "  it('最大期間より長い既定期間を最大期間へ丸める', () => {\n    expect(normalizeTeamSplitConfig({ defaultDurationMinutes: 1440, maxDurationMinutes: 60 })).toMatchObject({\n      defaultDurationMinutes: 60,\n      maxDurationMinutes: 60,\n    });\n  });\n\n  it('不正値を既定値へ戻す', () => {\n",
)

# service: derive count and array from one source
replace(
    'plugins/team-split/src/service.ts',
    "    const nextCount = existing?.status === 'joined' ? joinedCount : joinedCount + 1;\n    const updated = await tx.teamSplitSession.update({\n      where: { id: session.id },\n      data: {\n        participantCount: nextCount,\n        participants: await listJoinedUserIds(tx, input.guildId, session.id),",
    "    const joinedUserIds = await listJoinedUserIds(tx, input.guildId, session.id);\n    const updated = await tx.teamSplitSession.update({\n      where: { id: session.id },\n      data: {\n        participantCount: joinedUserIds.length,\n        participants: joinedUserIds,",
)
replace(
    'plugins/team-split/src/service.ts',
    "      changes: { participantCount: nextCount, targetUserId: input.userId },",
    "      changes: { participantCount: joinedUserIds.length, targetUserId: input.userId },",
)
replace(
    'plugins/team-split/src/service.ts',
    "    const nextCount = Math.max(1, session.participantCount - 1);\n    const updated = await tx.teamSplitSession.update({\n      where: { id: session.id },\n      data: {\n        participantCount: nextCount,\n        participants: await listJoinedUserIds(tx, input.guildId, session.id),",
    "    const joinedUserIds = await listJoinedUserIds(tx, input.guildId, session.id);\n    const updated = await tx.teamSplitSession.update({\n      where: { id: session.id },\n      data: {\n        participantCount: joinedUserIds.length,\n        participants: joinedUserIds,",
)
replace(
    'plugins/team-split/src/service.ts',
    "      changes: { participantCount: nextCount, targetUserId: input.userId },",
    "      changes: { participantCount: joinedUserIds.length, targetUserId: input.userId },",
)
replace(
    'plugins/team-split/src/service.ts',
    "  const session = await prisma.teamSplitSession.findFirst({\n    where: {\n      guildId: input.guildId,\n      messageId: input.messageId,\n      status: { in: ['open', 'split'] },\n      deletedAt: null,\n    },\n  });\n  if (!session) return null;\n  return prisma.teamSplitSession.update({\n    where: { id: session.id },\n    data: {\n      messageId: null,\n      messageState: 'missing',\n      lastErrorName: input.errorName ?? 'TeamSplitMessageDeleted',\n      version: { increment: 1 },\n    },\n  });",
    "  return prisma.$transaction(async (tx) => {\n    const found = await tx.teamSplitSession.findFirst({\n      where: {\n        guildId: input.guildId,\n        messageId: input.messageId,\n        status: { in: ['open', 'split'] },\n        deletedAt: null,\n      },\n    });\n    if (!found) return null;\n    await lockSession(tx, input.guildId, found.id);\n    const session = await findSession(tx, input.guildId, found.id);\n    if (!session || session.messageId !== input.messageId) return session;\n    return tx.teamSplitSession.update({\n      where: { id: session.id },\n      data: {\n        messageId: null,\n        messageState: 'missing',\n        lastErrorName: input.errorName ?? 'TeamSplitMessageDeleted',\n        version: { increment: 1 },\n      },\n    });\n  });",
)

# plugin namespace and transient error handling
replace(
    'plugins/team-split/src/plugin.ts',
    "  if (!interaction.guildId || interaction.guildId !== context.guildId) return;\n  const parsed = parseTeamSplitComponentId",
    "  if (!interaction.guildId || interaction.guildId !== context.guildId) return;\n  if (!interaction.customId.startsWith('team:')) return;\n  const parsed = parseTeamSplitComponentId",
)
replace(
    'plugins/team-split/src/plugin.ts',
    "  } catch (error) {\n    await markTeamSplitMessageMissing(context.prisma, {\n      guildId: context.guildId,\n      messageId: session.messageId,\n      errorName: resolveErrorName(error),\n    });\n  }\n}\n\nfunction canManageSession",
    "  } catch (error) {\n    if (isUnknownMessageError(error)) {\n      await markTeamSplitMessageMissing(context.prisma, {\n        guildId: context.guildId,\n        messageId: session.messageId,\n        errorName: resolveErrorName(error),\n      });\n      return;\n    }\n    await context.prisma.teamSplitSession.update({\n      where: { id: session.id },\n      data: { messageState: 'failed', lastErrorName: resolveErrorName(error) },\n    });\n  }\n}\n\nfunction isUnknownMessageError(error: unknown): boolean {\n  if (typeof error !== 'object' || error === null) return false;\n  const candidate = error as { code?: unknown; status?: unknown; rawError?: { code?: unknown } };\n  return candidate.code === 10008 || candidate.rawError?.code === 10008 || candidate.status === 404;\n}\n\nfunction canManageSession",
)

# Bot dispatch for component and delete events
replace(
    'apps/bot/src/bot.ts',
    "    this.client.on(Events.InteractionCreate, async (interaction) => {\n      if (!interaction.isChatInputCommand()) {\n        return;\n      }",
    "    this.client.on(Events.InteractionCreate, async (interaction) => {\n      if (interaction.guildId) {\n        await this.dispatchGuildPluginEvent(interaction.guildId, Events.InteractionCreate, interaction);\n      }\n      if (!interaction.isChatInputCommand()) return;",
)
replace(
    'apps/bot/src/bot.ts',
    "    this.client.on('error', (error) => {",
    "    this.client.on(Events.MessageDelete, async (message) => {\n      if (!message.guildId) return;\n      await this.dispatchGuildPluginEvent(message.guildId, Events.MessageDelete, message);\n    });\n\n    this.client.on('error', (error) => {",
)
replace(
    'apps/bot/src/bot.ts',
    "  private async recordCommandExecution(input: CommandExecutionInput): Promise<void> {",
    "  private async dispatchGuildPluginEvent(\n    guildId: string,\n    eventName: string,\n    payload: unknown,\n  ): Promise<void> {\n    try {\n      const events = await this.pluginLoader.getGuildEvents(guildId);\n      for (const event of events.filter((candidate) => candidate.event === eventName)) {\n        try {\n          await event.handler(payload);\n        } catch (error) {\n          this.logger.error(\n            { err: error, guildId, event: eventName },\n            'Plugin Event Handlerの実行に失敗しました',\n          );\n        }\n      }\n    } catch (error) {\n      this.logger.error(\n        { err: error, guildId, event: eventName },\n        'Guild Plugin Eventの取得に失敗しました',\n      );\n    }\n  }\n\n  private async recordCommandExecution(input: CommandExecutionInput): Promise<void> {",
)

# Env fails closed and accurately documents consumers
replace(
    '.env.example',
    '# Team Split Button・seed HMAC署名鍵。LFGとは別の32文字以上の値を推奨する。\n# BotとWorkerで必ず同じ値を設定する。',
    '# Team Split Button・seed HMAC署名鍵。LFGとは別の32文字以上のランダム値を必須とする。\n# Bot・Worker・Studioで必ず同じ値を設定する。',
)
replace(
    '.env.production.example',
    'TEAM_SPLIT_SECRET=change-me-team-split-secret-at-least-32-characters',
    'TEAM_SPLIT_SECRET=',
)

# Migration closes legacy active rows instead of replaying them
replace(
    'packages/db/prisma/migrations/20260729152000_team_split_plugin_v1/migration.sql',
    'ALTER TABLE "team_split_sessions"\n  ALTER COLUMN "expires_at" SET NOT NULL;',
    'UPDATE "team_split_sessions"\nSET\n  "status" = \'closed\',\n  "closed_at" = COALESCE("closed_at", "created_at")\nWHERE "status" IN (\'open\', \'split\')\n  AND "expires_at" <= CURRENT_TIMESTAMP;\n\nALTER TABLE "team_split_sessions"\n  ALTER COLUMN "expires_at" SET NOT NULL;',
)

# Studio: fail meaningfully on non-JSON errors and add score label
manager = Path('apps/studio/src/components/team-split-manager.tsx')
text = manager.read_text()
text = text.replace(
    "      const body = await response.json();\n      if (!response.ok) throw new Error(readError(body));",
    "      if (!response.ok) throw new Error(await readResponseError(response));\n      const body = await response.json();",
)
text = text.replace(
    "        const body = await response.json();\n        if (!response.ok) throw new Error(readError(body));",
    "        if (!response.ok) throw new Error(await readResponseError(response));\n        const body = await response.json();",
)
text = text.replace(
    "    const payload = await response.json();\n    if (!response.ok) throw new Error(readError(payload));",
    "    if (!response.ok) throw new Error(await readResponseError(response));\n    const payload = await response.json();",
)
text = text.replace(
    '''              <input\n                className={`${inputClass} mt-2`}\n                type="number"\n                min={-100000}\n                max={100000}\n                value={participantScore}\n                onChange={(event) => setParticipantScore(Number(event.target.value))}\n              />''',
    '''              <label className="mt-2 block text-sm">\n                <span className="mb-1.5 block text-muted">score</span>\n                <input\n                  className={inputClass}\n                  type="number"\n                  min={-100000}\n                  max={100000}\n                  value={participantScore}\n                  onChange={(event) => setParticipantScore(Number(event.target.value))}\n                />\n              </label>''',
)
if 'async function readResponseError' not in text:
    text += "\nasync function readResponseError(response: Response): Promise<string> {\n  const contentType = response.headers.get('content-type') ?? '';\n  if (contentType.includes('application/json')) {\n    return readError(await response.json());\n  }\n  const body = (await response.text()).trim();\n  return body || `HTTP ${response.status}`;\n}\n"
manager.write_text(text)

# Runbook: duplicate check and single migration flow wording
p = Path('docs/plugins/TEAM_SPLIT.md')
text = p.read_text()
needle = "SELECT id, creator_id\nFROM team_split_sessions\nWHERE NOT creator_id = ANY(participants);\n```"
if needle in text:
    text = text.replace(needle, needle[:-3] + "\n\nSELECT session.id, participant.participant_id, COUNT(*) AS duplicate_count\nFROM team_split_sessions AS session\nCROSS JOIN LATERAL unnest(session.participants) AS participant(participant_id)\nGROUP BY session.id, participant.participant_id\nHAVING COUNT(*) > 1;\n```")
text = text.replace(
    "`prisma migrate deploy`後に、Concurrent index migrationを別途実行します。",
    "Concurrent indexを含むmigrationは`prisma migrate deploy`で一度だけ適用します。手動で同じSQLを再実行しません。",
)
text = text.replace(
    "psql \"$DATABASE_URL\" -f packages/db/prisma/migrations/20260729152100_team_split_expiry_index_concurrently/migration.sql\n",
    "",
)
p.write_text(text)
