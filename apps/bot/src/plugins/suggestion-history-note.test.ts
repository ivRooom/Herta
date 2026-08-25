import { describe, expect, it } from 'vitest';
import { formatSuggestionHistoryPage, type SuggestionHistoryRecord } from './suggestion-history.js';

const ID = '11111111-1111-4111-8111-111111111111';

function formatStatusChange(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  metadata: Record<string, unknown> = { operationSource: 'discord' },
): string {
  const record: SuggestionHistoryRecord = {
    id: '22222222-2222-4222-8222-222222222222',
    event: 'suggestion.status',
    changes: { before, after },
    metadata,
    createdAt: new Date('2026-08-25T00:00:00.000Z'),
  };
  return formatSuggestionHistoryPage({ records: [record], hasNext: false }, ID, 1);
}

describe('Suggestion history Staff comment transitions', () => {
  it('Staffコメント削除を本文なし・文字数遷移付きで履歴へ表示する', () => {
    const output = formatStatusChange(
      { status: 'reviewing', staffNotePresent: true, staffNoteLength: 12 },
      { status: 'reviewing', staffNotePresent: false, staffNoteLength: 0 },
    );

    expect(output).toContain('検討中 → 検討中');
    expect(output).toContain('Staffコメント削除 (12文字 → 0文字)');
  });

  it('Staffコメント追加を本文なし・文字数遷移付きで履歴へ表示する', () => {
    const output = formatStatusChange(
      { status: 'pending', staffNotePresent: false, staffNoteLength: 0 },
      { status: 'reviewing', staffNotePresent: true, staffNoteLength: 8 },
    );

    expect(output).toContain('未確認 → 検討中');
    expect(output).toContain('Staffコメント追加 (0文字 → 8文字)');
  });

  it('Staffコメント文字数変更を更新として文字数遷移付きで表示する', () => {
    const output = formatStatusChange(
      { status: 'accepted', staffNotePresent: true, staffNoteLength: 8 },
      { status: 'accepted', staffNotePresent: true, staffNoteLength: 15 },
    );

    expect(output).toContain('採用 → 採用');
    expect(output).toContain('Staffコメント更新 (8文字 → 15文字)');
  });

  it('状態と文字数が同じでもStaffコメント差し替えAuditを更新として表示する', () => {
    const output = formatStatusChange(
      { status: 'reviewing', staffNotePresent: true, staffNoteLength: 12 },
      { status: 'reviewing', staffNotePresent: true, staffNoteLength: 12 },
      { operationSource: 'discord', staffNoteChanged: true },
    );

    expect(output).toContain('検討中 → 検討中');
    expect(output).toContain('Staffコメント更新 (12文字 → 12文字)');
  });
});
