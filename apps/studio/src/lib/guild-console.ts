export const GUILD_CONSOLE_MAX_INPUT_LENGTH = 120;
export const GUILD_CONSOLE_HISTORY_LIMIT = 40;

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
      const target = args[0] as keyof typeof OPEN_TARGETS;
      const route = OPEN_TARGETS[target];
      if (!route) {
        return {
          type: 'output',
          tone: 'error',
          lines: ['開ける画面は plugins / commands / moderation / audit のみです。'],
        };
      }
      const guildId = encodeURIComponent(context.guildId);
      return {
        type: 'navigate',
        href: `/dashboard/guilds/${guildId}/${route}`,
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
