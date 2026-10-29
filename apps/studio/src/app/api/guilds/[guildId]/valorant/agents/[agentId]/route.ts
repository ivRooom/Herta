import { valorantAgentRequest } from '@/lib/valorant-agent-api';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ guildId: string; agentId: string }> },
) {
  const { guildId, agentId } = await params;
  return valorantAgentRequest(request, guildId, agentId);
}

export const DELETE = PATCH;
