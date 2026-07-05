import { setTimeout } from 'node:timers/promises';

/** 指定ミリ秒待機する */
export function sleep(ms: number): Promise<void> {
  return setTimeout(ms);
}
