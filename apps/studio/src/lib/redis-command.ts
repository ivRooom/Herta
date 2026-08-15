import net from 'node:net';
import tls from 'node:tls';

export type RedisCommandResult = string | number | null;

export async function redisCommand(
  redisUrl: string,
  ...parts: readonly string[]
): Promise<RedisCommandResult> {
  if (parts.length === 0) throw new Error('Redis commandが指定されていません');

  const url = new URL(redisUrl);
  if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') {
    throw new Error('REDIS_URLはredis://またはrediss://で指定してください');
  }

  const port = Number(url.port || (url.protocol === 'rediss:' ? 6380 : 6379));
  const commands: string[][] = [];
  if (url.password) {
    const password = decodeURIComponent(url.password);
    const username = url.username ? decodeURIComponent(url.username) : '';
    commands.push(username ? ['AUTH', username, password] : ['AUTH', password]);
  }
  const database = url.pathname.replace(/^\//u, '');
  if (database && database !== '0') commands.push(['SELECT', database]);
  commands.push([...parts]);

  return new Promise<RedisCommandResult>((resolve, reject) => {
    const secure = url.protocol === 'rediss:';
    const socket = secure
      ? tls.connect({ host: url.hostname, port, servername: url.hostname })
      : net.createConnection({ host: url.hostname, port });
    let response = Buffer.alloc(0);
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(new Error('Redis commandがタイムアウトしました'));
    }, 1_500);

    function fail(error: unknown) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      reject(error instanceof Error ? error : new Error('Redis commandに失敗しました'));
    }

    socket.once(secure ? 'secureConnect' : 'connect', () => {
      socket.write(commands.map((command) => encodeCommand(...command)).join(''));
    });
    socket.on('data', (chunk) => {
      if (settled) return;
      response = Buffer.concat([response, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
      try {
        const parsed = parseRespValues(response);
        if (!parsed.complete || parsed.values.length < commands.length) return;
        settled = true;
        clearTimeout(timer);
        socket.end();
        resolve(parsed.values[commands.length - 1] ?? null);
      } catch (error) {
        fail(error);
      }
    });
    socket.once('error', fail);
  });
}

function encodeCommand(...parts: string[]): string {
  return `*${parts.length}\r\n${parts
    .map((part) => `$${Buffer.byteLength(part)}\r\n${part}\r\n`)
    .join('')}`;
}

function parseRespValues(buffer: Buffer): {
  values: RedisCommandResult[];
  complete: boolean;
} {
  const values: RedisCommandResult[] = [];
  let offset = 0;

  while (offset < buffer.length) {
    const type = String.fromCharCode(buffer[offset]!);
    const lineEnd = buffer.indexOf('\r\n', offset);
    if (lineEnd < 0) return { values, complete: false };
    const line = buffer.subarray(offset + 1, lineEnd).toString('utf8');

    if (type === '+') {
      values.push(line);
      offset = lineEnd + 2;
      continue;
    }
    if (type === ':') {
      const number = Number(line);
      if (!Number.isSafeInteger(number)) throw new Error('Redis integer responseが不正です');
      values.push(number);
      offset = lineEnd + 2;
      continue;
    }
    if (type === '-') throw new Error(`Redis error: ${line}`);
    if (type !== '$') throw new Error('未対応のRedis response typeです');

    const length = Number(line);
    if (!Number.isInteger(length) || length < -1) throw new Error('Redis bulk lengthが不正です');
    if (length === -1) {
      values.push(null);
      offset = lineEnd + 2;
      continue;
    }

    const valueStart = lineEnd + 2;
    const valueEnd = valueStart + length;
    if (buffer.length < valueEnd + 2) return { values, complete: false };
    if (buffer[valueEnd] !== 13 || buffer[valueEnd + 1] !== 10) {
      throw new Error('Redis bulk response終端が不正です');
    }
    values.push(buffer.subarray(valueStart, valueEnd).toString('utf8'));
    offset = valueEnd + 2;
  }

  return { values, complete: true };
}
