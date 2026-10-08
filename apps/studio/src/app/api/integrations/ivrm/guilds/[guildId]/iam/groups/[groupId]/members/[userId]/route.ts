import { ivrmIamHandlers } from '@/lib/ivrm-iam-runtime';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ guildId: string; groupId: string; userId: string }> };

export async function PUT(request: Request, { params }: Params) {
  return ivrmIamHandlers.changeMember(request, await params, 'add');
}

export async function DELETE(request: Request, { params }: Params) {
  return ivrmIamHandlers.changeMember(request, await params, 'remove');
}
