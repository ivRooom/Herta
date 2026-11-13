const COMMIT_SHA_PATTERN = /^[a-f0-9]{40}$/;

/**
 * Bot プロセスの起動時刻。モジュール読み込み時点をプロセス起動とみなす。
 * 外部 API へ問い合わせず、プロセスが保持する値だけで完結させる。
 */
export const PROCESS_STARTED_AT = new Date();

export interface BuildInfo {
  /** ビルド時に記録されたコミット SHA（40桁）。未記録・不正な場合は null。 */
  commitSha: string | null;
  /** 表示用の短縮形（先頭7桁）。commitSha が無い場合は null。 */
  shortSha: string | null;
  /** プロセス起動時刻。 */
  startedAt: Date;
}

/**
 * HERTA_BUILD_SHA の値を検証する。40桁の16進数以外は「不明」として扱い、
 * 推測や部分的な値をバージョンとして提示しない。
 */
export function parseBuildCommitSha(value: string | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || !COMMIT_SHA_PATTERN.test(normalized)) {
    return null;
  }
  return normalized;
}

export function getBuildInfo(
  env: NodeJS.ProcessEnv = process.env,
  startedAt: Date = PROCESS_STARTED_AT,
): BuildInfo {
  const commitSha = parseBuildCommitSha(env['HERTA_BUILD_SHA']);
  return {
    commitSha,
    shortSha: commitSha ? commitSha.slice(0, 7) : null,
    startedAt,
  };
}

/** Bot のソースリポジトリ（コミットへのリンク生成に使う） */
export const HERTA_REPOSITORY_URL = 'https://github.com/ivRooom/Herta';

/** コミット SHA への GitHub URL。未記録なら null。 */
export function commitUrl(commitSha: string | null): string | null {
  return commitSha ? `${HERTA_REPOSITORY_URL}/commit/${commitSha}` : null;
}

export function formatUptimeJa(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  return `${days}日 ${hours}時間 ${minutes}分`;
}
