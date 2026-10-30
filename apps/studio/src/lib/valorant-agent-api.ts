import { NextResponse } from 'next/server';
import {
  listValorantAgents,
  mutateValorantAgent,
  validateValorantAgent,
  ValorantAgentError,
  type ValorantAgentMutation,
} from '@herta/db';
import { defaultValorantAgents } from '@herta/plugin-catalog';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { resolveStudioAccess } from '@/lib/studio-access';
import { resolvePluginConfigStudioAccess } from '@/lib/studio-plugin-permissions';
import { isSameOriginMutationRequest } from '@/lib/request-origin';
import { readJsonBodyWithLimit, RequestBodyTooLargeError } from '@/lib/bounded-request-body';

export async function valorantAgentRequest(request: Request, guildId: string, agentId?: string) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: '認証が必要です。' }, { status: 401 });
    const mutation = request.method !== 'GET';
    if (mutation && !isSameOriginMutationRequest(request))
      return NextResponse.json({ error: '不正なリクエスト元です。' }, { status: 403 });
    if (
      !/^\d{17,20}$/.test(guildId) ||
      (agentId !== undefined && !/^[a-z0-9][a-z0-9-]{0,63}$/.test(agentId))
    ) {
      return NextResponse.json({ error: 'IDが不正です。' }, { status: 400 });
    }
    const access = await resolveStudioAccess(guildId, session.user.id);
    if (!access.ok) return access.response;
    // Use the existing enabledAgents policy path: no new implicit IAM grant.
    const permission = resolvePluginConfigStudioAccess(access.access, guildId, 'valorant', [
      'enabledAgents',
    ]);
    const canRead = permission.readableConfigPaths.includes('enabledAgents');
    const canWrite = permission.editableConfigPaths.includes('enabledAgents');
    if (!canRead || (mutation && !canWrite))
      return NextResponse.json({ error: 'エージェント設定の権限がありません。' }, { status: 403 });
    const plugin = await prisma.guildPlugin.findUnique({
      where: { guildId_pluginId: { guildId, pluginId: 'valorant' } },
    });
    const config = plugin?.config as Record<string, unknown> | undefined;
    const defaults = defaultValorantAgents(config?.enabledAgents);
    if (!mutation) {
      const agents = await listValorantAgents(prisma, guildId);
      return NextResponse.json(
        { agents: agents ?? defaults, initialized: agents !== null, canWrite },
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
    }
    let operation: ValorantAgentMutation;
    if (request.method === 'DELETE' && agentId) operation = { action: 'delete', agentId };
    else {
      let body: unknown;
      try {
        body = await readJsonBodyWithLimit(request, 4096);
      } catch (error) {
        return NextResponse.json(
          { error: 'リクエスト本文が不正です。' },
          { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
        );
      }
      if (
        request.method === 'POST' &&
        !agentId &&
        body &&
        typeof body === 'object' &&
        Object.keys(body).length === 1 &&
        'action' in body &&
        body.action === 'initialize'
      ) {
        operation = { action: 'initialize' };
      } else {
        const agent = validateValorantAgent(body);
        if (request.method === 'PATCH' && agentId === agent.agentId)
          operation = { action: 'update', agent };
        else if (request.method === 'POST' && !agentId) operation = { action: 'create', agent };
        else throw new ValorantAgentError(400, 'Agent IDは変更できません。');
      }
    }
    const agents = await mutateValorantAgent(prisma, guildId, session.user.id, operation, defaults);
    return NextResponse.json(
      { agents, initialized: true, canWrite },
      { status: operation.action === 'create' ? 201 : 200 },
    );
  } catch (error) {
    if (error instanceof ValorantAgentError)
      return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Valorant agent request failed', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    return NextResponse.json(
      { error: 'エージェント情報を取得・保存できません。時間をおいて再試行してください。' },
      { status: 503 },
    );
  }
}
