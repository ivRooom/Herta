import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { resolveStudioAccess } from '@/lib/studio-access';
import { DailyBonusManager } from '@/components/daily-bonus-manager';
import { withStudioPagePermission } from '@/components/studio-page-permission-boundary';

export const dynamic = 'force-dynamic';
async function DailyBonusPage({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params,
    session = await auth();
  if (!session?.user) notFound();
  const access = await resolveStudioAccess(guildId, session.user.id);
  if (!access.ok) notFound();
  return <DailyBonusManager guildId={guildId} />;
}
export default withStudioPagePermission(DailyBonusPage, 'daily-bonus');
