import { describe, expect, it } from 'vitest';
import {
  AKINATOR_MAX_TURNS,
  akinatorAnswerLabel,
  buildAkinatorPrompt,
  isAkinatorAnswer,
  parseAkinatorResponse,
} from './akinator-game-core.js';

describe('akinator-game-core', () => {
  it('既知の回答値だけを受け付ける', () => {
    expect(isAkinatorAnswer('yes')).toBe(true);
    expect(isAkinatorAnswer('probably_not')).toBe(true);
    expect(isAkinatorAnswer('maybe')).toBe(false);
    expect(isAkinatorAnswer('')).toBe(false);
  });

  it('回答値を日本語ラベルへ変換する', () => {
    expect(akinatorAnswerLabel('yes')).toBe('はい');
    expect(akinatorAnswerLabel('unknown')).toBe('わからない');
  });

  it('履歴なしの初回プロンプトには質問開始の指示を含める', () => {
    const prompt = buildAkinatorPrompt({
      history: [],
      excludedGuesses: [],
      turnNumber: 1,
      maxTurns: AKINATOR_MAX_TURNS,
    });
    expect(prompt).toContain('まだありません');
    expect(prompt).toContain('QUESTION: ');
    expect(prompt).toContain('GUESS: ');
  });

  it('履歴と除外済み推測をプロンプトへ含める', () => {
    const prompt = buildAkinatorPrompt({
      history: [{ question: '実在の人物ですか？', answer: 'yes' }],
      excludedGuesses: ['アインシュタイン'],
      turnNumber: 2,
      maxTurns: AKINATOR_MAX_TURNS,
    });
    expect(prompt).toContain('実在の人物ですか？');
    expect(prompt).toContain('はい');
    expect(prompt).toContain('アインシュタイン');
    expect(prompt).not.toContain('最終ターン');
  });

  it('最終ターンでは必ず推測するよう指示する', () => {
    const prompt = buildAkinatorPrompt({
      history: [],
      excludedGuesses: [],
      turnNumber: AKINATOR_MAX_TURNS,
      maxTurns: AKINATOR_MAX_TURNS,
    });
    expect(prompt).toContain('最終ターン');
  });

  it('QUESTION:形式のレスポンスを解析する', () => {
    expect(parseAkinatorResponse('QUESTION: 実在の人物ですか？')).toEqual({
      type: 'question',
      question: '実在の人物ですか？',
    });
    expect(parseAkinatorResponse('  question:  日本人ですか？  ')).toEqual({
      type: 'question',
      question: '日本人ですか？',
    });
  });

  it('GUESS:形式のレスポンスを解析する', () => {
    expect(parseAkinatorResponse('GUESS: アインシュタイン')).toEqual({
      type: 'guess',
      guess: 'アインシュタイン',
    });
  });

  it('不明な形式・空文字・過大な長さのレスポンスを拒否する', () => {
    expect(parseAkinatorResponse('わかりません')).toBeNull();
    expect(parseAkinatorResponse('')).toBeNull();
    expect(parseAkinatorResponse('QUESTION: ')).toBeNull();
    expect(parseAkinatorResponse(`QUESTION: ${'a'.repeat(300)}`)).toBeNull();
    expect(parseAkinatorResponse(`GUESS: ${'a'.repeat(200)}`)).toBeNull();
  });

  it('複数行のレスポンスは1行目だけを採用する(前置き・説明の混入を防ぐ)', () => {
    expect(parseAkinatorResponse('QUESTION: 実在の人物ですか？\n補足: これは重要です')).toEqual({
      type: 'question',
      question: '実在の人物ですか？',
    });
  });
});
