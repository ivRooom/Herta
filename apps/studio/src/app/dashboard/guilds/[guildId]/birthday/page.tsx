import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Cake } from 'lucide-react';
import { auth } from '@/auth';
import { BirthdayAdmin } from '@/components/birthday-admin';
import { listBirthdayRegistrations } from '@/lib/birthday-admin';
import { getManageableGuild, persistSelectedGuild } from '@/lib/guilds';
import { getDiscordAccessToken } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function BirthdayAdminPage({
  params,
}: {
  params: Promise<{ guildId: string }>;
}) {
  const { guildId } = await params;
  const session = await auth();
  const accessToken = await getDiscordAccessToken();
  if (!session?.user || !accessToken) notFound();

  const guild = await getManageableGuild(accessToken, guildId);
  if (!guild) notFound();
  await persistSelectedGuild(guild, session.user.id);
  const registrations = await listBirthdayRegistrations(guildId);

  return (
    <div className="space-y-6">
      <Link
        href={`/dashboard/guilds/${guildId}/plugins/birthday-role`}
        className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Birthday Roleへ戻る
      </Link>
      <section className="rounded-3xl border border-primary/20 bg-surface p-6 shadow-card sm:p-8">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Cake className="h-6 w-6" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">
              Birthday Role v1
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              Birthday Management
            </h1>
            <p className="mt-2 text-sm text-muted">
              {guild.name} のメンバー誕生日を管理します。保存するのは月日だけです。
            </p>
          </div>
        </div>
      </section>
      <BirthdayAdmin guildId={guildId} initialRegistrations={registrations} />
    </div>
  );
}
