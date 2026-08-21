import { Cake, ShieldCheck } from 'lucide-react';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { BirthdaySelfRegistrationForm } from '@/components/birthday-self-registration-form';
import { getBirthdayRegistration } from '@/lib/birthday-admin';
import { resolveBirthdaySelfRegistrationAccess } from '@/lib/birthday-self-registration-access';

export const dynamic = 'force-dynamic';

const DISCORD_ID_PATTERN = /^\d{17,20}$/u;

export default async function BirthdayRegistrationPage({
  params,
}: {
  params: Promise<{ guildId: string }>;
}) {
  const { guildId } = await params;
  const callbackUrl = `/birthday/register/${guildId}`;
  const session = await auth();

  if (!session?.user?.id) {
    redirect(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  }

  if (!DISCORD_ID_PATTERN.test(guildId)) {
    return (
      <AccessState title="登録URLが正しくありません" detail="共有URLをもう一度確認してください。" />
    );
  }

  const access = await resolveBirthdaySelfRegistrationAccess(guildId, session.user.id);
  if (!access.ok) {
    return access.reason === 'unavailable' ? (
      <AccessState
        title="Discordメンバー情報を確認できません"
        detail="Herta BotまたはBirthday設定の状態を確認できませんでした。時間を置いて再読み込みしてください。"
      />
    ) : (
      <AccessState
        title="Discordサーバーへの参加が必要です"
        detail="この登録ページは対象Discordサーバーに現在参加しているユーザーだけ利用できます。"
      />
    );
  }

  const registration = await getBirthdayRegistration(guildId, session.user.id);

  return (
    <main className="min-h-screen bg-background px-4 py-10 sm:px-6">
      <div className="mx-auto w-full max-w-2xl space-y-5">
        <section className="rounded-3xl border border-border bg-surface p-5 shadow-card sm:p-7">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Cake className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                Herta Birthday
              </p>
              <h1 className="mt-1 text-lg font-semibold">Guildメンバー向け 誕生日登録</h1>
              <p className="mt-2 text-sm leading-6 text-muted">
                Discordでログインした本人の誕生日だけを登録できます。本人登録が有効な場合は、誕生日データがまだない初回ユーザーもこのURLからそのまま登録できます。
              </p>
            </div>
          </div>
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2.5 text-xs leading-5 text-emerald-300">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            対象Guildへの現在の所属、本人のDiscord ID、本人登録設定は保存時にもserver-sideで再確認します。
          </div>
        </section>

        <BirthdaySelfRegistrationForm
          guildId={guildId}
          displayName={access.displayName}
          initialRegistration={registration}
          currentYear={new Date().getUTCFullYear()}
          registrationEnabled={access.registrationEnabled}
        />
      </div>
    </main>
  );
}

function AccessState({ title, detail }: { title: string; detail: string }) {
  return (
    <main className="min-h-screen bg-background px-4 py-10 sm:px-6">
      <section className="mx-auto w-full max-w-xl rounded-3xl border border-border bg-surface p-6 text-center shadow-card sm:p-8">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Cake className="h-6 w-6" aria-hidden="true" />
        </span>
        <h1 className="mt-4 text-xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-muted">{detail}</p>
      </section>
    </main>
  );
}
