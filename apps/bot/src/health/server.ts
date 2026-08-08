import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Logger } from '@herta/logger';
import type { HealthConfig } from './config.js';
import { createUnknownHealthResponse } from './service.js';
import type { GuildConfigurationOptions } from './guild-options.js';
import type { HertaHealthResponse, PublicServiceStatus } from './types.js';

export interface HealthHttpServerOptions {
  config: HealthConfig;
  logger: Logger;
  version: string;
  getHealth: () => Promise<HertaHealthResponse>;
  getGuildOptions?: (guildId: string) => Promise<GuildConfigurationOptions | null>;
  now?: () => Date;
  uptimeSeconds?: () => number;
}

const HTTP_STATUS_BY_HEALTH: Record<PublicServiceStatus, number> = {
  operational: 200,
  degraded: 200,
  maintenance: 200,
  outage: 503,
  unknown: 503,
};

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('health endpoint timeout')), timeoutMs);
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class HealthHttpServer {
  private readonly server: Server;
  private readonly now: () => Date;
  private readonly uptimeSeconds: () => number;

  constructor(private readonly options: HealthHttpServerOptions) {
    this.now = options.now ?? (() => new Date());
    this.uptimeSeconds = options.uptimeSeconds ?? (() => process.uptime());
    this.server = createServer((request, response) => {
      void this.handleRequest(request.method ?? 'GET', request.url ?? '/', response);
    });
  }

  async start(): Promise<void> {
    if (this.server.listening) return;

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        this.server.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        this.server.off('error', onError);
        resolve();
      };
      this.server.once('error', onError);
      this.server.once('listening', onListening);
      this.server.listen(this.options.config.port, this.options.config.host);
    });

    const address = this.server.address();
    const port = typeof address === 'object' && address ? address.port : this.options.config.port;
    this.options.logger.info(
      { host: this.options.config.host, port },
      `Herta health endpoint listening on ${this.options.config.host}:${port}`,
    );
  }

  async stop(): Promise<void> {
    if (!this.server.listening) return;
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  getAddress(): AddressInfo | null {
    const address = this.server.address();
    return typeof address === 'object' ? address : null;
  }

  private async handleRequest(
    method: string,
    url: string,
    response: import('node:http').ServerResponse,
  ): Promise<void> {
    const pathname = new URL(url, 'http://localhost').pathname;
    const guildOptionsMatch = /^\/internal\/guilds\/(\d+)\/options$/u.exec(pathname);
    if (guildOptionsMatch) {
      if (method !== 'GET') {
        response.setHeader('Allow', 'GET');
        this.sendJson(response, 405, { status: 'method_not_allowed' });
        return;
      }
      if (!this.options.getGuildOptions) {
        this.sendJson(response, 404, { status: 'not_found' });
        return;
      }
      try {
        const options = await withTimeout(
          this.options.getGuildOptions(guildOptionsMatch[1]!),
          this.options.config.checkTimeoutMs + 1_000,
        );
        if (!options) {
          this.sendJson(response, 404, { status: 'guild_not_found' });
          return;
        }
        this.sendJson(response, 200, options);
      } catch {
        this.sendJson(response, 503, { status: 'unavailable' });
      }
      return;
    }
    if (pathname !== '/healthz') {
      this.sendJson(response, 404, { status: 'not_found' });
      return;
    }
    if (method !== 'GET') {
      response.setHeader('Allow', 'GET');
      this.sendJson(response, 405, { status: 'method_not_allowed' });
      return;
    }

    let health: HertaHealthResponse;
    try {
      health = await withTimeout(
        this.options.getHealth(),
        this.options.config.checkTimeoutMs + 250,
      );
    } catch {
      health = createUnknownHealthResponse(this.now(), this.options.version, this.uptimeSeconds());
    }

    this.sendJson(response, HTTP_STATUS_BY_HEALTH[health.status], health);
  }

  private sendJson(
    response: import('node:http').ServerResponse,
    statusCode: number,
    payload: object,
  ): void {
    const body = JSON.stringify(payload);
    response.statusCode = statusCode;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Length', Buffer.byteLength(body));
    response.end(body);
  }
}
