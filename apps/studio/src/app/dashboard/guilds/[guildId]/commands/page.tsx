import Link from 'next/link';
import { AlertTriangle, ArrowLeft, ListTree } from 'lucide-react';
import { notFound } from 'next/navigation';
import { CommandCatalog } from '@/components/command-catalog';
import { ReconnectNotice } from '@/components/reconnect-notice';
import {
  BotCommandCatalogError,
  getBotGuildCommandCatalog,
  type BotGuildCommandCatalog,
} from '@/lib/bot-command-catalog';
import { getManageableGuild } from '@/lib/guilds';
import { getDiscordAccessToken } from '@/lib/session';
import { auth } from '@/auth';

export const dynamic = 'force-dynamic';

export default async function GuildCommandsPage({
  params,
}: {
  params: Promise<{ guildId: string }>;
}) {
  const session = await auth();
  const accessToken = await getDiscordAccessToken();
  const { guildId } = await params;

  if (!accessToken || !session?.user) {
    return (
      <div className="space-y-6">
        <PageHeader guildId={guildId} guildName="Command Catalog" />
        <ReconnectNotice />
      </div>
    );
  }

  const guild = await getManageableGuild(accessToken, guildId);
  if (!guild) notFound();

  let catalog: BotGuildCommandCatalog | null = null;
  let catalogError: number | null = null;
  try {
    catalog = await getBotGuildCommandCatalog(guildId);
  } catch (error) {
    catalogError = error instanceof BotCommandCatalogError ? error.status : 502;
  }

  return (
    <div className="space-y-7">
      <PageHeader guildId={guildId} guildName={guild.name} />

      {catalog ? (
        <CommandCatalog commands={catalog.commands} />
      ) : (
        <CatalogUnavailable guildId={guildId} status={catalogError ?? 502} />
      )}
    </div>
  );
}

function PageHeader({ guildId, guildName }: { guildId: string; guildName: string }) {
  return (
    <>
      <Link
        href={`/dashboard/guilds/${guildId}`}
        className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> サーバー概要へ戻る
      </Link>
      <section className="relative overflow-hidden rounded-3xl border border-primary/20 bg-surface p-6 shadow-card sm:p-8">
        <div className="pointer-events-none absolute -right-20 -top-20 h-60 w-60 rounded-full bg-primary/15 blur-3xl" />
        <div className="relative flex items-start gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <ListTree className="h-6 w-6" aria-hidden="true" />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">
              {guildName}
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
              Command Catalog
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
              Discordへ実際に登録されているSlash Commandを確認します。Coreと有効Plugin由来を区別し、使い方・オプション・選択肢まで検索できます。
            </p>
          </div>
        </div>
      </section>
    </>
  );
}

function CatalogUnavailable({ guildId, status }: { guildId: string; status: number }) {
  const message =
    status === 429
      ? 'Discord APIのレート制限に達しています。しばらくしてから再読み込みしてください。'
      : status === 404
        ? 'BotからこのDiscordサーバーを確認できませんでした。Botが参加しているか確認してください。'
        : status === 503
          ? 'Bot内部APIまたはDiscord接続が利用できません。Botの稼働状況を確認してください。'
          : 'Command Catalogの応答を検証できませんでした。BotとStudioのデプロイ世代を確認してください。';

  return (
    <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5 shadow-card sm:p-6">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
          <AlertTriangle className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">Command Catalogを取得できません</h2>
          <p className="mt-1 text-sm leading-6 text-muted">{message}</p>
          <Link
            href={`/dashboard/guilds/${guildId}/commands`}
            className="mt-4 inline-flex rounded-xl border border-border bg-background px-3 py-2 text-xs font-semibold transition hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            再読み込み
          </Link>
        </div>
      </div>
    </section>
  );
}
