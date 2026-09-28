import { UserRound } from 'lucide-react';
import type { GuildMemberOption } from '@/lib/bot-guild-members';

const SIZE_CLASSES = {
  sm: { avatar: 'h-6 w-6', icon: 'h-3 w-3', name: 'text-xs' },
  md: { avatar: 'h-8 w-8', icon: 'h-4 w-4', name: 'text-sm' },
} as const;

/** memberが未解決(bot未起動・guild離脱等)の場合はDiscord IDの下6桁で表示する。 */
export function discordMemberDisplayName(
  member: GuildMemberOption | null | undefined,
  userId: string,
): string {
  if (member) return member.displayName || member.username;
  return `User ${userId.slice(-6)}`;
}

export function DiscordMemberIdentity({
  member,
  userId,
  size = 'md',
  subtitle,
}: {
  member: GuildMemberOption | null | undefined;
  userId: string;
  size?: keyof typeof SIZE_CLASSES;
  /** 既定はDiscord User ID。空文字を渡すと非表示にできる。 */
  subtitle?: string;
}) {
  const classes = SIZE_CLASSES[size];
  const name = discordMemberDisplayName(member, userId);

  return (
    <div className="flex min-w-0 items-center gap-2">
      <span
        className={`flex ${classes.avatar} shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-background`}
      >
        {member?.avatarUrl ? (
          <img src={member.avatarUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <UserRound className={`${classes.icon} text-muted`} aria-hidden="true" />
        )}
      </span>
      <span className="min-w-0">
        <span className={`block truncate font-medium ${classes.name}`}>{name}</span>
        {subtitle === '' ? null : (
          <span className="block truncate text-[11px] text-muted">{subtitle ?? userId}</span>
        )}
      </span>
    </div>
  );
}
