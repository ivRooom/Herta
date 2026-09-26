import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { buildMbtiQuestionCardSvg, renderMbtiQuestionCard, wrapJapaneseText } from './mbti-card.js';

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

  it('単語の途中(例: 安心)で改行せず、直前の助詞で区切る', () => {
    const lines = wrapJapaneseText('物事がきちんと整理されていると安心する方だ');
    expect(lines).toEqual(['物事がきちんと整理されていると', '安心する方だ']);
    // 「安心」が分割されていないことを明示的に確認する
    expect(lines.some((line) => line.endsWith('安'))).toBe(false);
  });

  it('自然な区切り文字が近くに無ければmaxCharsPerLineまで詰める', () => {
    const lines = wrapJapaneseText('議論では場の調和より正しさの方が大事だと思う方だ');
    expect(lines[0]).toHaveLength(16);
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
      const match = /<rect[^>]*fill="#a855f7"[^>]*\/>/.exec(svg);
      expect(match).not.toBeNull();
      const widthMatch = /width="(\d+)"/.exec(match![0]);
      return Number(widthMatch![1]);
    };
    expect(widthOf(last)).toBeGreaterThan(widthOf(first));
  });

  it('軸ごとに異なるアイコン(SVGパス)を描画する', () => {
    const axes = ['EI', 'SN', 'TF', 'JP'] as const;
    const bodies = axes.map(
      (axis) =>
        buildMbtiQuestionCardSvg({ questionIndex: 0, totalQuestions: 50, prompt: 'テスト', axis })
          .split('translate(96,88)')[1]!
          .split('</g>')[0]!,
    );
    expect(new Set(bodies).size).toBe(axes.length);
  });

  it('背景はグラデーションを使わず単色でカード間の統一感を保つ', () => {
    const svg = buildMbtiQuestionCardSvg({
      questionIndex: 0,
      totalQuestions: 50,
      prompt: 'テスト',
      axis: 'EI',
    });
    expect(svg).not.toContain('linearGradient');
    expect(svg).not.toContain('radialGradient');
    expect(svg).toContain('fill="#17162a"');
  });

  it('小さくivRoomのブランド表記を含む', () => {
    const svg = buildMbtiQuestionCardSvg({
      questionIndex: 0,
      totalQuestions: 50,
      prompt: 'テスト',
      axis: 'EI',
    });
    expect(svg).toContain('>ivRoom<');
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

  it('4軸すべてでSVG(アイコン含む)が有効なPNGとしてレンダリングできる', async () => {
    for (const axis of ['EI', 'SN', 'TF', 'JP'] as const) {
      const buffer = await renderMbtiQuestionCard({
        questionIndex: 0,
        totalQuestions: 50,
        prompt: 'テスト',
        axis,
      });
      const metadata = await sharp(buffer).metadata();
      expect(metadata.format).toBe('png');
    }
  });
});
