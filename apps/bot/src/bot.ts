import { Client, GatewayIntentBits } from 'discord.js';
import type { Logger } from 'pino';

/** Herta Bot クライアント */
export class HertaBot {
  private client: Client;

  constructor(private logger: Logger) {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.MessageContent,
      ],
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.client.once('ready', (client) => {
      this.logger.info(
        { username: client.user.tag, guilds: client.guilds.cache.size },
        'Herta Bot がログインしました',
      );
    });

    this.client.on('error', (error) => {
      this.logger.error(error, 'Discord クライアントエラー');
    });
  }

  /** Bot を起動する */
  async start(): Promise<void> {
    const token = process.env['DISCORD_BOT_TOKEN'];
    if (!token) {
      throw new Error('DISCORD_BOT_TOKEN が設定されていません');
    }
    await this.client.login(token);
  }

  /** Bot を停止する */
  async stop(): Promise<void> {
    this.client.destroy();
    this.logger.info('Bot を停止しました');
  }
}
