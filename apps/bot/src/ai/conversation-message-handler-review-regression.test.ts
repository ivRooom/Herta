import { describe, expect, it } from 'vitest';
import { resolveAiConversationGroundingState } from './conversation-message-handler.js';

const grounding = resolveAiConversationGroundingState;
const suppliedStockPriceCode =
  'Execute Python code that displays the current stock price passed in as an argument';

describe('Discord conversation grounding review regressions', () => {
  it('code executionがローカルで取得するcurrent値は外部grounding不要にする', () => {
    expect(grounding('Run Python code that prints the current time')).toBe('not_required');
    expect(grounding(suppliedStockPriceCode)).toBe('not_required');
    expect(grounding('Run Python code with the current time hard-coded')).toBe('insufficient');
  });

  it('未取得のDiscord添付内容に依存する依頼はfail closedする', () => {
    expect(grounding('What does the attached report say?')).toBe('insufficient');
    expect(grounding('Summarize the uploaded document')).toBe('insufficient');
    expect(grounding('添付ファイルの内容を教えて')).toBe('insufficient');
    expect(grounding('Summarize this file')).toBe('insufficient');
    expect(grounding('このファイルを要約して')).toBe('insufficient');
    expect(grounding('Convert this file to CSV')).toBe('insufficient');
    expect(grounding('Extract data from that document')).toBe('insufficient');
    expect(grounding('Convert the uploaded file to JSON')).toBe('insufficient');
    expect(grounding('このファイルをCSVに変換して')).toBe('insufficient');
    expect(grounding('Create a CSV from the attached report')).toBe('insufficient');
    expect(grounding('Generate JSON using the uploaded file')).toBe('insufficient');
    expect(grounding('Create a CSV from this file')).toBe('insufficient');
    expect(grounding('このファイルからCSVを作って')).toBe('insufficient');
    expect(grounding('How do Discord attachments work?')).toBe('not_required');
    expect(grounding('Explain how to convert a CSV file to JSON')).toBe('not_required');
    expect(grounding('Explain how to create a CSV file')).toBe('not_required');
  });
});
