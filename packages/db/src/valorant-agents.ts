import type { Prisma, PrismaClient } from '@prisma/client';

export interface ValorantAgentInput {
  agentId: string;
  agentName: string;
  displayName: string;
  enabled: boolean;
}

export class ValorantAgentError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function validateValorantAgent(value: unknown): ValorantAgentInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValorantAgentError(400, 'エージェント情報が不正です。');
  }
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).some(
      (key) => !['agentId', 'agentName', 'displayName', 'enabled'].includes(key),
    )
  ) {
    throw new ValorantAgentError(400, '未対応の項目が含まれています。');
  }
  if (typeof row.agentId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(row.agentId)) {
    throw new ValorantAgentError(
      400,
      'Agent IDは64文字以内の半角小文字・数字・ハイフンで入力してください。',
    );
  }
  for (const key of ['agentName', 'displayName'] as const) {
    if (
      typeof row[key] !== 'string' ||
      row[key].trim().length === 0 ||
      row[key].trim().length > 50 ||
      /[\p{Cc}\p{Cf}]/u.test(row[key])
    ) {
      throw new ValorantAgentError(400, '名前は制御文字を含まない1〜50文字で入力してください。');
    }
  }
  if (typeof row.enabled !== 'boolean') throw new ValorantAgentError(400, '有効状態が不正です。');
  return {
    agentId: row.agentId,
    agentName: (row.agentName as string).trim(),
    displayName: (row.displayName as string).trim(),
    enabled: row.enabled,
  };
}

/** null is uninitialized; [] is an intentionally empty roster and MUST NOT fall back. */
export async function listValorantAgents(prisma: PrismaClient, guildId: string) {
  const roster = await prisma.valorantRoster.findUnique({
    where: { guildId },
    include: { agents: { orderBy: { agentId: 'asc' } } },
  });
  return roster?.agents ?? null;
}

export type ValorantAgentMutation =
  | { action: 'initialize' }
  | { action: 'create'; agent: ValorantAgentInput }
  | { action: 'update'; agent: ValorantAgentInput }
  | { action: 'delete'; agentId: string };

/** Serialize first initialization and CRUD per guild. Mutation and audit are atomic. */
export async function mutateValorantAgent(
  prisma: PrismaClient,
  guildId: string,
  actorId: string,
  mutation: ValorantAgentMutation,
  defaults: readonly ValorantAgentInput[],
) {
  try {
    return await prisma.$transaction(async (tx) => {
      const guilds = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM guilds WHERE id = ${guildId} FOR UPDATE`;
      if (guilds.length !== 1) throw new ValorantAgentError(404, 'Guildが見つかりません。');
      let roster = await tx.valorantRoster.findUnique({ where: { guildId } });
      if (!roster) {
        roster = await tx.valorantRoster.create({ data: { guildId } });
        await tx.valorantAgent.createMany({
          data: defaults.map((agent) => ({ ...agent, guildId })),
        });
        await audit(tx, guildId, actorId, 'initialized', null, { added: defaults.length });
      } else if (mutation.action === 'initialize') {
        const existing = await tx.valorantAgent.findMany({ where: { guildId } });
        const missing = defaults.filter(
          (agent) =>
            !existing.some(
              (row) => row.agentId === agent.agentId || row.agentName === agent.agentName,
            ),
        );
        if (existing.length + missing.length > 100)
          throw new ValorantAgentError(409, '登録上限は100件です。不要な候補を削除してください。');
        const added = await tx.valorantAgent.createMany({
          data: defaults.map((agent) => ({ ...agent, guildId })),
          skipDuplicates: true,
        });
        await audit(tx, guildId, actorId, 'initialized', null, { added: added.count });
      }
      if (mutation.action === 'create') {
        if ((await tx.valorantAgent.count({ where: { guildId } })) >= 100)
          throw new ValorantAgentError(409, '登録上限は100件です。');
        const agent = validateValorantAgent(mutation.agent);
        await tx.valorantAgent.create({ data: { ...agent, guildId } });
        await audit(tx, guildId, actorId, 'created', agent.agentId, { after: agent });
      } else if (mutation.action === 'update' || mutation.action === 'delete') {
        const agentId =
          mutation.action === 'update'
            ? validateValorantAgent(mutation.agent).agentId
            : mutation.agentId;
        const where = { guildId_agentId: { guildId, agentId } };
        const before = await tx.valorantAgent.findUnique({ where });
        if (!before) throw new ValorantAgentError(404, 'エージェントが見つかりません。');
        if (mutation.action === 'delete') {
          await tx.valorantAgent.delete({ where });
          await audit(tx, guildId, actorId, 'deleted', agentId, { before: snapshot(before) });
        } else {
          const agent = validateValorantAgent(mutation.agent);
          await tx.valorantAgent.update({ where, data: agent });
          await audit(tx, guildId, actorId, 'updated', agentId, {
            before: snapshot(before),
            after: agent,
          });
        }
      }
      return tx.valorantAgent.findMany({ where: { guildId }, orderBy: { agentId: 'asc' } });
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
      throw new ValorantAgentError(409, '同じAgent IDまたはAgent Nameが登録済みです。');
    }
    throw error;
  }
}

function snapshot(agent: ValorantAgentInput): ValorantAgentInput {
  return {
    agentId: agent.agentId,
    agentName: agent.agentName,
    displayName: agent.displayName,
    enabled: agent.enabled,
  };
}

async function audit(
  tx: Prisma.TransactionClient,
  guildId: string,
  actorId: string,
  action: string,
  agentId: string | null,
  changes: unknown,
) {
  await tx.auditLog.create({
    data: {
      guildId,
      actorId,
      event: `valorant.agent.${action}`,
      targetType: 'valorant_agent',
      targetId: agentId,
      changes: changes as Prisma.InputJsonValue,
      metadata: { operationSource: 'dashboard' },
    },
  });
}
