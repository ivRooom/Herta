import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function PluginPermissionsPage({
  params,
}: {
  params: Promise<{ guildId: string }>;
}) {
  const { guildId } = await params;
  redirect(`/dashboard/guilds/${guildId}/access`);
}
