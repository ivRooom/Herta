import type { CommandDefinition } from '@herta/shared';

/** 実行可能な Slash Command。TInteraction は利用側 (bot) が具体化する */
export interface CommandHandler<TInteraction = unknown> {
  definition: CommandDefinition;
  execute(interaction: TInteraction): Promise<void>;
}

/** Plugin が Slash Command を提供するための口 */
export interface CommandProvider<TInteraction = unknown> {
  provideCommands(): CommandHandler<TInteraction>[];
}
