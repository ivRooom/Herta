'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Circle, Terminal } from 'lucide-react';
import {
  executeGuildConsoleCommand,
  GUILD_CONSOLE_HISTORY_LIMIT,
  GUILD_CONSOLE_MAX_INPUT_LENGTH,
  type GuildConsoleContext,
} from '@/lib/guild-console';

interface TerminalEntry {
  id: number;
  command: string | null;
  lines: string[];
  tone: 'normal' | 'error' | 'system';
}

const QUICK_COMMANDS = ['status', 'plugins', 'commands', 'attention'] as const;

export function GuildConsoleTerminal({ context }: { context: GuildConsoleContext }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const nextId = useRef(3);
  const [input, setInput] = useState('');
  const [entries, setEntries] = useState<TerminalEntry[]>([
    {
      id: 1,
      command: null,
      lines: [`Herta Console v1 — ${context.guildName}`],
      tone: 'system',
    },
    {
      id: 2,
      command: null,
      lines: ["read-only mode / 'help' で利用可能なコマンドを表示"],
      tone: 'system',
    },
  ]);

  const appendEntry = (entry: Omit<TerminalEntry, 'id'>) => {
    const id = nextId.current;
    nextId.current += 1;
    setEntries((current) =>
      [...current, { ...entry, id }].slice(-GUILD_CONSOLE_HISTORY_LIMIT),
    );
  };

  const runCommand = (rawCommand: string) => {
    const command = rawCommand.trim();
    if (!command) return;

    const result = executeGuildConsoleCommand(rawCommand, context);
    if (result.type === 'clear') {
      setEntries([]);
      setInput('');
      inputRef.current?.focus();
      return;
    }

    appendEntry({
      command,
      lines: result.lines,
      tone: result.type === 'output' ? result.tone : 'normal',
    });
    setInput('');
    inputRef.current?.focus();

    if (result.type === 'navigate') router.push(result.href);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    runCommand(input);
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-700/70 bg-[#080b10] shadow-card">
      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950/80 px-4 py-3">
        <div className="flex items-center gap-2 text-xs font-medium text-slate-300">
          <Terminal className="h-4 w-4 text-emerald-400" aria-hidden="true" />
          Herta Console
        </div>
        <div className="flex items-center gap-1.5" aria-hidden="true">
          <Circle className="h-2.5 w-2.5 fill-red-400 text-red-400" />
          <Circle className="h-2.5 w-2.5 fill-amber-400 text-amber-400" />
          <Circle className="h-2.5 w-2.5 fill-emerald-400 text-emerald-400" />
        </div>
      </div>

      <div
        className="h-72 overflow-y-auto px-4 py-4 font-mono text-xs leading-6 text-slate-300 sm:text-sm"
        role="log"
        aria-live="polite"
        aria-label="Herta Console出力"
      >
        {entries.length === 0 ? (
          <p className="text-slate-500">Terminal履歴は空です。</p>
        ) : (
          entries.map((entry) => (
            <div key={entry.id} className="mb-3 last:mb-0">
              {entry.command ? (
                <p className="break-all text-slate-100">
                  <span className="text-emerald-400">herta@{context.guildName}</span>
                  <span className="text-slate-500">:~$ </span>
                  {entry.command}
                </p>
              ) : null}
              {entry.lines.map((line, index) => (
                <p
                  key={`${entry.id}-${index}`}
                  className={`break-words ${
                    entry.tone === 'error'
                      ? 'text-amber-300'
                      : entry.tone === 'system'
                        ? 'text-slate-500'
                        : 'text-slate-300'
                  }`}
                >
                  {line}
                </p>
              ))}
            </div>
          ))
        )}
      </div>

      <div className="border-t border-slate-800 px-4 py-3">
        <div className="mb-3 flex flex-wrap gap-2" aria-label="クイックコマンド">
          {QUICK_COMMANDS.map((command) => (
            <button
              key={command}
              type="button"
              onClick={() => runCommand(command)}
              className="rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 font-mono text-[11px] text-slate-400 transition-colors hover:border-emerald-500/50 hover:text-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
            >
              {command}
            </button>
          ))}
        </div>
        <form onSubmit={handleSubmit} aria-label="Herta Consoleコマンド入力">
          <label htmlFor="guild-console-command" className="sr-only">
            Herta Consoleコマンド
          </label>
          <div className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 focus-within:border-emerald-500/60 focus-within:ring-1 focus-within:ring-emerald-500/40">
            <span className="shrink-0 font-mono text-sm text-emerald-400" aria-hidden="true">
              $
            </span>
            <input
              ref={inputRef}
              id="guild-console-command"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              maxLength={GUILD_CONSOLE_MAX_INPUT_LENGTH}
              autoComplete="off"
              spellCheck={false}
              placeholder="help"
              className="min-w-0 flex-1 bg-transparent font-mono text-sm text-slate-100 outline-none placeholder:text-slate-600"
              aria-describedby="guild-console-help"
            />
            <button
              type="submit"
              className="shrink-0 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
            >
              Run
            </button>
          </div>
          <p id="guild-console-help" className="mt-2 text-[11px] leading-5 text-slate-500">
            Herta専用のread-only commandのみ実行できます。OS shellや任意Discord操作は実行されません。
          </p>
        </form>
      </div>
    </section>
  );
}
