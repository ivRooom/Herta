import { ivrmIamHandlers } from '@/lib/ivrm-iam-runtime';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ guildId: string; policyId: string }> },
) {
  return ivrmIamHandlers.changeAttachmentsBatch(request, await params);
}
