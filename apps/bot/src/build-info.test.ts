import { describe, expect, it } from 'vitest';
import {
  commitUrl,
  formatUptimeJa,
  getBuildInfo,
  HERTA_REPOSITORY_URL,
  parseBuildCommitSha,
} from './build-info.js';

const VALID_SHA = '30ac936d7b68afeb238b7549806ac4bff06a41c9';

describe('parseBuildCommitSha', () => {
  it('40桁の16進数を受け付ける', () => {
    expect(parseBuildCommitSha(VALID_SHA)).toBe(VALID_SHA);
  });

  it('大文字は小文字へ正規化する', () => {
    expect(parseBuildCommitSha(VALID_SHA.toUpperCase())).toBe(VALID_SHA);
  });

  it('前後の空白を除去する', () => {
    expect(parseBuildCommitSha(`  ${VALID_SHA}\n`)).toBe(VALID_SHA);
  });

  it('短縮形や不正な値は不明として扱う', () => {
    expect(parseBuildCommitSha('30ac936')).toBeNull();
    expect(parseBuildCommitSha('not-a-sha')).toBeNull();
    expect(parseBuildCommitSha('')).toBeNull();
    expect(parseBuildCommitSha(undefined)).toBeNull();
  });
});

describe('getBuildInfo', () => {
  it('環境変数から SHA と短縮形を返す', () => {
    const startedAt = new Date('2026-11-12T18:00:00.000Z');
    const info = getBuildInfo({ HERTA_BUILD_SHA: VALID_SHA }, startedAt);
    expect(info.commitSha).toBe(VALID_SHA);
    expect(info.shortSha).toBe('30ac936');
    expect(info.startedAt).toBe(startedAt);
  });

  it('未設定の場合は null を返し推測しない', () => {
    const info = getBuildInfo({});
    expect(info.commitSha).toBeNull();
    expect(info.shortSha).toBeNull();
  });
});

describe('formatUptimeJa', () => {
  it('日・時間・分へ整形する', () => {
    expect(formatUptimeJa(0)).toBe('0日 0時間 0分');
    expect(formatUptimeJa(90_061)).toBe('1日 1時間 1分');
  });

  it('負数は 0 として扱う', () => {
    expect(formatUptimeJa(-5)).toBe('0日 0時間 0分');
  });
});

describe('commitUrl', () => {
  it('コミットへの URL を組み立てる', () => {
    expect(commitUrl(VALID_SHA)).toBe(`${HERTA_REPOSITORY_URL}/commit/${VALID_SHA}`);
  });

  it('未記録の場合は null', () => {
    expect(commitUrl(null)).toBeNull();
  });
});
