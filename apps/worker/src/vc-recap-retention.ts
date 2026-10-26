import { purgeExpiredVcRecapTranscripts, type PrismaClient } from '@herta/db';
import type { Logger } from 'pino';

const PURGE_INTERVAL_MS = 60 * 60 * 1000;

export interface VcRecapRetentionRuntime {
  close(): Promise<void>;
}

/**
 * 本文保存に同意した参加者のVC文字起こし本文を、保持期間(セッション終了から30日)の
 * 経過後に削除する。プライバシーポリシーで約束した保持期間を守るため、起動時と1時間ごとに実行する。
 */
export async function startVcRecapRetentionRuntime(options: {
  prisma: PrismaClient;
  logger: Logger;
  intervalMs?: number;
  purge?: typeof purgeExpiredVcRecapTranscripts;
}): Promise<VcRecapRetentionRuntime> {
  const purge = options.purge ?? purgeExpiredVcRecapTranscripts;
  let closed = false;
  let runningPromise: Promise<void> | undefined;

  const run = (): Promise<void> => {
    if (closed) return Promise.resolve();
    if (runningPromise) return runningPromise;

    runningPromise = (async () => {
      try {
        const deleted = await purge(options.prisma);
        if (deleted > 0) {
          options.logger.info({ deleted }, '保持期間を過ぎたVC文字起こし本文を削除しました');
        }
      } catch (error) {
        options.logger.error(
          { errorName: error instanceof Error ? error.name : 'UnknownError' },
          'VC文字起こし本文の保持期間切れ削除に失敗しました',
        );
      } finally {
        runningPromise = undefined;
      }
    })();

    return runningPromise;
  };

  void run();
  const timer = setInterval(() => {
    void run();
  }, options.intervalMs ?? PURGE_INTERVAL_MS);
  timer.unref();

  return {
    async close() {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      await runningPromise;
    },
  };
}
