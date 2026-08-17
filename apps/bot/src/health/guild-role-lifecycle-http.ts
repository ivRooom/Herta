import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Logger } from '@herta/logger';
import { isAuthorizedInternalApiRequest, isConfiguredInternalApiSecret } from './internal-auth.js';
import {
  GuildRoleLifecycleError,
  createGuildRole,
  deleteGuildRole,
  parseGuildRoleCreateInput,
} from './guild-role-lifecycle.js';

const MAX_BODY_BYTES = 8 * 1024;
const ROLE_ID_PATTERN = /^\d{17,20}$/u;

export async function handleGuildRoleLifecycleHttpRequest(input: {
  request: IncomingMessage;
  response: ServerResponse;
  method: string;
  guildId: string;
  roleId?: string;
  internalApiSecret?: string;
  logger: Logger;
}): Promise<void> {
  if (!isConfiguredInternalApiSecret(input.internalApiSecret)) {
    sendJson(input.response, 503, { status: 'internal_api_not_configured' });
    return;
  }
  if (!isAuthorizedInternalApiRequest(input.request.headers.authorization, input.internalApiSecret)) {
    sendJson(input.response, 401, { status: 'unauthorized' });
    return;
  }
  const token = process.env['DISCORD_BOT_TOKEN']?.trim();
  if (!token) {
    sendJson(input.response, 503, { status: 'discord_bot_not_configured' });
    return;
  }

  try {
    if (input.roleId) {
      if (input.method !== 'DELETE') {
        input.response.setHeader('Allow', 'DELETE');
        sendJson(input.response, 405, { status: 'method_not_allowed' });
        return;
      }
      if (!ROLE_ID_PATTERN.test(input.roleId)) {
        sendJson(input.response, 400, { status: 'invalid_role_id' });
        return;
      }
      const result = await deleteGuildRole(token, input.guildId, input.roleId);
      sendJson(input.response, 200, { result });
      return;
    }

    if (input.method !== 'POST') {
      input.response.setHeader('Allow', 'POST');
      sendJson(input.response, 405, { status: 'method_not_allowed' });
      return;
    }
    const body = await readJsonBody(input.request);
    const createInput = parseGuildRoleCreateInput(body);
    if (!createInput) {
      sendJson(input.response, 400, { status: 'invalid_role_input' });
      return;
    }
    const result = await createGuildRole(token, input.guildId, createInput);
    sendJson(input.response, 201, { result });
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      sendJson(input.response, 413, { status: 'payload_too_large' });
      return;
    }
    if (error instanceof InvalidJsonError) {
      sendJson(input.response, 400, { status: 'invalid_json' });
      return;
    }
    if (error instanceof GuildRoleLifecycleError) {
      input.logger.warn(
        { guildId: input.guildId, roleId: input.roleId, errorName: error.name, code: error.code },
        'Discord Role lifecycle内部操作に失敗しました',
      );
      sendJson(input.response, error.status, { status: error.code });
      return;
    }
    input.logger.error(
      { guildId: input.guildId, roleId: input.roleId, errorName: resolveErrorName(error) },
      'Discord Role lifecycle内部操作で予期しないエラーが発生しました',
    );
    sendJson(input.response, 503, { status: 'unavailable' });
  }
}

class PayloadTooLargeError extends Error {}
class InvalidJsonError extends Error {}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const contentLength = Number(request.headers['content-length'] ?? '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    request.resume();
    throw new PayloadTooLargeError();
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new PayloadTooLargeError();
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new InvalidJsonError();
  }
}

function sendJson(response: ServerResponse, statusCode: number, payload: object): void {
  const body = JSON.stringify(payload);
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Length', Buffer.byteLength(body));
  response.end(body);
}

function resolveErrorName(error: unknown): string {
  return error instanceof Error && error.name.trim() ? error.name.slice(0, 120) : 'UnknownError';
}
