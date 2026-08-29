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
    expect(grounding('From the attached report, create a CSV')).toBe('insufficient');
    expect(grounding('Using the uploaded file, generate JSON')).toBe('insufficient');
    expect(grounding('Create a CSV from this file')).toBe('insufficient');
    expect(grounding('From this file, create a CSV')).toBe('insufficient');
    expect(grounding('このファイルからCSVを作って')).toBe('insufficient');
    expect(grounding('How do Discord attachments work?')).toBe('not_required');
    expect(grounding('Explain how to convert a CSV file to JSON')).toBe('not_required');
    expect(grounding('Explain how to create a CSV file')).toBe('not_required');
  });

  it('URL内容のdownloadと変換は語順に関係なくfail closedする', () => {
    expect(grounding('Download https://example.com/data.csv and convert it to JSON')).toBe(
      'insufficient',
    );
    expect(grounding('https://example.com/data.csv and convert it to JSON')).toBe(
      'insufficient',
    );
    expect(grounding('Create a file containing https://example.com/data.csv')).toBe(
      'not_required',
    );
  });

  it('直近の相対日時を使う外部事実依頼はfail closedする', () => {
    expect(grounding("Who won yesterday's Yankees game?")).toBe('insufficient');
    expect(grounding("What was last night's score?")).toBe('insufficient');
    expect(grounding('昨日の試合結果を教えて')).toBe('insufficient');
    expect(grounding('昨夜のニュースを教えて')).toBe('insufficient');
  });
});
