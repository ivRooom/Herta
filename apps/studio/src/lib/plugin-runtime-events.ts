import net from 'node:net';
import tls from 'node:tls';
import {
  PLUGIN_RUNTIME_EVENT_CHANNEL,
  createPluginRuntimeEvent,
  type PluginRuntimeEventType,
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
    await publish(redisUrl, PLUGIN_RUNTIME_EVENT_CHANNEL, JSON.stringify(event));
    return true;
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

async function publish(redisUrl: string, channel: string, message: string): Promise<void> {
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

  await new Promise<void>((resolve, reject) => {
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
      if (/:-?\d+\r\n/.test(response)) {
        clearTimeout(timer);
        socket.end();
        resolve();
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
