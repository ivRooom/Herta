import net from 'node:net';
import tls from 'node:tls';
import {
  PLUGIN_RUNTIME_EVENT_CHANNEL,
  XP_ROLE_RECONCILIATION_EVENT_CHANNEL,
  XP_ROLE_SWEEP_EVENT_CHANNEL,
  createPluginRuntimeEvent,
  createXpRoleReconciliationEvent,
  createXpRoleSweepEvent,
  type PluginRuntimeEventType,
  type XpRoleSweepReason,
} from '@herta/shared';

export async function publishPluginRuntimeEvent(input: {
  guildId: string;
  pluginId: string;
  configVersion: number;
  eventType: PluginRuntimeEventType;
}): Promise<boolean> {
  const redisUrl = process.env['REDIS_URL'];
  if (!redisUrl) return false;

  try {
    const event = createPluginRuntimeEvent(input);
    const subscribers = await publish(
      redisUrl,
      PLUGIN_RUNTIME_EVENT_CHANNEL,
      JSON.stringify(event),
    );
    return subscribers > 0;
  } catch (error) {
    console.error('Plugin Runtime更新イベントの発行に失敗しました', {
      guildId: input.guildId,
      pluginId: input.pluginId,
      eventType: input.eventType,
      error,
    });
    return false;
  }
}

export async function publishXpRoleReconciliationEvent(input: {
  guildId: string;
  userId: string;
}): Promise<boolean> {
  const redisUrl = process.env['REDIS_URL'];
  if (!redisUrl) return false;

  try {
    const event = createXpRoleReconciliationEvent(input);
    const subscribers = await publish(
      redisUrl,
      XP_ROLE_RECONCILIATION_EVENT_CHANNEL,
      JSON.stringify(event),
    );
    return subscribers > 0;
  } catch (error) {
    console.error('XP報酬Role再同期イベントの発行に失敗しました', {
      guildId: input.guildId,
      userId: input.userId,
      error,
    });
    return false;
  }
}

export async function publishXpRoleSweepEvent(input: {
  requestId: string;
  guildId: string;
  actorId: string;
  reason: XpRoleSweepReason;
}): Promise<boolean> {
  const redisUrl = process.env['REDIS_URL'];
  if (!redisUrl) return false;

  try {
    const event = createXpRoleSweepEvent(input);
    const subscribers = await publish(redisUrl, XP_ROLE_SWEEP_EVENT_CHANNEL, JSON.stringify(event));
    return subscribers > 0;
  } catch (error) {
    console.error('XP報酬Role一括修復イベントの発行に失敗しました', {
      guildId: input.guildId,
      requestId: input.requestId,
      reason: input.reason,
      error,
    });
    return false;
  }
}

async function publish(redisUrl: string, channel: string, message: string): Promise<number> {
  const url = new URL(redisUrl);
  if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') {
    throw new Error('REDIS_URLはredis://またはrediss://で指定してください');
  }

  const port = Number(url.port || (url.protocol === 'rediss:' ? 6380 : 6379));
  const commands: string[] = [];
  if (url.password) commands.push(encodeCommand('AUTH', decodeURIComponent(url.password)));
  const database = url.pathname.replace(/^\//, '');
  if (database && database !== '0') commands.push(encodeCommand('SELECT', database));
  commands.push(encodeCommand('PUBLISH', channel, message));

  return new Promise<number>((resolve, reject) => {
    const socket =
      url.protocol === 'rediss:'
        ? tls.connect({ host: url.hostname, port, servername: url.hostname })
        : net.createConnection({ host: url.hostname, port });
    let response = '';
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('Redis publishがタイムアウトしました'));
    }, 1500);

    socket.setEncoding('utf8');
    socket.once('connect', () => socket.write(commands.join('')));
    socket.on('data', (chunk) => {
      response += chunk.toString();
      const errorReply = response.match(/-([^\r\n]+)\r\n/);
      if (errorReply) {
        clearTimeout(timer);
        socket.destroy();
        reject(new Error(`Redis error: ${errorReply[1]}`));
        return;
      }
      const publishReply = response.match(/:(-?\d+)\r\n/);
      if (publishReply) {
        clearTimeout(timer);
        socket.end();
        resolve(Number(publishReply[1]));
      }
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function encodeCommand(...parts: string[]): string {
  return `*${parts.length}\r\n${parts
    .map((part) => `$${Buffer.byteLength(part)}\r\n${part}\r\n`)
    .join('')}`;
}
