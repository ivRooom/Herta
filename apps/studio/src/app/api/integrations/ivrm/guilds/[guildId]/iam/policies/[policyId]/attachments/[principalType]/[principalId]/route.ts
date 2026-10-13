import { ivrmIamHandlers } from '@/lib/ivrm-iam-runtime';

export const dynamic = 'force-dynamic';

type Params = {
  params: Promise<{
    guildId: string;
    policyId: string;
    principalType: string;
    principalId: string;
  }>;
};

export async function PUT(request: Request, { params }: Params) {
  return ivrmIamHandlers.changeAttachment(request, await params, 'attach');
}

export async function DELETE(request: Request, { params }: Params) {
  return ivrmIamHandlers.changeAttachment(request, await params, 'detach');
}
