import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Clock3, ShieldAlert, UserRound } from 'lucide-react';
import {
  getModerationCase,
  normalizeModerationConfig,
  type ModerationCaseAction,
  type ModerationCaseRecord,
  type ModerationCaseStatus,
  type ModerationPrismaClient,
} from '@herta/plugin-catalog/moderation-service';
import { auth } from '@/auth';
import { ModerationCaseEditor } from '@/components/moderation-case-editor';
import { prisma } from '@/lib/db';
import { getDiscordAccessToken } from '@/lib/session';
import { getManageableGuild, persistSelectedGuild } from '@/lib/guilds';
import { getGuildPlugin } from '@/lib/guild-plugins';

export const dynamic = 'force-dynamic';

export default async function ModerationCaseDetailPage({
  params,
}: {
  params: Promise<{ guildId: string; caseNumber: string }>;
}) {
  const { guildId, caseNumber: caseNumberInput } = await params;
  const caseNumber = Number(caseNumberInput);
  if (!Number.isSafeInteger(caseNumber) || caseNumber < 1) notFound();

  const session = await auth();
  const accessToken = await getDiscordAccessToken();
  if (!session?.user || !accessToken) notFound();

  const guild = await getManageableGuild(accessToken, guildId);
  if (!guild) notFound();
  await persistSelectedGuild(guild, session.user.id);

  const plugin = await getGuildPlugin(guildId, 'moderation');
  if (!plugin) notFound();
  const config = normalizeModerationConfig(plugin.config);

  let moderationCase: Awaited<ReturnType<typeof getModerationCase>> = null;
  let loadError: string | null = null;
  try {
    moderationCase = await getModerationCase(
      prisma as unknown as ModerationPrismaClient,
      guildId,
      caseNumber,
    );
  } catch (error) {
    console.error('Moderation case detail failed to load', error);
    loadError = 'ケース詳細を取得できませんでした。時間をおいて再読み込みしてください。';
  }
  if (!moderationCase && !loadError) notFound();

  return (
    <div>
      <Link
        href={`/dashboard/guilds/${guildId}/moderation`}
        className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> ケース一覧へ戻る
      </Link>

      <div className="mt-6">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-semibold tracking-tight">Moderation Case #{caseNumber}</h1>
        </div>
        <p className="mt-2 text-sm text-muted">{guild.name} のモデレーション操作詳細です。</p>
      </div>

      {loadError || !moderationCase ? (
        <div className="mt-6 rounded-2xl border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive">
          {loadError ?? 'ケース詳細を表示できませんでした。'}
        </div>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.75fr)]">
          <section className="rounded-2xl border border-border bg-surface p-6 shadow-card">
            <div className="grid gap-5 sm:grid-cols-2">
              <Detail label="種別" value={actionLabel(moderationCase.action)} />
              <Detail label="状態" value={statusLabel(moderationCase.status)} />
              <Detail label="対象ユーザーID" value={moderationCase.targetUserId} mono />
              <Detail label="実行者ID" value={moderationCase.moderatorUserId} mono />
              <Detail
                label="期間"
                value={
                  moderationCase.durationSeconds
                    ? `${Math.ceil(moderationCase.durationSeconds / 60)}分`
                    : '期間指定なし'
                }
              />
              <Detail label="操作元" value={sourceLabel(moderationCase.source)} />
              {moderationCase.originDetectionId ? (
                <div className="min-w-0 sm:col-span-2">
                  <dt className="text-xs text-muted">元の自動検知</dt>
                  <dd className="mt-1 flex min-w-0 flex-col gap-1 text-sm sm:flex-row sm:items-center">
                    <span className="break-all font-mono text-xs">
                      {moderationCase.originDetectionId}
                    </span>
                    <Link
                      href={`/dashboard/guilds/${guildId}/moderation/detections?detectionId=${encodeURIComponent(
                        moderationCase.originDetectionId,
                      )}#detection-${encodeURIComponent(moderationCase.originDetectionId)}`}
                      className="text-primary hover:underline sm:ml-2"
                    >
                      自動検知レビューを開く
                    </Link>
                  </dd>
                </div>
              ) : null}
            </div>

            <div className="mt-6 border-t border-border pt-5">
              <div className="flex items-center gap-2 text-sm font-medium">
                <UserRound className="h-4 w-4 text-muted" /> 理由
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">
                {moderationCase.reason ?? '理由は登録されていません。'}
              </p>
            </div>

            <div className="mt-6 border-t border-border pt-5">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Clock3 className="h-4 w-4 text-muted" /> タイムライン
              </div>
              <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted">作成日時</dt>
                  <dd className="mt-1">{formatDate(moderationCase.createdAt)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">更新日時</dt>
                  <dd className="mt-1">{formatDate(moderationCase.updatedAt)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">有効期限</dt>
                  <dd className="mt-1">
                    {moderationCase.expiresAt ? formatDate(moderationCase.expiresAt) : 'なし'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Discord参照ID</dt>
                  <dd className="mt-1 font-mono text-xs">
                    {moderationCase.discordActionId ?? 'なし'}
                  </dd>
                </div>
              </dl>
            </div>
          </section>

          <ModerationCaseEditor
            guildId={guildId}
            caseNumber={moderationCase.caseNumber}
            initialReason={moderationCase.reason}
            initialStatus={moderationCase.status}
            maxReasonLength={config.maxReasonLength}
          />
        </div>
      )}
    </div>
  );
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`mt-1 text-sm ${mono ? 'font-mono text-xs' : ''}`}>{value}</dd>
    </div>
  );
}

function actionLabel(action: ModerationCaseAction): string {
  return {
    flag: '検知フラグ',
    warn: '警告',
    delete: 'メッセージ削除',
    warn_delete: '警告 + 削除',
    timeout: 'タイムアウト',
    role: 'Role付与',
    blacklist: 'ブラックリスト',
    kick: 'Kick',
    ban: 'BAN',
  }[action];
}

function statusLabel(status: ModerationCaseStatus): string {
  return { active: '有効', completed: '完了', revoked: '解除済み', failed: '失敗' }[status];
}

function sourceLabel(source: ModerationCaseRecord['source']): string {
  return { discord: 'Discord', dashboard: 'Herta Studio', automatic: '自動検知' }[source];
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Tokyo',
  }).format(value);
}
