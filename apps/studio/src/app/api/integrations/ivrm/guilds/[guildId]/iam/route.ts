import {
  listManagedStudioAccessPolicies,
  listStudioAccessGroupMembers,
  listStudioAccessGroups,
  listStudioAccessPolicyAttachments,
} from '@herta/db';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { authorizeIvrmIntegrationRequest } from '@/lib/ivrm-integration-auth';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const authorization = authorizeIvrmIntegrationRequest(request);

  if (authorization.status === 'unconfigured') {
    return json(
      { error: 'ivRooom integration is not configured' },
      { status: 503 },
    );
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

  try {
    const [groups, groupMembers, policies, policyAttachments] = await Promise.all([
      listStudioAccessGroups(prisma, guildId),
      listStudioAccessGroupMembers(prisma, guildId),
      listManagedStudioAccessPolicies(prisma, guildId),
      listStudioAccessPolicyAttachments(prisma, guildId),
    ]);

    return json({
      status: 'ok',
      guildId,
      groups: groups.map((group) => ({
        id: group.id,
        name: group.name,
        description: group.description,
        updatedAt: group.updatedAt.toISOString(),
      })),
      groupMembers: groupMembers.map((member) => ({
        groupId: member.groupId,
        userId: member.userId,
      })),
      policies: policies.map((policy) => ({
        id: policy.id,
        name: policy.name,
        description: policy.description,
        revision: policy.revision,
        updatedAt: policy.updatedAt.toISOString(),
      })),
      policyAttachments: policyAttachments.map((attachment) => ({
        policyId: attachment.policyId,
        principalType: attachment.principalType,
        principalId: attachment.principalId,
      })),
    });
  } catch (error) {
    console.error('Failed to load ivRooom IAM integration overview', {
      guildId,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });

    return json({ error: 'IAM overview is unavailable' }, { status: 500 });
  }
}

function json(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('Cache-Control', 'private, no-store');
  headers.set('X-Content-Type-Options', 'nosniff');

  return NextResponse.json(body, { ...init, headers });
}
