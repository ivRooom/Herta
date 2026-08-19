import Link from 'next/link';
import { FileKey2, ShieldCheck, UserRound, UsersRound } from 'lucide-react';

export type AccessResourceKind = 'resources' | 'users' | 'groups' | 'roles' | 'policies';

const ITEMS = [
  { id: 'resources', label: 'Resources', path: '', icon: ShieldCheck },
  { id: 'users', label: 'Users', path: 'users', icon: UserRound },
  { id: 'groups', label: 'Groups', path: 'groups', icon: UsersRound },
  { id: 'roles', label: 'Roles', path: 'roles', icon: ShieldCheck },
  { id: 'policies', label: 'Policies', path: 'policies', icon: FileKey2 },
] as const;

export function AccessResourceNavigation({
  guildId,
  active,
  counts,
}: {
  guildId: string;
  active: AccessResourceKind;
  counts?: Partial<Record<Exclude<AccessResourceKind, 'resources'>, number>>;
}) {
  const base = `/dashboard/guilds/${guildId}/access`;
  return (
    <nav className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5" aria-label="Access Control resources">
      {ITEMS.map((item) => {
        const Icon = item.icon;
        const selected = active === item.id;
        const count = item.id === 'resources' ? undefined : counts?.[item.id];
        return (
          <Link
            key={item.id}
            href={item.path ? `${base}/${item.path}` : base}
            aria-current={selected ? 'page' : undefined}
            className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              selected
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-surface hover:border-primary/40'
            }`}
          >
            <span className="flex min-w-0 items-center gap-2">
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{item.label}</span>
            </span>
            {count !== undefined ? (
              <span className="rounded-full border border-border bg-background px-2 py-0.5 text-xs text-muted">
                {count}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
