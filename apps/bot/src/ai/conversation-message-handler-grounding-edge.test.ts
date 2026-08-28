import { describe, expect, it } from 'vitest';
import { resolveAiConversationGroundingState } from './conversation-message-handler.js';

describe('Discord grounding external source boundary', () => {
  it.each([
    'What does the official documentation say about X?',
    'What does the website say about this?',
    'Summarize the official documentation for X',
    '公式ドキュメントには何が書いてある？',
  ])('%s をsource不足へfail closedする', (input) => {
    expect(resolveAiConversationGroundingState(input)).toBe('insufficient');
  });

  it.each(['What does website design mean?', 'Explain website architecture'])(
    '%s は一般説明として扱う',
    (input) => {
      expect(resolveAiConversationGroundingState(input)).toBe('not_required');
    },
  );
});

describe('Discord grounding runtime-value clause boundary', () => {
  it('runtimeで取得する現在時刻だけならnot_requiredのまま扱う', () => {
    expect(
      resolveAiConversationGroundingState('Write Python code that prints the current time'),
    ).toBe('not_required');
  });

  it('引数で受ける現在株価だけならnot_requiredのまま扱う', () => {
    expect(
      resolveAiConversationGroundingState(
        'Write Python code that displays the current stock price passed in as an argument',
      ),
    ).toBe('not_required');
  });

  it('runtime現在時刻と別のlive factを混在させた場合はfail closedする', () => {
    expect(
      resolveAiConversationGroundingState(
        "Write Python code that prints the current time and add a comment with today's weather",
      ),
    ).toBe('insufficient');
  });

  it('引数で受ける株価と別のlive factを混在させた場合はfail closedする', () => {
    expect(
      resolveAiConversationGroundingState(
        "Write Python code that displays the current stock price passed in as an argument and add a comment with today's weather",
      ),
    ).toBe('insufficient');
  });
});
