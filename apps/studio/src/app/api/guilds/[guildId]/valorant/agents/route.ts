import { valorantAgentRequest } from '@/lib/valorant-agent-api';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ guildId: string }> }) {
  return valorantAgentRequest(request, (await params).guildId);
}

export const POST = GET;
