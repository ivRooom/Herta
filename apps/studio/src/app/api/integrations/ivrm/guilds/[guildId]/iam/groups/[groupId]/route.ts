import { ivrmIamHandlers } from '@/lib/ivrm-iam-runtime';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ guildId: string; groupId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  return ivrmIamHandlers.updateGroup(request, await params);
}

export async function DELETE(request: Request, { params }: Params) {
  return ivrmIamHandlers.deleteGroup(request, await params);
}
