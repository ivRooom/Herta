import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  buildMbtiQuestionCardSvg,
  renderMbtiQuestionCard,
  wrapJapaneseText,
} from './mini-games-mbti-card.js';

describe('wrapJapaneseText', () => {
  it('指定文字数ごとに折り返す', () => {
    expect(wrapJapaneseText('あいうえおかきくけこ', 5)).toEqual(['あいうえお', 'かきくけこ']);
  });

  it('ちょうど割り切れない場合は最後の行が短くなる', () => {
    expect(wrapJapaneseText('あいうえおか', 5)).toEqual(['あいうえお', 'か']);
  });

  it('空文字は空文字1行として返す(SVGのtext要素を壊さない)', () => {
    expect(wrapJapaneseText('', 5)).toEqual(['']);
  });

  it('maxCharsPerLineより短い文字列は1行のまま', () => {
    expect(wrapJapaneseText('短い文', 16)).toEqual(['短い文']);
  });
});

describe('buildMbtiQuestionCardSvg', () => {
  it('質問文・進捗・軸ラベルを含むSVGを生成する', () => {
    const svg = buildMbtiQuestionCardSvg({
      questionIndex: 0,
      totalQuestions: 50,
      prompt: '大人数で集まるとエネルギーが湧いてくる方だ',
      axis: 'EI',
    });
    expect(svg).toContain('<svg');
    expect(svg).toContain('1 / 50');
    expect(svg).toContain('外向性 (E) / 内向性 (I)');
    expect(svg).toContain('大人数で');
  });

  it('HTML特殊文字をエスケープする', () => {
    const svg = buildMbtiQuestionCardSvg({
      questionIndex: 0,
      totalQuestions: 50,
      prompt: '<script>alert(1)</script> & "quote" \'apos\'',
      axis: 'TF',
    });
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).toContain('&amp;');
    expect(svg).toContain('&quot;');
    expect(svg).toContain('&apos;');
  });

  it('進捗バーが問題番号に応じて幅を変える', () => {
    const first = buildMbtiQuestionCardSvg({
      questionIndex: 0,
      totalQuestions: 50,
      prompt: 'テスト',
      axis: 'JP',
    });
    const last = buildMbtiQuestionCardSvg({
      questionIndex: 49,
      totalQuestions: 50,
      prompt: 'テスト',
      axis: 'JP',
    });
    const widthOf = (svg: string) => {
      const match = /rx="12" fill="#a855f7"/.exec(svg);
      expect(match).not.toBeNull();
      const rectStart = svg.lastIndexOf('<rect', match!.index);
      const widthMatch = /width="(\d+)"/.exec(svg.slice(rectStart, match!.index));
      return Number(widthMatch![1]);
    };
    expect(widthOf(last)).toBeGreaterThan(widthOf(first));
  });
});

describe('renderMbtiQuestionCard', () => {
  it('有効なPNGバッファを生成する', async () => {
    const buffer = await renderMbtiQuestionCard({
      questionIndex: 0,
      totalQuestions: 50,
      prompt: '大人数で集まるとエネルギーが湧いてくる方だ',
      axis: 'EI',
    });
    const metadata = await sharp(buffer).metadata();
    expect(metadata.format).toBe('png');
    expect(metadata.width).toBe(1200);
    expect(metadata.height).toBe(630);
  });
});
