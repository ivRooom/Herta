import { definePlugin } from '@herta/plugin-sdk';
import type { CommandHandler, PluginRuntimeContext } from '@herta/plugin-sdk';
import { normalizeQuoteConfig, QuoteValidationError, type QuoteConfig } from './config.js';
import { quoteManifest } from './manifest.js';
import {
  createQuote,
  deleteQuote,
  getQuoteByNumber,
  getRandomQuote,
  listQuotes,
  type QuotePrismaClient,
  type QuoteRecord,
} from './service.js';

const EPHEMERAL_FLAG = 64;
const MANAGE_GUILD_PERMISSION = 32n;
const MANAGE_MESSAGES_PERMISSION = 8192n;
const LIST_PAGE_SIZE = 5;
const MAX_RESPONSE_LENGTH = 1900;

interface QuoteCommandOptions {
  getSubcommand(): string;
  getString(name: string, required?: boolean): string | null;
  getInteger(name: string, required?: boolean): number | null;
}

interface QuoteCommandInteraction {
  guildId: string | null;
  channelId: string | null;
  user: {
    id: string;
    username: string;
    globalName?: string | null;
  };
  memberPermissions: {
    has(permission: bigint): boolean;
  } | null;
  options: QuoteCommandOptions;
  replied: boolean;
  deferred: boolean;
  reply(options: QuoteReplyOptions): Promise<unknown>;
  followUp(options: QuoteReplyOptions): Promise<unknown>;
}

interface QuoteReplyOptions {
  content: string;
  flags?: number;
  allowedMentions: { parse: [] };
}

type QuoteRuntimeContext = PluginRuntimeContext<QuoteConfig, unknown, QuotePrismaClient>;

export const quotePlugin = definePlugin<QuoteConfig, unknown, QuotePrismaClient>({
  manifest: quoteManifest,

  async onEnable(context) {
    context.logger.info('Quote Plugin を有効化しました');
  },

  async onDisable(context) {
    context.logger.info('Quote Plugin を無効化しました');
  },

  provideCommands(context) {
    const command: CommandHandler<QuoteCommandInteraction> = {
      definition: quoteManifest.commands[0]!,
      async execute(interaction) {
        await executeQuoteCommand(context, interaction);
      },
    };
    return [command];
  },
});

async function executeQuoteCommand(
  context: QuoteRuntimeContext,
  interaction: QuoteCommandInteraction,
): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) {
    await respond(interaction, 'このコマンドはサーバー内でのみ利用できます', true);
    return;
  }

  const config = normalizeQuoteConfig(context.config);
  if (
    config.allowedChannelIds.length > 0 &&
    (!interaction.channelId || !config.allowedChannelIds.includes(interaction.channelId))
  ) {
    await respond(interaction, 'このチャンネルではQuote Pluginを利用できません', true);
    return;
  }

  const canManage = hasManagePermission(interaction);

  try {
    switch (interaction.options.getSubcommand()) {
      case 'random': {
        const quote = await getRandomQuote(context.prisma, guildId, {
          tag: interaction.options.getString('tag') ?? undefined,
        });
        await respond(
          interaction,
          quote ? formatQuote(quote) : '条件に一致する名言がありません',
          config.randomResponseEphemeral,
        );
        return;
      }

      case 'show': {
        const quoteNumber = requiredInteger(interaction, 'number');
        const quote = await getQuoteByNumber(context.prisma, guildId, quoteNumber);
        if (!quote || (quote.status !== 'public' && !canManage)) {
          await respond(interaction, `Quote #${quoteNumber} は見つかりません`, true);
          return;
        }
        await respond(interaction, formatQuote(quote), false);
        return;
      }

      case 'add': {
        if (!config.allowMemberRegistration && !canManage) {
          await respond(interaction, '名言を登録する権限がありません', true);
          return;
        }
        const created = await createQuote(context.prisma, {
          guildId,
          quoteText: requiredString(interaction, 'text'),
          sourceAuthorName: interaction.options.getString('author'),
          registeredById: interaction.user.id,
          registeredByName: interaction.user.globalName ?? interaction.user.username,
          tags: interaction.options.getString('tags') ?? undefined,
          maxQuoteLength: config.maxQuoteLength,
          operationSource: 'discord',
        });
        await respond(
          interaction,
          `Quote #${created.quoteNumber} を登録しました\n${formatQuote(created)}`,
          true,
        );
        return;
      }

      case 'delete': {
        if (!config.allowMemberDeletion && !canManage) {
          await respond(interaction, '名言を削除する権限がありません', true);
          return;
        }
        const quoteNumber = requiredInteger(interaction, 'number');
        const deleted = await deleteQuote(context.prisma, {
          guildId,
          quoteNumber,
          actorId: interaction.user.id,
          operationSource: 'discord',
        });
        await respond(
          interaction,
          deleted
            ? `Quote #${quoteNumber} を削除しました`
            : `Quote #${quoteNumber} は見つかりません`,
          true,
        );
        return;
      }

      case 'list': {
        const page = interaction.options.getInteger('page') ?? 1;
        const result = await listQuotes(context.prisma, {
          guildId,
          page,
          pageSize: LIST_PAGE_SIZE,
          tag: interaction.options.getString('tag') ?? undefined,
          status: 'public',
        });
        await respond(
          interaction,
          formatQuoteList(result.items, result.page, result.totalPages),
          true,
        );
        return;
      }

      default:
        await respond(interaction, '指定されたサブコマンドは利用できません', true);
    }
  } catch (error) {
    if (error instanceof QuoteValidationError) {
      await respond(interaction, error.message, true);
      return;
    }

    context.logger.error(
      {
        err: error,
        guildId,
        userId: interaction.user.id,
      },
      'Quote Commandの実行に失敗しました',
    );
    await respond(interaction, 'Quote Commandの実行中にエラーが発生しました', true);
  }
}

function hasManagePermission(interaction: QuoteCommandInteraction): boolean {
  return Boolean(
    interaction.memberPermissions?.has(MANAGE_GUILD_PERMISSION) ||
    interaction.memberPermissions?.has(MANAGE_MESSAGES_PERMISSION),
  );
}

function requiredString(interaction: QuoteCommandInteraction, name: string): string {
  const value = interaction.options.getString(name, true);
  if (!value) throw new QuoteValidationError(`${name}を入力してください`);
  return value;
}

function requiredInteger(interaction: QuoteCommandInteraction, name: string): number {
  const value = interaction.options.getInteger(name, true);
  if (value === null) throw new QuoteValidationError(`${name}を入力してください`);
  return value;
}

function formatQuote(quote: QuoteRecord): string {
  const lines = [`**Quote #${quote.quoteNumber}**`, quote.quoteText];
  if (quote.sourceAuthorName) lines.push(`— ${quote.sourceAuthorName}`);
  if (quote.tags.length > 0) lines.push(`タグ: ${quote.tags.map((tag) => `#${tag}`).join(' ')}`);
  lines.push(`登録者: ${quote.registeredByName}`);
  return truncate(lines.join('\n'), MAX_RESPONSE_LENGTH);
}

function formatQuoteList(items: QuoteRecord[], page: number, totalPages: number): string {
  if (items.length === 0) return '名言はまだ登録されていません';
  const body = items
    .map((quote) => {
      const text =
        quote.quoteText.length > 180 ? `${quote.quoteText.slice(0, 177)}…` : quote.quoteText;
      const author = quote.sourceAuthorName ? ` — ${quote.sourceAuthorName}` : '';
      return `**#${quote.quoteNumber}** ${text}${author}`;
    })
    .join('\n\n');
  return truncate(`Quote一覧 (${page}/${totalPages})\n\n${body}`, MAX_RESPONSE_LENGTH);
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

async function respond(
  interaction: QuoteCommandInteraction,
  content: string,
  ephemeral: boolean,
): Promise<void> {
  const options: QuoteReplyOptions = {
    content: truncate(content, MAX_RESPONSE_LENGTH),
    allowedMentions: { parse: [] },
    ...(ephemeral ? { flags: EPHEMERAL_FLAG } : {}),
  };

  if (interaction.replied || interaction.deferred) {
    await interaction.followUp(options);
    return;
  }
  await interaction.reply(options);
}

export default quotePlugin;
