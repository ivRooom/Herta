import { describe, expect, it } from 'vitest';
import {
  communityActivityExportCommand,
  toCsv,
  toJson,
  type CommunityActivityExportRow,
} from './community-activity-export.js';

const rows: CommunityActivityExportRow[] = [
  { userId: 'user-1', activityDate: '2026-01-01', metric: 'messages', value: 12 },
  { userId: 'user-2', activityDate: '2026-01-01', metric: 'voice_seconds', value: 3600 },
];

describe('toCsv', () => {
  it('ヘッダ行と各行をカンマ区切りで出力する', () => {
    expect(toCsv(rows)).toBe(
      [
        'user_id,date,metric,value',
        'user-1,2026-01-01,messages,12',
        'user-2,2026-01-01,voice_seconds,3600',
      ].join('\n'),
    );
  });

  it('カンマ・改行・ダブルクォートを含む値はダブルクォートで囲みエスケープする', () => {
    const csv = toCsv([
      { userId: 'weird,"id\nhere', activityDate: '2026-01-01', metric: 'messages', value: 1 },
    ]);
    expect(csv).toBe('user_id,date,metric,value\n"weird,""id\nhere",2026-01-01,messages,1');
  });

  it('空配列の場合はヘッダ行のみを返す', () => {
    expect(toCsv([])).toBe('user_id,date,metric,value');
  });
});

describe('toJson', () => {
  it('整形されたJSON配列を返す', () => {
    expect(JSON.parse(toJson(rows))).toEqual(rows);
  });
});

describe('communityActivityExportCommand definition', () => {
  it('period/formatのoptionを持つ', () => {
    const optionNames = communityActivityExportCommand.definition.options?.map((o) => o.name);
    expect(optionNames).toEqual(['period', 'format']);
  });
});
