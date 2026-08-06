import { ModerationValidationError } from './config.js';
import type { ModerationPrismaClient, ModerationTransactionClient } from './service.js';

export interface ModerationDetectionCaseLink {
  detectionId: string;
  caseId: string;
  caseNumber: number;
}

export interface ModerationDetectionCaseResult extends ModerationDetectionCaseLink {
  created: boolean;
}

export interface CreateModerationCaseFromDetectionInput {
  guildId: string;
  detectionId: string;
  actorId: string;
}

interface DetectionCaseSourceRow {
  id: string;
  guild_id: string;
  message_id: string;
  channel_id: string;
  user_id: string;
  detection_kind: string;
  review_status: string;
  case_id: string | null;
  case_number: number | null;
}

interface DetectionCaseLinkRow {
  detection_id: string;
  case_id: string;
  case_number: number;
}

interface CreatedCaseRow {
  id: string;
  case_number: number;
}

export async function getModerationCaseForDetection(
  prisma: ModerationPrismaClient,
  guildId: string,
  detectionId: string,
): Promise<ModerationDetectionCaseLink | null> {
  assertDiscordId(guildId, 'Guild ID');
  assertUuid(detectionId, '検知ID');

  const rows = await prisma.$queryRawUnsafe<DetectionCaseLinkRow[]>(
    `SELECT
       d.id AS detection_id,
       c.id AS case_id,
       c.case_number
     FROM moderation_detection_events d
     INNER JOIN moderation_cases c
       ON c.origin_detection_id = d.id
     WHERE d.guild_id = $1
       AND d.id = $2::uuid
     LIMIT 1`,
    guildId,
    detectionId,
  );

  return rows[0] ? toLink(rows[0]) : null;
}

export async function createModerationCaseFromDetection(
  prisma: ModerationPrismaClient,
  input: CreateModerationCaseFromDetectionInput,
): Promise<ModerationDetectionCaseResult | null> {
  assertDiscordId(input.guildId, 'Guild ID');
  assertUuid(input.detectionId, '検知ID');
  assertDiscordId(input.actorId, '実行者ID');

  return prisma.$transaction(async (tx) => createInTransaction(tx, input));
}

async function createInTransaction(
  tx: ModerationTransactionClient,
  input: CreateModerationCaseFromDetectionInput,
): Promise<ModerationDetectionCaseResult | null> {
  await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', input.guildId);
  const sourceRows = await tx.$queryRawUnsafe<DetectionCaseSourceRow[]>(
    `SELECT
       d.id,
       d.guild_id,
       d.message_id,
       d.channel_id,
       d.user_id,
       d.detection_kind,
       d.review_status,
       c.id AS case_id,
       c.case_number
     FROM moderation_detection_events d
     LEFT JOIN moderation_cases c
       ON c.origin_detection_id = d.id
     WHERE d.guild_id = $1
       AND d.id = $2::uuid
     FOR UPDATE OF d`,
    input.guildId,
    input.detectionId,
  );
  const source = sourceRows[0];
  if (!source) return null;

  if (source.case_id && source.case_number !== null) {
    return {
      detectionId: source.id,
      caseId: source.case_id,
      caseNumber: source.case_number,
      created: false,
    };
  }

  if (source.review_status !== 'confirmed') {
    throw new ModerationValidationError('正検知として保存された自動検知のみケースを作成できます');
  }

  const reason = buildCaseReason(source.detection_kind);
  const createdRows = await tx.$queryRawUnsafe<CreatedCaseRow[]>(
    `INSERT INTO moderation_cases (
       guild_id,
       case_number,
       action,
       target_user_id,
       moderator_user_id,
       reason,
       status,
       duration_seconds,
       expires_at,
       discord_action_id,
       source,
       origin_detection_id
     )
     SELECT
       $1,
       COALESCE(MAX(case_number), 0) + 1,
       'flag',
       $2,
       $3,
       $4,
       'active',
       NULL,
       NULL,
       NULL,
       'automatic',
       $5::uuid
     FROM moderation_cases
     WHERE guild_id = $1
     ON CONFLICT (origin_detection_id)
       WHERE origin_detection_id IS NOT NULL
       DO NOTHING
     RETURNING id, case_number`,
    input.guildId,
    source.user_id,
    input.actorId,
    reason,
    source.id,
  );
  const created = createdRows[0];
  if (!created) {
    const existingRows = await tx.$queryRawUnsafe<CreatedCaseRow[]>(
      `SELECT id, case_number
       FROM moderation_cases
       WHERE guild_id = $1
         AND origin_detection_id = $2::uuid
       LIMIT 1`,
      input.guildId,
      source.id,
    );
    const existing = existingRows[0];
    if (!existing) throw new Error('自動検知ケースの作成結果を取得できませんでした');
    return {
      detectionId: source.id,
      caseId: existing.id,
      caseNumber: existing.case_number,
      created: false,
    };
  }

  await tx.auditLog.create({
    data: {
      guildId: input.guildId,
      actorId: input.actorId,
      event: 'moderation.detection.case.create',
      targetType: 'moderation_case',
      targetId: created.id,
      changes: {
        after: {
          caseNumber: created.case_number,
          action: 'flag',
          status: 'active',
          source: 'automatic',
        },
      },
      metadata: {
        detectionId: source.id,
        detectionKind: source.detection_kind,
        messageId: source.message_id,
        channelId: source.channel_id,
        targetUserId: source.user_id,
      },
      severity: 'info',
    },
  });

  return {
    detectionId: source.id,
    caseId: created.id,
    caseNumber: created.case_number,
    created: true,
  };
}

function buildCaseReason(detectionKind: string): string {
  return `自動検知（${detectionKind}）を正検知としてケース化しました。メッセージ本文・一致語は保存していません。`;
}

function toLink(row: DetectionCaseLinkRow): ModerationDetectionCaseLink {
  return {
    detectionId: row.detection_id,
    caseId: row.case_id,
    caseNumber: row.case_number,
  };
}

function assertDiscordId(value: string, label: string): void {
  if (!/^\d+$/.test(value)) throw new ModerationValidationError(`${label}が不正です`);
}

function assertUuid(value: string, label: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new ModerationValidationError(`${label}が不正です`);
  }
}
