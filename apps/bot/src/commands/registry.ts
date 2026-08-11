import {
  ApplicationCommandOptionType,
  type ChatInputCommandInteraction,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import type { CommandOption, CommandSubcommand } from '@herta/shared';
import type { Logger } from 'pino';
import type { CommandHandler } from '@herta/plugin-sdk';
import { coreInformationCommands } from './core-info.js';
import { coreUtilityV3Commands } from './utility-v3.js';

export type SlashCommand = CommandHandler<ChatInputCommandInteraction>;

type DiscordCommandOption = NonNullable<
  RESTPostAPIChatInputApplicationCommandsJSONBody['options']
>[number];

function toDiscordOption(option: CommandOption): DiscordCommandOption {
  switch (option.type) {
    case 'string':
      return {
        name: option.name,
        description: option.description,
        type: ApplicationCommandOptionType.String,
        required: option.required,
        choices: option.choices?.map((choice) => ({
          name: choice.name,
          value: choice.value.toString(),
        })),
      } as DiscordCommandOption;
    case 'integer':
      return {
        name: option.name,
        description: option.description,
        type: ApplicationCommandOptionType.Integer,
        required: option.required,
        choices: option.choices?.map((choice) => ({
          name: choice.name,
          value: Number(choice.value),
        })),
        min_value: Number.isInteger(option.minValue) ? option.minValue : undefined,
        max_value: Number.isInteger(option.maxValue) ? option.maxValue : undefined,
      } as DiscordCommandOption;
    case 'boolean':
      return {
        name: option.name,
        description: option.description,
        type: ApplicationCommandOptionType.Boolean,
        required: option.required,
      } as DiscordCommandOption;
    case 'user':
      return {
        name: option.name,
        description: option.description,
        type: ApplicationCommandOptionType.User,
        required: option.required,
      } as DiscordCommandOption;
    case 'channel':
      return {
        name: option.name,
        description: option.description,
        type: ApplicationCommandOptionType.Channel,
        required: option.required,
      } as DiscordCommandOption;
    case 'role':
      return {
        name: option.name,
        description: option.description,
        type: ApplicationCommandOptionType.Role,
        required: option.required,
      } as DiscordCommandOption;
  }
}

function toDiscordSubcommand(subcommand: CommandSubcommand): DiscordCommandOption {
  return {
    name: subcommand.name,
    description: subcommand.description,
    type: ApplicationCommandOptionType.Subcommand,
    options: subcommand.options?.map(toDiscordOption),
  } as DiscordCommandOption;
}

export function toDiscordCommandJSON(
  command: SlashCommand,
): RESTPostAPIChatInputApplicationCommandsJSONBody {
  const subcommands = command.definition.subcommands?.map(toDiscordSubcommand);
  return {
    name: command.definition.name,
    description: command.definition.description,
    options: subcommands?.length ? subcommands : command.definition.options?.map(toDiscordOption),
  };
}

export class CommandRegistry {
  private commands = new Map<string, SlashCommand>();

  constructor(private logger: Logger) {
    for (const command of [...coreInformationCommands, ...coreUtilityV3Commands]) {
      this.register(command);
    }
  }

  register(command: SlashCommand): void {
    const existing = this.commands.get(command.definition.name);
    if (existing) {
      this.logger.warn(
        { commandName: command.definition.name },
        'Slash Command が重複登録されました。後から登録した定義で上書きします',
      );
    }

    this.commands.set(command.definition.name, command);
  }

  registerProvider(provider: { provideCommands(): SlashCommand[] }): void {
    for (const command of provider.provideCommands()) {
      this.register(command);
    }
  }

  get(name: string): SlashCommand | undefined {
    return this.commands.get(name);
  }

  getAll(): SlashCommand[] {
    return [...this.commands.values()];
  }

  toDiscordJSON(): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
    return this.getAll().map(toDiscordCommandJSON);
  }
}