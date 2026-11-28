import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Logger } from '@herta/logger';
import {
  handleValorantPortalRequest,
  verifyValorantPortalRequest,
  VALORANT_PORTAL_API_PREFIX,
  VALORANT_PORTAL_MAX_BODY_BYTES,
  type ValorantPortalApiConfig,
  type ValorantPortalDeps,
} from './valorant-portal-api.js';

/**
 * VALORANT ポータル API の HTTP リスナー (S6-H1、Herta #1050)。
 *
 * health サーバー (`health/server.ts`) と同じ流儀の小さな node:http
 * サーバーだが、こちらは Bot プロセスの内部 API 専用で、公開ヘルス
 * とは別ポート・別フラグ (`VALORANT_PORTAL_API_ENABLED`、既定 OFF)
 * で起動する。OFF のときは main 側がこのクラス自体を生成しない。
 *
 * すべてのルートで HMAC 署名を必須とし、署名なし・改竄・期限切れ・
 * 別秘密のリクエストは一律 401 で拒否する。エラー応答には内部情報を
 * 含めない。リスナー起動失敗は Bot 本体 (Discord 接続・プラグイン
 * dispatch) を落とさないよう、起動ヘルパーが fail-soft に倒す。
 */

export interface ValorantPortalApiServerOptions {
  config: Pick<ValorantPortalApiConfig, 'host' | 'port'>;
  secret: string;
  logger: Logger;
  deps: ValorantPortalDeps;
  now?: () => number;
}

class RequestBodyTooLargeError extends Error {}

async function readRawBody(request: IncomingMessage, maxBytes: number): Promise<string> {
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
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
  });
}

export class ValorantPortalApiServer {
  private readonly server: Server;
  private readonly now: () => number;

  constructor(private readonly options: ValorantPortalApiServerOptions) {
    this.now = options.now ?? (() => Date.now());
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
      `VALORANT portal API listening on ${this.options.config.host}:${port}`,
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

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const method = request.method ?? 'GET';
    const requestUrl = new URL(request.url ?? '/', 'http://localhost');
    const pathname = requestUrl.pathname;

    if (!pathname.startsWith(`${VALORANT_PORTAL_API_PREFIX}/`)) {
      this.sendJson(response, 404, { status: 'error', error: 'not_found' });
      return;
    }
    if (method !== 'POST') {
      response.setHeader('Allow', 'POST');
      this.sendJson(response, 405, { status: 'error', error: 'method_not_allowed' });
      return;
    }

    let rawBody: string;
    try {
      rawBody = await readRawBody(request, VALORANT_PORTAL_MAX_BODY_BYTES);
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        this.sendJson(response, 413, { status: 'error', error: 'payload_too_large' });
        return;
      }
      this.sendJson(response, 400, { status: 'error', error: 'invalid_request' });
      return;
    }

    const timestamp = singleHeader(request.headers['x-ivrm-timestamp']);
    const eventId = singleHeader(request.headers['x-ivrm-event-id']);
    const signature = singleHeader(request.headers['x-ivrm-signature']);
    const authorized = verifyValorantPortalRequest({
      secret: this.options.secret,
      method,
      pathname,
      body: rawBody,
      headers: { timestamp, eventId, signature },
      nowMs: this.now(),
    });
    if (!authorized) {
      this.sendJson(response, 401, { status: 'error', error: 'unauthorized' });
      return;
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody) as unknown;
    } catch {
      this.sendJson(response, 400, { status: 'error', error: 'invalid_json' });
      return;
    }

    const result = await handleValorantPortalRequest(this.options.deps, pathname, body);
    this.sendJson(response, result.httpStatus, result.payload);
  }

  private sendJson(response: ServerResponse, statusCode: number, payload: object): void {
    const body = JSON.stringify(payload);
    response.statusCode = statusCode;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Length', Buffer.byteLength(body));
    response.end(body);
  }
}

function singleHeader(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * リスナーを fail-soft に起動する。起動に失敗しても Bot 本体は継続
 * できるよう、例外は投げず null を返してエラーログだけ残す。
 */
export async function startValorantPortalApiServer(
  options: ValorantPortalApiServerOptions,
): Promise<ValorantPortalApiServer | null> {
  const server = new ValorantPortalApiServer(options);
  try {
    await server.start();
    return server;
  } catch (error) {
    options.logger.error(
      { err: error, host: options.config.host, port: options.config.port },
      'VALORANT portal API の起動に失敗しました。Bot 本体は継続します',
    );
    return null;
  }
}
