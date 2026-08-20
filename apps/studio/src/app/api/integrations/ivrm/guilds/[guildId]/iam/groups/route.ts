import { createStudioAccessGroupWithId, listStudioAccessGroups } from '@herta/db';
import { NextResponse } from 'next/server';
import { RequestBodyTooLargeError, readRequestBodyBytes } from '@/lib/bounded-request-body';
import { prisma } from '@/lib/db';
import {
  createIvrmIamMutationUuid,
  parseIvrmIamGroupCreateInput,
  readIvrmIamMutationContext,
} from '@/lib/ivrm-iam-mutation';
import { authorizeIvrmIntegrationRequest } from '@/lib/ivrm-integration-auth';
import { isPrismaRawUniqueViolation } from '@/lib/prisma-raw-error';

export const dynamic = 'force-dynamic';
const MAX_GROUP_BODY_BYTES = 16 * 1024;

export async function POST(request: Request, { params }: { params: Promise<{ guildId: string }> }) {
  const authorization = authorizeIvrmIntegrationRequest(request);
  if (authorization.status === 'unconfigured') {
    return json({ error: 'ivRooom integration is not configured' }, { status: 503 });
  }
  if (authorization.status === 'unauthorized') {
    return json(
      { error: 'Unauthorized' },
      {
        status: 401,
        headers: { 'WWW-Authenticate': 'Bearer realm="ivrm-integration"' },
      },
    );
  }

  const { guildId } = await params;
  if (guildId !== authorization.config.guildId) {
    return json({ error: 'Not found' }, { status: 404 });
  }

  const mutation = readIvrmIamMutationContext(request);
  if (!mutation) {
    return json({ error: 'Invalid mutation context' }, { status: 400 });
  }

  const body = await parseJsonBody(request);
  if ('response' in body) return body.response;

  const input = parseIvrmIamGroupCreateInput(body.value);
  if (!input) {
    return json({ error: 'Group name or description is invalid' }, { status: 400 });
  }

  const groupId = createIvrmIamMutationUuid(guildId, mutation.idempotencyKey, 'group-create');

  try {
    const current = await listStudioAccessGroups(prisma, guildId);
    const replay = resolveReplay(current, groupId, input);
    if (replay.status === 'replayed') {
      return groupResponse(replay.group, true, 200);
    }
    if (replay.status === 'conflict') {
      return json({ error: replay.message }, { status: 409 });
    }

    const duplicateName = current.some(
      (group) => group.name.toLocaleLowerCase() === input.name.toLocaleLowerCase(),
    );
    if (duplicateName) {
      return json({ error: 'A group with the same name already exists' }, { status: 409 });
    }

    const group = await createStudioAccessGroupWithId(prisma, {
      id: groupId,
      guildId,
      name: input.name,
      description: input.description,
      actorId: mutation.actorId,
    });

    await recordAudit(guildId, mutation.actorId, group.id, group.name);
    return groupResponse(group, false, 201);
  } catch (error) {
    if (isPrismaRawUniqueViolation(error)) {
      const current = await listStudioAccessGroups(prisma, guildId);
      const replay = resolveReplay(current, groupId, input);
      if (replay.status === 'replayed') {
        return groupResponse(replay.group, true, 200);
      }
      if (replay.status === 'conflict') {
        return json({ error: replay.message }, { status: 409 });
      }
      return json({ error: 'A group with the same name already exists' }, { status: 409 });
    }

    console.error('Failed to create ivRooom IAM access group', {
      guildId,
      actorId: mutation.actorId,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    return json({ error: 'Access group could not be created' }, { status: 500 });
  }
}

function resolveReplay(
  groups: Awaited<ReturnType<typeof listStudioAccessGroups>>,
  groupId: string,
  input: { name: string; description: string | null },
) {
  const existing = groups.find((group) => group.id === groupId);
  if (!existing) return { status: 'none' as const };

  if (existing.name === input.name && existing.description === input.description) {
    return { status: 'replayed' as const, group: existing };
  }

  return {
    status: 'conflict' as const,
    message: 'Idempotency key was already used with a different payload',
  };
}

function groupResponse(
  group: Awaited<ReturnType<typeof listStudioAccessGroups>>[number],
  replayed: boolean,
  status: number,
) {
  const response = json(
    {
      status: 'ok',
      replayed,
      group: {
        id: group.id,
        name: group.name,
        description: group.description,
        updatedAt: group.updatedAt.toISOString(),
      },
    },
    { status },
  );
  if (replayed) response.headers.set('Idempotency-Replayed', 'true');
  return response;
}

async function parseJsonBody(
  request: Request,
): Promise<{ value: unknown } | { response: Response }> {
  try {
    const bytes = await readRequestBodyBytes(request, MAX_GROUP_BODY_BYTES);
    return { value: JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown };
  } catch (error) {
    return {
      response: json(
        {
          error:
            error instanceof RequestBodyTooLargeError
              ? 'Group payload is too large'
              : 'Invalid JSON',
        },
        { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
      ),
    };
  }
}

async function recordAudit(guildId: string, actorId: string, targetId: string, name: string) {
  try {
    await prisma.auditLog.create({
      data: {
        guildId,
        actorId,
        event: 'studio_access_group.created',
        targetType: 'studio_access_group',
        targetId,
        changes: { name },
        severity: 'warning',
        metadata: { operationSource: 'ivrm-admin', securitySensitive: true },
      },
    });
  } catch (error) {
    console.error('Failed to record ivRooom IAM access group audit log', {
      guildId,
      actorId,
      targetId,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
  }
}

function json(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('Cache-Control', 'private, no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  return NextResponse.json(body, { ...init, headers });
}
