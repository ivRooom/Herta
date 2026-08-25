import { describe, expect, it } from 'vitest';
import { formatSuggestionHistoryPage, type SuggestionHistoryRecord } from './suggestion-history.js';

const ID = '11111111-1111-4111-8111-111111111111';

function formatStatusChange(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string {
  const record: SuggestionHistoryRecord = {
    id: '22222222-2222-4222-8222-222222222222',
    event: 'suggestion.status',
    changes: { before, after },
    metadata: { operationSource: 'discord' },
    createdAt: new Date('2026-08-25T00:00:00.000Z'),
  };
  return formatSuggestionHistoryPage({ records: [record], hasNext: false }, ID, 1);
}

describe('Suggestion history Staff comment transitions', () => {
  it('Staffコメント削除を本文なしで履歴へ表示する', () => {
    const output = formatStatusChange(
      { status: 'reviewing', staffNotePresent: true, staffNoteLength: 12 },
      { status: 'reviewing', staffNotePresent: false, staffNoteLength: 0 },
    );

    expect(output).toContain('検討中 → 検討中');
    expect(output).toContain('Staffコメント削除');
  });

  it('Staffコメント追加を本文なしで履歴へ表示する', () => {
    const output = formatStatusChange(
      { status: 'pending', staffNotePresent: false, staffNoteLength: 0 },
      { status: 'reviewing', staffNotePresent: true, staffNoteLength: 8 },
    );

    expect(output).toContain('未確認 → 検討中');
    expect(output).toContain('Staffコメント追加');
  });

  it('Staffコメント文字数変更を更新として履歴へ表示する', () => {
    const output = formatStatusChange(
      { status: 'accepted', staffNotePresent: true, staffNoteLength: 8 },
      { status: 'accepted', staffNotePresent: true, staffNoteLength: 15 },
    );

    expect(output).toContain('採用 → 採用');
    expect(output).toContain('Staffコメント更新');
  });
});
