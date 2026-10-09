'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { CornerDownLeft, Search } from 'lucide-react';

export interface PaletteCommand {
  name: string;
  description: string;
  pluginName: string;
}

const MAX_RESULTS = 6;

/**
 * Hertaの実際のコマンド(公式Pluginが登録するSlash Command)を検索できるパレット。
 * 画面に入ると、代表的なコマンドを自動で入力して見せる(1回だけ。操作されたら止まる)。
 * 表示する名前・説明はすべてPluginカタログの実データで、架空の出力は出さない。
 */
export function CommandPalette({
  commands,
  autoplay,
}: {
  commands: readonly PaletteCommand[];
  /** 自動入力で見せるコマンド名 (実在するものだけを渡す) */
  autoplay: readonly string[];
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const stoppedRef = useRef(false);
  const timersRef = useRef<number[]>([]);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [typing, setTyping] = useState(false);

  const results = useMemo(() => {
    const q = query.trim().replace(/^\//, '').toLowerCase();
    const list = q
      ? commands.filter(
          (command) =>
            command.name.toLowerCase().includes(q) ||
            command.description.toLowerCase().includes(q) ||
            command.pluginName.toLowerCase().includes(q),
        )
      : commands;
    return list.slice(0, MAX_RESULTS);
  }, [commands, query]);

  const index = Math.min(active, Math.max(results.length - 1, 0));
  const current = results[index];

  const stopAutoplay = () => {
    stoppedRef.current = true;
    timersRef.current.forEach((id) => window.clearTimeout(id));
    timersRef.current = [];
    setTyping(false);
  };

  // 画面に入ったら、代表コマンドを順に入力して見せる (1回だけ)
  useEffect(() => {
    const root = rootRef.current;
    if (!root || autoplay.length === 0) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (typeof IntersectionObserver === 'undefined') return;

    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        timersRef.current.push(window.setTimeout(resolve, ms));
      });

    const run = async () => {
      setTyping(true);
      await sleep(600);
      for (const name of autoplay) {
        for (let i = 1; i <= name.length; i += 1) {
          if (stoppedRef.current) return;
          setQuery(name.slice(0, i));
          setActive(0);
          await sleep(95);
        }
        await sleep(1700);
        if (stoppedRef.current) return;
        setQuery('');
        await sleep(450);
      }
      setTyping(false);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        void run().catch(() => undefined);
      },
      { threshold: 0.5 },
    );
    observer.observe(root);
    return () => {
      observer.disconnect();
      stoppedRef.current = true;
      timersRef.current.forEach((id) => window.clearTimeout(id));
    };
  }, [autoplay]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((value) => Math.min(value + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((value) => Math.max(value - 1, 0));
    } else if (event.key === 'Escape') {
      setQuery('');
      setActive(0);
    }
  };

  return (
    <div
      ref={rootRef}
      onPointerDown={stopAutoplay}
      onFocusCapture={stopAutoplay}
      className="overflow-hidden rounded-[28px] bg-white text-left shadow-[0_40px_80px_-30px_rgb(0_0_0/0.28),0_0_0_1px_rgb(0_0_0/0.06)]"
    >
      <div className="flex items-center gap-3 border-b border-[var(--line)] px-5 py-4">
        <Search className="h-5 w-5 shrink-0 text-[var(--muted)]" aria-hidden="true" />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded="true"
          aria-controls="lp-cmd-list"
          aria-activedescendant={current ? `lp-cmd-${current.name}` : undefined}
          aria-autocomplete="list"
          aria-label="コマンドを検索"
          placeholder="コマンドを検索…  例: lfg, giveaway"
          autoComplete="off"
          spellCheck={false}
          className="lp-mono min-w-0 flex-1 bg-transparent text-base text-[var(--ink)] outline-none placeholder:text-[#a1a1a6]"
        />
        {typing ? <span className="lp-caret" aria-hidden="true" /> : null}
        <span className="lp-mono hidden rounded border border-[var(--line)] px-1.5 py-0.5 text-[10px] text-[var(--muted)] sm:inline">
          ↑↓
        </span>
      </div>

      <div className="grid md:grid-cols-[1fr_1.05fr]">
        <ul
          id="lp-cmd-list"
          role="listbox"
          aria-label="コマンド"
          className="border-b border-[var(--line)] p-2 md:border-b-0 md:border-r"
        >
          {results.length === 0 ? (
            <li className="px-3 py-6 text-sm text-[var(--muted)]">
              一致するコマンドがありません。
            </li>
          ) : (
            results.map((command, position) => {
              const selected = position === index;
              return (
                <li
                  key={command.name}
                  id={`lp-cmd-${command.name}`}
                  role="option"
                  aria-selected={selected}
                  onMouseEnter={() => setActive(position)}
                  className={`relative flex cursor-default items-center gap-3 rounded-lg px-3 py-2.5 transition-colors ${
                    selected ? 'bg-[var(--surface-2)]' : ''
                  }`}
                >
                  {selected ? (
                    <span
                      aria-hidden="true"
                      className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-[var(--purple)]"
                    />
                  ) : null}
                  <span className="lp-mono shrink-0 text-sm font-medium">/{command.name}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-[var(--muted)]">
                    {command.description}
                  </span>
                  {selected ? (
                    <CornerDownLeft
                      className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]"
                      aria-hidden="true"
                    />
                  ) : null}
                </li>
              );
            })
          )}
        </ul>

        <div className="min-h-[15rem] p-6" aria-live="polite">
          {current ? (
            <div key={current.name} className="lp-msg">
              <p className="lp-mono text-xs text-[var(--muted)]">SLASH COMMAND</p>
              <p className="lp-mono mt-2 text-3xl font-medium tracking-tight">/{current.name}</p>
              <p className="mt-4 text-[15px] leading-7 text-[var(--ink)]">{current.description}</p>
              <div className="mt-6 flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full border border-[var(--line)] px-3 py-1 text-[var(--muted)]">
                  Plugin
                </span>
                <span className="rounded-full bg-[var(--lavender)] px-3 py-1 font-semibold text-[var(--purple)]">
                  {current.pluginName}
                </span>
              </div>
              <p className="mt-5 text-xs leading-6 text-[var(--muted)]">
                管理画面から、サーバーごとに有効・無効を切り替えられます。
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
