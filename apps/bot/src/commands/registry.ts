import {
  ApplicationCommandOptionType,
  type ChatInputCommandInteraction,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import type { CommandOption } from '@herta/shared';
import type { Logger } from 'pino';
import type { CommandHandler } from '@herta/plugin-sdk';

export type SlashCommand = CommandHandler<ChatInputCommandInteraction>;

function toDiscordOption(
  option: CommandOption,
): NonNullable<RESTPostAPIChatInputApplicationCommandsJSONBody['options']>[number] {
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
      } as NonNullable<RESTPostAPIChatInputApplicationCommandsJSONBody['options']>[number];
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
      } as NonNullable<RESTPostAPIChatInputApplicationCommandsJSONBody['options']>[number];
    case 'boolean':
      return {
        name: option.name,
        description: option.description,
        type: ApplicationCommandOptionType.Boolean,
        required: option.required,
      } as NonNullable<RESTPostAPIChatInputApplicationCommandsJSONBody['options']>[number];
    case 'user':
      return {
        name: option.name,
        description: option.description,
        type: ApplicationCommandOptionType.User,
        required: option.required,
      } as NonNullable<RESTPostAPIChatInputApplicationCommandsJSONBody['options']>[number];
    case 'channel':
      return {
        name: option.name,
        description: option.description,
        type: ApplicationCommandOptionType.Channel,
        required: option.required,
      } as NonNullable<RESTPostAPIChatInputApplicationCommandsJSONBody['options']>[number];
    case 'role':
      return {
        name: option.name,
        description: option.description,
        type: ApplicationCommandOptionType.Role,
        required: option.required,
      } as NonNullable<RESTPostAPIChatInputApplicationCommandsJSONBody['options']>[number];
  }
}

export function toDiscordCommandJSON(
  command: SlashCommand,
): RESTPostAPIChatInputApplicationCommandsJSONBody {
  return {
    name: command.definition.name,
    description: command.definition.description,
    options: command.definition.options?.map(toDiscordOption),
  };
}

export class CommandRegistry {
  private commands = new Map<string, SlashCommand>();

  constructor(private logger: Logger) {}

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
