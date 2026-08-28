import { describe, expect, it } from 'vitest';
import { resolveAiConversationGroundingState } from './conversation-message-handler.js';

describe('Discord conversation grounding review regressions', () => {
  it('code executionがローカルで取得するcurrent値は外部grounding不要にする', () => {
    expect(
      resolveAiConversationGroundingState('Run Python code that prints the current time'),
    ).toBe('not_required');
    expect(
      resolveAiConversationGroundingState(
        'Execute Python code that displays the current stock price passed in as an argument',
      ),
    ).toBe('not_required');
    expect(
      resolveAiConversationGroundingState('Run Python code with the current time hard-coded'),
    ).toBe('insufficient');
  });

  it('未取得のDiscord添付内容に依存する依頼はfail closedする', () => {
    expect(resolveAiConversationGroundingState('What does the attached report say?')).toBe(
      'insufficient',
    );
    expect(resolveAiConversationGroundingState('Summarize the uploaded document')).toBe(
      'insufficient',
    );
    expect(resolveAiConversationGroundingState('添付ファイルの内容を教えて')).toBe('insufficient');
    expect(resolveAiConversationGroundingState('How do Discord attachments work?')).toBe(
      'not_required',
    );
  });
});
