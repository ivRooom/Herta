export const GUILD_CONSOLE_MAX_INPUT_LENGTH = 120;
export const GUILD_CONSOLE_HISTORY_LIMIT = 40;
export const GUILD_CONSOLE_COMMAND_HISTORY_LIMIT = 20;

export interface GuildConsoleContext {
  guildId: string;
  guildName: string;
  enabledPlugins: number;
  totalPlugins: number;
  commands7d: number;
  failedCommands7d: number;
  commandSuccessRate7d: number;
  attentionCount: number;
  openSuggestions: number;
  failedReminders: number;
}

export type GuildConsoleResult =
  | { type: 'output'; lines: string[]; tone: 'normal' | 'error' }
  | { type: 'clear' }
  | { type: 'navigate'; href: string; lines: string[] };

export interface GuildConsoleCommandSuggestion {
  command: string;
  description: string;
}

export interface GuildConsoleHistoryStep {
  cursor: number | null;
  value: string;
}

const HELP_LINES = [
  'help                 利用可能なコマンドを表示',
  'status               Guildの運用サマリーを表示',
  'plugins              Pluginの有効化状況を表示',
  'commands             直近7日のCommand実行状況を表示',
  'attention            要確認項目を表示',
  'open <target>        管理画面を開く (plugins / commands / moderation / audit)',
  'clear                Terminal履歴を消去',
] as const;

const OPEN_TARGETS = {
  plugins: 'plugins',
  commands: 'commands',
  moderation: 'moderation',
  audit: 'audit-logs',
} as const;

const COMMAND_SUGGESTIONS: readonly GuildConsoleCommandSuggestion[] = [
  { command: 'help', description: '利用可能なread-only commandを表示' },
  { command: 'status', description: 'Guildの運用サマリーを表示' },
  { command: 'plugins', description: 'Pluginの有効化状況を表示' },
  { command: 'commands', description: '直近7日のCommand実行状況を表示' },
  { command: 'attention', description: '要確認項目を表示' },
  { command: 'open plugins', description: 'Plugin Managerを開く' },
  { command: 'open commands', description: 'Command一覧を開く' },
  { command: 'open moderation', description: 'Moderationを開く' },
  { command: 'open audit', description: 'Audit Logを開く' },
  { command: 'clear', description: 'Terminal表示履歴を消去' },
];

export function getGuildConsoleCommandSuggestions(
  rawInput: string,
  limit = 5,
): GuildConsoleCommandSuggestion[] {
  const normalized = rawInput.trimStart().toLocaleLowerCase('ja');
  if (!normalized || normalized.length > GUILD_CONSOLE_MAX_INPUT_LENGTH || limit <= 0) return [];

  const prefixMatches = COMMAND_SUGGESTIONS.filter(
    (candidate) => candidate.command !== normalized && candidate.command.startsWith(normalized),
  );
  const containsMatches = COMMAND_SUGGESTIONS.filter(
    (candidate) =>
      candidate.command !== normalized &&
      !candidate.command.startsWith(normalized) &&
      candidate.command.includes(normalized),
  );

  return [...prefixMatches, ...containsMatches].slice(0, Math.min(limit, 8));
}

export function addGuildConsoleCommandHistory(
  history: readonly string[],
  rawCommand: string,
): string[] {
  const command = rawCommand.trim();
  if (!command) return [...history];
  if (history.at(-1) === command) return [...history];
  return [...history, command].slice(-GUILD_CONSOLE_COMMAND_HISTORY_LIMIT);
}

export function stepGuildConsoleCommandHistory(
  history: readonly string[],
  cursor: number | null,
  direction: 'older' | 'newer',
): GuildConsoleHistoryStep {
  if (history.length === 0) return { cursor: null, value: '' };

  if (direction === 'older') {
    const nextCursor = cursor === null ? history.length - 1 : Math.max(0, cursor - 1);
    return { cursor: nextCursor, value: history[nextCursor] ?? '' };
  }

  if (cursor === null) return { cursor: null, value: '' };
  const nextCursor = cursor + 1;
  if (nextCursor >= history.length) return { cursor: null, value: '' };
  return { cursor: nextCursor, value: history[nextCursor] ?? '' };
}

export function executeGuildConsoleCommand(
  rawInput: string,
  context: GuildConsoleContext,
): GuildConsoleResult {
  if (rawInput.length > GUILD_CONSOLE_MAX_INPUT_LENGTH) {
    return {
      type: 'output',
      tone: 'error',
      lines: [`入力は${GUILD_CONSOLE_MAX_INPUT_LENGTH}文字以内にしてください。`],
    };
  }

  const input = rawInput.trim();
  if (!input) return { type: 'output', tone: 'normal', lines: [] };

  const [command = '', ...args] = input.toLowerCase().split(/\s+/u);

  switch (command) {
    case 'help':
      return { type: 'output', tone: 'normal', lines: [...HELP_LINES] };
    case 'status':
      return {
        type: 'output',
        tone: context.attentionCount > 0 ? 'error' : 'normal',
        lines: [
          `guild: ${context.guildName}`,
          `plugins: ${context.enabledPlugins}/${context.totalPlugins} enabled`,
          `commands(7d): ${context.commands7d} total / ${context.failedCommands7d} failed / ${context.commandSuccessRate7d}% success`,
          `attention: ${context.attentionCount}`,
        ],
      };
    case 'plugins':
      return {
        type: 'output',
        tone: 'normal',
        lines: [
          `${context.enabledPlugins}/${context.totalPlugins} Pluginが有効です。`,
          '詳細: open plugins',
        ],
      };
    case 'commands':
      return {
        type: 'output',
        tone: context.failedCommands7d > 0 ? 'error' : 'normal',
        lines: [
          `直近7日: ${context.commands7d}件`,
          `成功率: ${context.commandSuccessRate7d}%`,
          `失敗: ${context.failedCommands7d}件`,
          '登録Command一覧: open commands',
        ],
      };
    case 'attention':
      return {
        type: 'output',
        tone: context.attentionCount > 0 ? 'error' : 'normal',
        lines:
          context.attentionCount > 0
            ? [
                `要確認: ${context.attentionCount}件`,
                `未処理Suggestion: ${context.openSuggestions}件`,
                `失敗Reminder: ${context.failedReminders}件`,
                `失敗Command(7d): ${context.failedCommands7d}件`,
              ]
            : ['要確認項目はありません。'],
      };
    case 'clear':
      return { type: 'clear' };
    case 'open': {
      if (args.length !== 1) {
        return {
          type: 'output',
          tone: 'error',
          lines: ['usage: open <plugins|commands|moderation|audit>'],
        };
      }
      const target = args[0] ?? '';
      if (!Object.hasOwn(OPEN_TARGETS, target)) {
        return {
          type: 'output',
          tone: 'error',
          lines: ['開ける画面は plugins / commands / moderation / audit のみです。'],
        };
      }
      const route = OPEN_TARGETS[target as keyof typeof OPEN_TARGETS];
      const guildId = encodeURIComponent(context.guildId);
      return {
        type: 'navigate',
        href: `/dashboard/guilds/${guildId}/${encodeURIComponent(route)}`,
        lines: [`opening ${target}...`],
      };
    }
    default:
      return {
        type: 'output',
        tone: 'error',
        lines: ["command not found. 'help' で利用可能なコマンドを確認してください。"],
      };
  }
}
