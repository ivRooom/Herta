import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Logger } from '@herta/logger';
import {
  parseGuildBotProfileUpdate,
  type GuildBotProfile,
  type GuildBotProfileUpdate,
} from '../profile/guild-bot-profile.js';
import type { HealthConfig } from './config.js';
import type { GuildConfigurationOptions } from './guild-options.js';
import type { GuildMemberOption } from './guild-members.js';
import {
  isAuthorizedInternalApiRequest,
  isConfiguredInternalApiSecret,
} from './internal-auth.js';
import { createUnknownHealthResponse } from './service.js';
import type { HertaHealthResponse, PublicServiceStatus } from './types.js';

export interface HealthHttpServerOptions {
  config: HealthConfig;
  logger: Logger;
  version: string;
  getHealth: () => Promise<HertaHealthResponse>;
  getGuildOptions?: (guildId: string) => Promise<GuildConfigurationOptions | null>;
  searchGuildMembers?: (
    guildId: string,
    query: string,
    limit: number,
  ) => Promise<GuildMemberOption[] | null>;
  getGuildBotProfile?: (guildId: string) => Promise<GuildBotProfile | null>;
  updateGuildBotProfile?: (
    guildId: string,
    input: GuildBotProfileUpdate,
  ) => Promise<GuildBotProfile | null>;
  internalApiSecret?: string;
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

const MAX_INTERNAL_JSON_BODY_BYTES = 1_500_000;

class RequestBodyTooLargeError extends Error {}
class InvalidJsonBodyError extends Error {}

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

async function readJsonBody(request: IncomingMessage, maxBytes: number): Promise<unknown> {
  const contentLength = Number(request.headers['content-length'] ?? '0');
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    request.resume();
    throw new RequestBodyTooLargeError();
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;

    request.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > maxBytes) {
        tooLarge = true;
        return;
      }
      if (!tooLarge) chunks.push(buffer);
    });
    request.once('error', reject);
    request.once('end', () => {
      if (tooLarge) {
        reject(new RequestBodyTooLargeError());
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown);
      } catch {
        reject(new InvalidJsonBodyError());
      }
    });
  });
}

export class HealthHttpServer {
  private readonly server: Server;
  private readonly now: () => Date;
  private readonly uptimeSeconds: () => number;

  constructor(private readonly options: HealthHttpServerOptions) {
    this.now = options.now ?? (() => new Date());
    this.uptimeSeconds = options.uptimeSeconds ?? (() => process.uptime());
    this.server = createServer((request, response) => {
      void this.handleRequest(request, response);
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
    request: IncomingMessage,
    response: import('node:http').ServerResponse,
  ): Promise<void> {
    const method = request.method ?? 'GET';
    const requestUrl = new URL(request.url ?? '/', 'http://localhost');
    const pathname = requestUrl.pathname;

    const guildBotProfileMatch = /^\/internal\/guilds\/(\d+)\/bot-profile$/u.exec(pathname);
    if (guildBotProfileMatch) {
      await this.handleGuildBotProfileRequest(
        request,
        response,
        method,
        guildBotProfileMatch[1]!,
      );
      return;
    }

    const guildMemberSearchMatch = /^\/internal\/guilds\/(\d+)\/members$/u.exec(pathname);
    if (guildMemberSearchMatch) {
      if (method !== 'GET') {
        response.setHeader('Allow', 'GET');
        this.sendJson(response, 405, { status: 'method_not_allowed' });
        return;
      }
      if (!this.options.searchGuildMembers) {
        this.sendJson(response, 404, { status: 'not_found' });
        return;
      }

      const query = requestUrl.searchParams.get('query')?.trim() ?? '';
      if (!/^\d{17,20}$/u.test(query) && query.length < 2) {
        this.sendJson(response, 400, { status: 'query_too_short' });
        return;
      }
      const requestedLimit = Number.parseInt(requestUrl.searchParams.get('limit') ?? '20', 10);
      const limit = Number.isFinite(requestedLimit)
        ? Math.max(1, Math.min(20, requestedLimit))
        : 20;
      try {
        const members = await withTimeout(
          this.options.searchGuildMembers(guildMemberSearchMatch[1]!, query, limit),
          this.options.config.checkTimeoutMs + 2_000,
        );
        if (!members) {
          this.sendJson(response, 404, { status: 'guild_not_found' });
          return;
        }
        this.sendJson(response, 200, { members });
      } catch {
        this.sendJson(response, 503, { status: 'unavailable' });
      }
      return;
    }

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

  private async handleGuildBotProfileRequest(
    request: IncomingMessage,
    response: import('node:http').ServerResponse,
    method: string,
    guildId: string,
  ): Promise<void> {
    const internalApiSecret = this.options.internalApiSecret;
    if (!isConfiguredInternalApiSecret(internalApiSecret)) {
      this.sendJson(response, 503, { status: 'internal_api_not_configured' });
      return;
    }
    if (!isAuthorizedInternalApiRequest(request.headers.authorization, internalApiSecret)) {
      this.sendJson(response, 401, { status: 'unauthorized' });
      return;
    }

    if (method === 'GET') {
      if (!this.options.getGuildBotProfile) {
        this.sendJson(response, 404, { status: 'not_found' });
        return;
      }
      try {
        const profile = await withTimeout(
          this.options.getGuildBotProfile(guildId),
          this.options.config.checkTimeoutMs + 2_000,
        );
        if (!profile) {
          this.sendJson(response, 404, { status: 'guild_not_found' });
          return;
        }
        this.sendJson(response, 200, { profile });
      } catch (error) {
        this.options.logger.warn({ err: error, guildId }, 'Bot Guildプロフィール取得に失敗しました');
        this.sendJson(response, 503, { status: 'unavailable' });
      }
      return;
    }

    if (method === 'PATCH') {
      if (!this.options.updateGuildBotProfile) {
        this.sendJson(response, 404, { status: 'not_found' });
        return;
      }

      let rawBody: unknown;
      try {
        rawBody = await readJsonBody(request, MAX_INTERNAL_JSON_BODY_BYTES);
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          this.sendJson(response, 413, { status: 'payload_too_large' });
          return;
        }
        this.sendJson(response, 400, { status: 'invalid_json' });
        return;
      }

      const input = parseGuildBotProfileUpdate(rawBody);
      if (!input) {
        this.sendJson(response, 400, { status: 'invalid_profile_input' });
        return;
      }

      try {
        const profile = await withTimeout(
          this.options.updateGuildBotProfile(guildId, input),
          this.options.config.checkTimeoutMs + 5_000,
        );
        if (!profile) {
          this.sendJson(response, 404, { status: 'guild_not_found' });
          return;
        }
        this.sendJson(response, 200, { profile });
      } catch (error) {
        this.options.logger.warn({ err: error, guildId }, 'Bot Guildプロフィール更新に失敗しました');
        this.sendJson(response, 503, { status: 'unavailable' });
      }
      return;
    }

    response.setHeader('Allow', 'GET, PATCH');
    this.sendJson(response, 405, { status: 'method_not_allowed' });
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
