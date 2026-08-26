import type { PrismaClient } from '@prisma/client';

export const AI_RUNTIME_CONFIGURATION = 'ai.runtime';
export const RUNTIME_CONFIGURATION_NAMES = [AI_RUNTIME_CONFIGURATION] as const;

export type RuntimeConfigurationName = (typeof RUNTIME_CONFIGURATION_NAMES)[number];

export interface RuntimeConfigurationRecord {
  name: RuntimeConfigurationName;
  value: Record<string, unknown>;
  updatedBy: string;
  updatedAt: Date;
}

export type RuntimeConfigurationErrorCode =
  | 'invalid_name'
  | 'invalid_value'
  | 'invalid_actor';

export class RuntimeConfigurationError extends Error {
  readonly code: RuntimeConfigurationErrorCode;

  constructor(code: RuntimeConfigurationErrorCode) {
    super(`Runtime configuration operation failed: ${code}`);
    this.name = 'RuntimeConfigurationError';
    this.code = code;
  }
}

type RuntimeConfigurationPrisma = Pick<PrismaClient, '$queryRaw' | '$executeRaw'>;

const MAX_VALUE_BYTES = 16 * 1024;
const MAX_ACTOR_LENGTH = 128;
const FORBIDDEN_SECRET_KEYS = new Set([
  'apikey',
  'api_key',
  'secret',
  'password',
  'credential',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
]);

export async function getRuntimeConfiguration(
  prisma: RuntimeConfigurationPrisma,
  name: RuntimeConfigurationName,
): Promise<RuntimeConfigurationRecord | null> {
  const normalizedName = validateRuntimeConfigurationName(name);
  const rows = await prisma.$queryRaw<
    Array<{
      name: string;
      value: unknown;
      updatedBy: string;
      updatedAt: Date;
    }>
  >`
    SELECT
      "name",
      "value",
      "updated_by" AS "updatedBy",
      "updated_at" AS "updatedAt"
    FROM "runtime_configurations"
    WHERE "name" = ${normalizedName}
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) return null;
  if (row.name !== normalizedName || !isRecord(row.value)) {
    throw new RuntimeConfigurationError('invalid_value');
  }

  return {
    name: normalizedName,
    value: validateRuntimeConfigurationValue(row.value),
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt,
  };
}

export async function setRuntimeConfiguration(
  prisma: RuntimeConfigurationPrisma,
  input: {
    name: RuntimeConfigurationName;
    value: Record<string, unknown>;
    updatedBy: string;
  },
): Promise<RuntimeConfigurationRecord> {
  const name = validateRuntimeConfigurationName(input.name);
  const value = validateRuntimeConfigurationValue(input.value);
  const updatedBy = input.updatedBy.trim();
  if (!updatedBy || updatedBy.length > MAX_ACTOR_LENGTH) {
    throw new RuntimeConfigurationError('invalid_actor');
  }

  const serializedValue = JSON.stringify(value);
  await prisma.$executeRaw`
    INSERT INTO "runtime_configurations" (
      "name",
      "value",
      "updated_by",
      "created_at",
      "updated_at"
    )
    VALUES (
      ${name},
      ${serializedValue}::jsonb,
      ${updatedBy},
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT ("name") DO UPDATE SET
      "value" = EXCLUDED."value",
      "updated_by" = EXCLUDED."updated_by",
      "updated_at" = CURRENT_TIMESTAMP
  `;

  const stored = await getRuntimeConfiguration(prisma, name);
  if (!stored) throw new RuntimeConfigurationError('invalid_value');
  return stored;
}

export function validateRuntimeConfigurationName(name: string): RuntimeConfigurationName {
  if ((RUNTIME_CONFIGURATION_NAMES as readonly string[]).includes(name)) {
    return name as RuntimeConfigurationName;
  }
  throw new RuntimeConfigurationError('invalid_name');
}

export function validateRuntimeConfigurationValue(
  value: unknown,
): Record<string, unknown> {
  if (!isRecord(value) || containsForbiddenSecretKey(value)) {
    throw new RuntimeConfigurationError('invalid_value');
  }

  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new RuntimeConfigurationError('invalid_value');
  }

  if (!serialized || Buffer.byteLength(serialized, 'utf8') > MAX_VALUE_BYTES) {
    throw new RuntimeConfigurationError('invalid_value');
  }
  return value;
}

function containsForbiddenSecretKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenSecretKey);
  if (!isRecord(value)) return false;

  for (const [key, nested] of Object.entries(value)) {
    const normalized = key.replace(/[-.]/g, '_').toLowerCase();
    if (FORBIDDEN_SECRET_KEYS.has(normalized)) return true;
    if (containsForbiddenSecretKey(nested)) return true;
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
