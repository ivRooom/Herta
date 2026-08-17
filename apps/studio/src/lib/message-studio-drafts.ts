import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/db';

export interface MessageStudioDraftPayload {
  channelId: string;
  forumTitle: string;
  content: string;
  messageFormat: 'text' | 'embed' | 'voice';
  embedTitle: string;
  embedDescription: string;
  embedColor: string;
  embedImageUrl: string;
  embedThumbnailUrl: string;
  embedFooterText: string;
  embedFields: Array<{ name: string; value: string; inline: boolean }>;
  publishAnnouncement: boolean;
}

export interface MessageStudioDraftRecord {
  id: string;
  guildId: string;
  authorId: string;
  name: string;
  payload: MessageStudioDraftPayload;
  createdAt: Date;
  updatedAt: Date;
}

interface DraftRow {
  id: string;
  guildId: string;
  authorId: string;
  name: string;
  payload: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export async function listMessageStudioDrafts(
  guildId: string,
  authorId: string,
): Promise<MessageStudioDraftRecord[]> {
  const rows = await prisma.$queryRaw<DraftRow[]>`
    SELECT
      "id"::text AS "id",
      "guild_id" AS "guildId",
      "author_id" AS "authorId",
      "name",
      "payload",
      "created_at" AS "createdAt",
      "updated_at" AS "updatedAt"
    FROM "message_studio_drafts"
    WHERE "guild_id" = ${guildId}
      AND "author_id" = ${authorId}
    ORDER BY "updated_at" DESC
    LIMIT 50
  `;
  return rows.flatMap((row) => {
    const payload = parseMessageStudioDraftPayload(row.payload);
    return payload ? [{ ...row, payload }] : [];
  });
}

export async function saveMessageStudioDraft(
  guildId: string,
  authorId: string,
  input: { id?: string; name: string; payload: MessageStudioDraftPayload },
): Promise<MessageStudioDraftRecord> {
  const id = input.id && isUuid(input.id) ? input.id : randomUUID();
  const payloadJson = JSON.stringify(input.payload);
  const rows = await prisma.$queryRaw<DraftRow[]>`
    INSERT INTO "message_studio_drafts" (
      "id", "guild_id", "author_id", "name", "payload", "created_at", "updated_at"
    ) VALUES (
      ${id}::uuid,
      ${guildId},
      ${authorId},
      ${input.name},
      ${payloadJson}::jsonb,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT ("id") DO UPDATE SET
      "name" = EXCLUDED."name",
      "payload" = EXCLUDED."payload",
      "updated_at" = CURRENT_TIMESTAMP
    WHERE "message_studio_drafts"."guild_id" = ${guildId}
      AND "message_studio_drafts"."author_id" = ${authorId}
    RETURNING
      "id"::text AS "id",
      "guild_id" AS "guildId",
      "author_id" AS "authorId",
      "name",
      "payload",
      "created_at" AS "createdAt",
      "updated_at" AS "updatedAt"
  `;
  const row = rows[0];
  if (!row) throw new Error('draft_not_owned');
  return { ...row, payload: input.payload };
}

export async function deleteMessageStudioDraft(
  guildId: string,
  authorId: string,
  id: string,
): Promise<boolean> {
  if (!isUuid(id)) return false;
  const count = await prisma.$executeRaw`
    DELETE FROM "message_studio_drafts"
    WHERE "id" = ${id}::uuid
      AND "guild_id" = ${guildId}
      AND "author_id" = ${authorId}
  `;
  return count > 0;
}

export function parseMessageStudioDraftPayload(value: unknown): MessageStudioDraftPayload | null {
  if (!isRecord(value)) return null;
  const messageFormat = value.messageFormat;
  if (messageFormat !== 'text' && messageFormat !== 'embed' && messageFormat !== 'voice') return null;
  if (!Array.isArray(value.embedFields) || value.embedFields.length > 25) return null;
  const embedFields: MessageStudioDraftPayload['embedFields'] = [];
  for (const field of value.embedFields) {
    if (!isRecord(field)) return null;
    const name = stringValue(field.name, 256);
    const fieldValue = stringValue(field.value, 1024);
    if (name === null || fieldValue === null) return null;
    embedFields.push({ name, value: fieldValue, inline: field.inline === true });
  }

  const channelId = stringValue(value.channelId, 20);
  const forumTitle = stringValue(value.forumTitle, 100);
  const content = stringValue(value.content, 4_000, false);
  const embedTitle = stringValue(value.embedTitle, 256, false);
  const embedDescription = stringValue(value.embedDescription, 4_096, false);
  const embedColor = stringValue(value.embedColor, 7);
  const embedImageUrl = stringValue(value.embedImageUrl, 2_048, false);
  const embedThumbnailUrl = stringValue(value.embedThumbnailUrl, 2_048, false);
  const embedFooterText = stringValue(value.embedFooterText, 2_048, false);
  if (
    channelId === null ||
    forumTitle === null ||
    content === null ||
    embedTitle === null ||
    embedDescription === null ||
    embedColor === null ||
    embedImageUrl === null ||
    embedThumbnailUrl === null ||
    embedFooterText === null ||
    !/^#[0-9A-Fa-f]{6}$/u.test(embedColor)
  ) {
    return null;
  }

  return {
    channelId,
    forumTitle,
    content,
    messageFormat,
    embedTitle,
    embedDescription,
    embedColor,
    embedImageUrl,
    embedThumbnailUrl,
    embedFooterText,
    embedFields,
    publishAnnouncement: value.publishAnnouncement === true,
  };
}

export function toDraftJson(record: MessageStudioDraftRecord) {
  return {
    id: record.id,
    name: record.name,
    payload: record.payload,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function stringValue(value: unknown, max: number, trim = true): string | null {
  if (typeof value !== 'string' || value.length > max) return null;
  return trim ? value.trim() : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}
