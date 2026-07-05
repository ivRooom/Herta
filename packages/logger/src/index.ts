import pino from 'pino';

export type { Logger } from 'pino';

export interface CreateLoggerOptions {
  name: string;
  level?: string;
}

/** 構造化ロガーを作成する */
export function createLogger(options: CreateLoggerOptions): pino.Logger {
  const isDev = process.env.NODE_ENV !== 'production';

  return pino({
    name: options.name,
    level: options.level ?? (isDev ? 'debug' : 'info'),
    transport: isDev
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss.l',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
  });
}
