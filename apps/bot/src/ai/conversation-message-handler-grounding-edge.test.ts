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

  it.each([
    'Create a README based on\nhttps://example.com',
    'https://example.com\nの内容を要約して',
  ])('%s の改行をまたぐURL参照をfail closedする', (input) => {
    expect(resolveAiConversationGroundingState(input)).toBe('insufficient');
  });

  it.each([
    'Look up https://example.com',
    'Verify https://example.com',
    'https://example.com を確認して',
    'https://example.com を調べて',
  ])('%s の明示URL lookupをfail closedする', (input) => {
    expect(resolveAiConversationGroundingState(input)).toBe('insufficient');
  });

  it.each([
    'Create a README based on GitHub PR #351',
    'PR #351 を元にREADMEを作って',
    'Summarize Issue #350',
    'What does PR #351 say?',
  ])('%s の具体的repository参照をfail closedする', (input) => {
    expect(resolveAiConversationGroundingState(input)).toBe('insufficient');
  });

  it.each([
    'What does website design mean?',
    'Explain website architecture',
    'Write Python code to look up a key in a dictionary',
    'Create a text file containing "PR #351"',
    'Create a README explaining GitHub pull requests',
  ])('%s は外部参照不要として扱う', (input) => {
    expect(resolveAiConversationGroundingState(input)).toBe('not_required');
  });
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
