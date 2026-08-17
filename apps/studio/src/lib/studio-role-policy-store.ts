import type { Prisma } from '@herta/db';
import { prisma } from '@/lib/db';
import { validateStudioAccessPolicy, type StudioAccessPolicy } from '@/lib/studio-access-policy';

const STORE_VERSION = 1;

export interface StudioRolePolicyRecord {
  discordRoleId: string;
  roleName: string;
  policy: StudioAccessPolicy;
  updatedBy: string;
  updatedAt: string;
}

interface StudioAccessSettings {
  version: number;
  rolePolicies: Record<string, StudioRolePolicyRecord>;
}

export async function listStudioRolePolicies(guildId: string): Promise<StudioRolePolicyRecord[]> {
  const settings = await prisma.guildSettings.findUnique({
    where: { guildId },
    select: { settingsJson: true },
  });
  const store = parseStudioAccessSettings(settings?.settingsJson, guildId);
  return Object.values(store.rolePolicies).sort((a, b) =>
    a.roleName.localeCompare(b.roleName, 'ja'),
  );
}

export async function saveStudioRolePolicy(
  guildId: string,
  actorId: string,
  input: { discordRoleId: string; roleName: string; policy: StudioAccessPolicy },
): Promise<StudioRolePolicyRecord> {
  const now = new Date().toISOString();
  const record: StudioRolePolicyRecord = {
    discordRoleId: input.discordRoleId,
    roleName: input.roleName.trim().slice(0, 100),
    policy: input.policy,
    updatedBy: actorId,
    updatedAt: now,
  };

  await prisma.$transaction(
    async (tx) => {
      const current = await tx.guildSettings.findUnique({
        where: { guildId },
        select: { settingsJson: true },
      });
      const root = asJsonObject(current?.settingsJson);
      const store = parseStudioAccessSettings(current?.settingsJson, guildId);
      store.rolePolicies[input.discordRoleId] = record;
      root.studioAccess = store as unknown as Prisma.InputJsonValue;

      await tx.guildSettings.upsert({
        where: { guildId },
        create: {
          guildId,
          modRoleIds: [],
          adminRoleIds: [],
          settingsJson: root as Prisma.InputJsonValue,
        },
        update: { settingsJson: root as Prisma.InputJsonValue },
      });
    },
    { isolationLevel: 'Serializable' },
  );

  return record;
}

export async function deleteStudioRolePolicy(
  guildId: string,
  discordRoleId: string,
): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      const current = await tx.guildSettings.findUnique({
        where: { guildId },
        select: { settingsJson: true },
      });
      if (!current) return;
      const root = asJsonObject(current.settingsJson);
      const store = parseStudioAccessSettings(current.settingsJson, guildId);
      delete store.rolePolicies[discordRoleId];
      root.studioAccess = store as unknown as Prisma.InputJsonValue;
      await tx.guildSettings.update({
        where: { guildId },
        data: { settingsJson: root as Prisma.InputJsonValue },
      });
    },
    { isolationLevel: 'Serializable' },
  );
}

function parseStudioAccessSettings(value: unknown, guildId: string): StudioAccessSettings {
  const root = isRecord(value) ? value : {};
  const rawStore = isRecord(root.studioAccess) ? root.studioAccess : {};
  const rawPolicies = isRecord(rawStore.rolePolicies) ? rawStore.rolePolicies : {};
  const rolePolicies: Record<string, StudioRolePolicyRecord> = {};

  for (const [roleId, rawRecord] of Object.entries(rawPolicies)) {
    if (!/^\d{17,20}$/u.test(roleId) || !isRecord(rawRecord)) continue;
    const roleName = typeof rawRecord.roleName === 'string' ? rawRecord.roleName : '';
    const updatedBy = typeof rawRecord.updatedBy === 'string' ? rawRecord.updatedBy : '';
    const updatedAt = typeof rawRecord.updatedAt === 'string' ? rawRecord.updatedAt : '';
    const validation = validateStudioAccessPolicy(rawRecord.policy, guildId);
    if (!roleName || !updatedBy || !updatedAt || !validation.valid || !validation.policy) continue;
    rolePolicies[roleId] = {
      discordRoleId: roleId,
      roleName,
      policy: validation.policy,
      updatedBy,
      updatedAt,
    };
  }

  return { version: STORE_VERSION, rolePolicies };
}

function asJsonObject(value: unknown): Record<string, Prisma.InputJsonValue> {
  if (!isRecord(value)) return {};
  return { ...(value as Record<string, Prisma.InputJsonValue>) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
