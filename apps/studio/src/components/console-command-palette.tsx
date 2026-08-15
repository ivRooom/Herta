'use client';

import { usePathname, useRouter } from 'next/navigation';
import { createPortal } from 'react-dom';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import {
  Activity,
  Award,
  BarChart3,
  Cake,
  CalendarDays,
  ChevronRight,
  History,
  LayoutDashboard,
  Medal,
  MessageSquareText,
  Plug,
  Puzzle,
  Search,
  ServerCog,
  ShieldCheck,
  Sparkles,
  Star,
  Swords,
  Trophy,
  UserRound,
  UsersRound,
  X,
  type LucideIcon,
} from 'lucide-react';
import {
  buildCommandPaletteSections,
  clearRecentCommands,
  COMMAND_PALETTE_PREFERENCES_STORAGE_KEY,
  createDefaultCommandPalettePreferences,
  parseCommandPalettePreferences,
  recordRecentCommand,
  serializeCommandPalettePreferences,
  toggleFavoriteCommand,
  type CommandPalettePreferences,
} from '@/lib/command-palette-preferences';
import { getGuildConsoleContext } from '@/lib/guild-context-nav';
import {
  buildStudioCommandItems,
  filterStudioCommandItems,
  type StudioCommandItem,
  type StudioNavigationIcon,
} from '@/lib/studio-navigation';

const COMMAND_PALETTE_OPEN_EVENT = 'herta:command-palette-open';
const RESULTS_ID = 'studio-command-palette-results';

interface CommandPaletteGuild {
  id: string;
  name: string;
}

type OpenEventDetail = { trigger?: HTMLElement | null };

const ICONS: Record<StudioNavigationIcon, LucideIcon> = {
  dashboard: LayoutDashboard,
  server: ServerCog,
  activity: Activity,
  analytics: BarChart3,
  community: Trophy,
  leaderboard: Medal,
  plugin: Plug,
  'custom-plugin': Puzzle,
  history: History,
  rules: Sparkles,
  achievement: Award,
  birthday: Cake,
  daily: CalendarDays,
  lfg: UsersRound,
  moderation: ShieldCheck,
  team: Swords,
  message: MessageSquareText,
  xp: Trophy,
  account: UserRound,
};

export function requestCommandPaletteOpen(trigger?: HTMLElement | null) {
  window.dispatchEvent(
    new CustomEvent<OpenEventDetail>(COMMAND_PALETTE_OPEN_EVENT, {
      detail: { trigger },
    }),
  );
}

export function ConsoleCommandPaletteTrigger({ variant }: { variant: 'desktop' | 'mobile' }) {
  const [shortcutLabel, setShortcutLabel] = useState('Ctrl K');

  useEffect(() => {
    const isMac = /Mac|iPhone|iPad/u.test(navigator.platform);
    setShortcutLabel(isMac ? '⌘K' : 'Ctrl K');
  }, []);

  if (variant === 'mobile') {
    return (
      <button
        type="button"
        aria-label="ページ・機能を検索"
        aria-keyshortcuts="Control+K Meta+K"
        onClick={(event) => requestCommandPaletteOpen(event.currentTarget)}
        className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-surface text-muted transition-colors hover:text-foreground"
      >
        <Search className="h-4 w-4" aria-hidden="true" />
      </button>
    );
  }

  return (
    <button
      type="button"
      aria-label="ページ・機能を検索"
      aria-keyshortcuts="Control+K Meta+K"
      onClick={(event) => requestCommandPaletteOpen(event.currentTarget)}
      className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-surface px-2.5 text-xs font-semibold text-muted transition-colors hover:text-foreground xl:px-3"
    >
      <Search className="h-4 w-4" aria-hidden="true" />
      <span className="hidden xl:inline">検索</span>
      <kbd className="hidden rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted xl:inline">
        {shortcutLabel}
      </kbd>
    </button>
  );
}

export function ConsoleCommandPaletteController({ guilds }: { guilds: CommandPaletteGuild[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [preferences, setPreferences] = useState<CommandPalettePreferences>(() =>
    createDefaultCommandPalettePreferences(),
  );
  const [storageWarning, setStorageWarning] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const preferredActiveCommandIdRef = useRef<string | null>(null);

  const context = getGuildConsoleContext(pathname);
  const currentGuild = context
    ? (guilds.find((guild) => guild.id === context.guildId) ?? null)
    : null;
  const commands = useMemo(
    () => buildStudioCommandItems(context?.guildId ?? null, currentGuild?.name ?? null),
    [context?.guildId, currentGuild?.name],
  );
  const filteredCommands = useMemo(
    () => filterStudioCommandItems(commands, query),
    [commands, query],
  );
  const sections = useMemo(
    () => buildCommandPaletteSections(filteredCommands, preferences, query.trim().length === 0),
    [filteredCommands, preferences, query],
  );
  const visibleCommands = useMemo(
    () => sections.flatMap((section) => section.commands),
    [sections],
  );
  const visibleCommandIndex = useMemo(
    () => new Map(visibleCommands.map((command, index) => [command.id, index])),
    [visibleCommands],
  );
  const activeCommand = visibleCommands[activeIndex] ?? null;
  const activeIsFavorite = activeCommand
    ? preferences.favoriteIds.includes(activeCommand.id)
    : false;

  useEffect(() => {
    try {
      setPreferences(
        parseCommandPalettePreferences(
          window.localStorage.getItem(COMMAND_PALETTE_PREFERENCES_STORAGE_KEY),
        ),
      );
    } catch {
      setStorageWarning(true);
    }

    function handleStorage(event: StorageEvent) {
      if (event.key !== COMMAND_PALETTE_PREFERENCES_STORAGE_KEY) return;
      setPreferences(parseCommandPalettePreferences(event.newValue));
    }

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase('en') === 'k') {
        event.preventDefault();
        if (event.repeat) return;
        if (open) {
          closePalette();
          return;
        }

        triggerRef.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setOpen(true);
        return;
      }
      if (event.key === 'Escape' && open) closePalette();
    }

    function handleOpenEvent(event: Event) {
      const detail = (event as CustomEvent<OpenEventDetail>).detail;
      triggerRef.current = detail?.trigger ?? null;
      setOpen(true);
    }

    window.addEventListener('keydown', handleShortcut);
    window.addEventListener(COMMAND_PALETTE_OPEN_EVENT, handleOpenEvent);
    return () => {
      window.removeEventListener('keydown', handleShortcut);
      window.removeEventListener(COMMAND_PALETTE_OPEN_EVENT, handleOpenEvent);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = requestAnimationFrame(() => inputRef.current?.focus());

    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (visibleCommands.length === 0) {
      preferredActiveCommandIdRef.current = null;
      setActiveIndex(0);
      return;
    }

    const preferredCommandId = preferredActiveCommandIdRef.current;
    if (preferredCommandId) {
      const nextIndex = visibleCommands.findIndex((command) => command.id === preferredCommandId);
      preferredActiveCommandIdRef.current = null;
      if (nextIndex >= 0) {
        setActiveIndex(nextIndex);
        return;
      }
    }

    setActiveIndex((current) => Math.min(current, visibleCommands.length - 1));
  }, [visibleCommands]);

  useEffect(() => {
    if (!open || visibleCommands.length === 0) return;
    const active = document.getElementById(commandOptionId(visibleCommands[activeIndex]?.id));
    active?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open, visibleCommands]);

  function commitPreferences(nextPreferences: CommandPalettePreferences) {
    setPreferences(nextPreferences);
    try {
      window.localStorage.setItem(
        COMMAND_PALETTE_PREFERENCES_STORAGE_KEY,
        serializeCommandPalettePreferences(nextPreferences),
      );
      setStorageWarning(false);
    } catch {
      setStorageWarning(true);
    }
  }

  function closePalette(restoreFocus = true) {
    setOpen(false);
    setQuery('');
    setActiveIndex(0);
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function selectCommand(command: StudioCommandItem) {
    commitPreferences(recordRecentCommand(preferences, command.id));
    closePalette(false);
    router.push(command.href);
  }

  function toggleFavorite(command: StudioCommandItem) {
    preferredActiveCommandIdRef.current = command.id;
    commitPreferences(toggleFavoriteCommand(preferences, command.id));
  }

  function clearRecentHistory() {
    preferredActiveCommandIdRef.current = activeCommand?.id ?? null;
    commitPreferences(clearRecentCommands(preferences));
  }

  function handleDialogKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const targetIsCommandOption = target?.getAttribute('role') === 'option';
    const targetSupportsCommandNavigation = target === inputRef.current || targetIsCommandOption;

    if (
      event.key === 'ArrowDown' &&
      targetSupportsCommandNavigation &&
      visibleCommands.length > 0
    ) {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % visibleCommands.length);
      return;
    }
    if (event.key === 'ArrowUp' && targetSupportsCommandNavigation && visibleCommands.length > 0) {
      event.preventDefault();
      setActiveIndex((current) => (current - 1 + visibleCommands.length) % visibleCommands.length);
      return;
    }
    if (
      event.key === 'Enter' &&
      event.shiftKey &&
      targetSupportsCommandNavigation &&
      activeCommand
    ) {
      event.preventDefault();
      toggleFavorite(activeCommand);
      return;
    }
    if (event.key === 'Enter' && target === inputRef.current && activeCommand) {
      event.preventDefault();
      selectCommand(activeCommand);
      return;
    }
    if (event.key === 'Tab') trapFocus(event);
  }

  function trapFocus(event: ReactKeyboardEvent<HTMLDivElement>) {
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      '[data-command-palette-focusable="true"]',
    );
    if (!focusable || focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-start justify-center bg-black/45 px-4 pt-[12vh] backdrop-blur-sm sm:pt-[16vh]"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) closePalette();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="studio-command-palette-title"
        onKeyDown={handleDialogKeyDown}
        className="w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
      >
        <div className="flex items-center gap-3 border-b border-border px-4 py-3 sm:px-5">
          <Search className="h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
          <label htmlFor="studio-command-palette-input" className="sr-only">
            ページ・機能を検索
          </label>
          <input
            ref={inputRef}
            id="studio-command-palette-input"
            type="search"
            role="combobox"
            aria-expanded="true"
            aria-controls={RESULTS_ID}
            aria-autocomplete="list"
            aria-activedescendant={activeCommand ? commandOptionId(activeCommand.id) : undefined}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value.slice(0, 100));
              setActiveIndex(0);
            }}
            placeholder="ページ・機能を検索..."
            autoComplete="off"
            data-command-palette-focusable="true"
            className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
          />
          <button
            type="button"
            aria-label={
              activeCommand
                ? `「${activeCommand.label}」を${activeIsFavorite ? 'お気に入りから解除' : 'お気に入りに追加'}`
                : 'お気に入り'
            }
            aria-pressed={activeIsFavorite}
            disabled={!activeCommand}
            onClick={() => {
              if (activeCommand) toggleFavorite(activeCommand);
            }}
            data-command-palette-focusable="true"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Star
              className={`h-4 w-4 ${activeIsFavorite ? 'fill-current text-primary' : ''}`}
              aria-hidden="true"
            />
          </button>
          <button
            type="button"
            aria-label="検索を閉じる"
            onClick={() => closePalette()}
            data-command-palette-focusable="true"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-background hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="border-b border-border/70 px-5 py-2.5 text-xs text-muted">
          <span id="studio-command-palette-title" className="font-medium text-foreground">
            Herta Studio Command Palette
          </span>
          {currentGuild ? <span> · 現在のサーバー: {currentGuild.name}</span> : null}
        </div>

        <div id={RESULTS_ID} role="listbox" className="max-h-[min(62vh,32rem)] overflow-y-auto p-2">
          {visibleCommands.length === 0 ? (
            <div role="status" className="px-4 py-10 text-center">
              <Search className="mx-auto h-7 w-7 text-muted" aria-hidden="true" />
              <p className="mt-3 text-sm font-medium">一致するページ・機能がありません</p>
              <p className="mt-1 text-xs text-muted">別のキーワードで検索してください。</p>
            </div>
          ) : (
            sections.map((section) => {
              const groupId = `studio-command-group-${section.id}`;

              return (
                <div key={section.id} role="group" aria-labelledby={groupId} className="py-1">
                  <div
                    id={groupId}
                    className="px-3 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted"
                  >
                    {section.label}
                    {section.id === 'current-server' && currentGuild
                      ? ` · ${currentGuild.name}`
                      : ''}
                  </div>
                  <div role="presentation" className="space-y-0.5">
                    {section.commands.map((command) => {
                      const index = visibleCommandIndex.get(command.id) ?? -1;
                      const active = index === activeIndex;
                      const current = pathname === command.href;
                      const favorite = preferences.favoriteIds.includes(command.id);
                      const Icon = ICONS[command.icon];

                      return (
                        <button
                          key={command.id}
                          id={commandOptionId(command.id)}
                          type="button"
                          role="option"
                          aria-selected={active}
                          onFocus={() => setActiveIndex(index)}
                          onMouseMove={() => setActiveIndex(index)}
                          onClick={() => selectCommand(command)}
                          data-command-palette-focusable="true"
                          className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
                            active ? 'bg-primary/10 text-foreground' : 'hover:bg-background'
                          }`}
                        >
                          <span
                            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                              active ? 'bg-primary/15 text-primary' : 'bg-background text-muted'
                            }`}
                          >
                            <Icon className="h-4 w-4" aria-hidden="true" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex min-w-0 items-center gap-2">
                              <span className="truncate text-sm font-medium">{command.label}</span>
                              {current ? (
                                <span className="shrink-0 text-[10px] font-semibold text-primary">
                                  現在
                                </span>
                              ) : null}
                            </span>
                            <span className="mt-0.5 block truncate text-xs text-muted">
                              {command.description}
                            </span>
                          </span>
                          {favorite ? (
                            <Star
                              className="h-3.5 w-3.5 shrink-0 fill-current text-primary"
                              aria-hidden="true"
                            />
                          ) : null}
                          <ChevronRight
                            className={`h-4 w-4 shrink-0 ${active ? 'text-primary' : 'text-muted'}`}
                            aria-hidden="true"
                          />
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border bg-background/60 px-4 py-2 text-[10px] text-muted sm:px-5">
          <span>↑↓ 選択</span>
          <span>Enter 移動</span>
          <span>Shift+Enter ★</span>
          <span>Esc 閉じる</span>
          <span role="status">
            {storageWarning
              ? '保存できないためこのタブのみ有効'
              : '履歴・お気に入りはこの端末に保存'}
          </span>
          {preferences.recentIds.length > 0 ? (
            <button
              type="button"
              onClick={clearRecentHistory}
              data-command-palette-focusable="true"
              className="ml-auto font-semibold text-muted underline-offset-2 transition-colors hover:text-foreground hover:underline"
            >
              最近使った項目をクリア
            </button>
          ) : !currentGuild ? (
            <span className="ml-auto">サーバー固有機能はGuild画面で表示</span>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function commandOptionId(commandId: string | undefined): string {
  return `studio-command-option-${commandId ?? 'none'}`;
}
