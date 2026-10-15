import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { createEmptyMbtiScores } from '@herta/shared/mbti-core';
import {
  buildMbtiQuestionCardSvg,
  buildMbtiResultCardSvg,
  renderMbtiQuestionCard,
  renderMbtiResultCard,
  wrapJapaneseText,
} from './mbti-card.js';

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

  it('「が」を「〜がる」動詞語尾として誤って区切り文字にしない(CodeRabbit指摘)', () => {
    const lines = wrapJapaneseText('賑やかな場所にいると気分が上がる方だ');
    expect(lines).toEqual(['賑やかな場所にいると気分が', '上がる方だ']);
    expect(lines.some((line) => line.endsWith('上が'))).toBe(false);
  });

  it('「が」を「〜ながら」の一部として誤って区切り文字にしない', () => {
    const lines = wrapJapaneseText('目に見える成果を確認しながら進めたい方だ');
    expect(lines.some((line) => line.startsWith('ら'))).toBe(false);
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
    const axes = ['EI', 'SN', 'TF', 'JP', 'AT'] as const;
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

  it('5軸すべてでSVG(アイコン含む)が有効なPNGとしてレンダリングできる', async () => {
    for (const axis of ['EI', 'SN', 'TF', 'JP', 'AT'] as const) {
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

describe('buildMbtiResultCardSvg', () => {
  it('タイプ・タイトル・説明文・各軸の割合を含むSVGを生成する', () => {
    const svg = buildMbtiResultCardSvg({
      type: 'INTJ',
      identity: 'A',
      scores: { EI: -10, SN: -10, TF: 10, JP: 10, AT: 10 },
      roleNote: null,
    });
    expect(svg).toContain('<svg');
    expect(svg).toContain('>INTJ-A<');
    expect(svg).toContain('建築家');
    expect(svg).toContain('独創的な戦略で物事を計画し');
  });

  it('identityに応じてlabel(アサーティブ/タービュレント)をサブタイトルへ表示する', () => {
    const assertive = buildMbtiResultCardSvg({
      type: 'INTJ',
      identity: 'A',
      scores: createEmptyMbtiScores(),
      roleNote: null,
    });
    const turbulent = buildMbtiResultCardSvg({
      type: 'INTJ',
      identity: 'T',
      scores: createEmptyMbtiScores(),
      roleNote: null,
    });
    expect(assertive).toContain('>INTJ-A<');
    expect(assertive).toContain('アサーティブ');
    expect(turbulent).toContain('>INTJ-T<');
    expect(turbulent).toContain('タービュレント');
  });

  it('未知のタイプでもクラッシュせずフォールバック文言を表示する', () => {
    const svg = buildMbtiResultCardSvg({
      type: 'XXXX',
      identity: 'A',
      scores: createEmptyMbtiScores(),
      roleNote: null,
    });
    expect(svg).toContain('>XXXX-A<');
    expect(svg).toContain('診断結果を計算できませんでした。');
  });

  it('roleNoteがある場合のみRole付与メッセージを表示する', () => {
    const withRole = buildMbtiResultCardSvg({
      type: 'INTJ',
      identity: 'A',
      scores: createEmptyMbtiScores(),
      roleNote: '<@&123456789012345678> を付与しました',
    });
    const withoutRole = buildMbtiResultCardSvg({
      type: 'INTJ',
      identity: 'A',
      scores: createEmptyMbtiScores(),
      roleNote: null,
    });
    expect(withRole).toContain('を付与しました');
    expect(withoutRole).not.toContain('を付与しました');
  });

  it('軸の傾きに応じてバー幅・百分率表示が変わる(AT軸含む)', () => {
    const strongE = buildMbtiResultCardSvg({
      type: 'ENTJ',
      identity: 'A',
      scores: { EI: 26, SN: 0, TF: 0, JP: 0, AT: 0 },
      roleNote: null,
    });
    const neutral = buildMbtiResultCardSvg({
      type: 'ENTJ',
      identity: 'A',
      scores: createEmptyMbtiScores(),
      roleNote: null,
    });
    expect(strongE).toContain('E 100%');
    expect(neutral).toContain('E 50%');
    expect(neutral).toContain('A 50%');
  });

  it('HTML特殊文字(roleNote)をエスケープする', () => {
    const svg = buildMbtiResultCardSvg({
      type: 'INTJ',
      identity: 'A',
      scores: createEmptyMbtiScores(),
      roleNote: '<script>alert(1)</script>',
    });
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
  });

  it('背景はグラデーションを使わず単色でカード間の統一感を保つ', () => {
    const svg = buildMbtiResultCardSvg({
      type: 'INTJ',
      identity: 'A',
      scores: createEmptyMbtiScores(),
      roleNote: null,
    });
    expect(svg).not.toContain('linearGradient');
    expect(svg).not.toContain('radialGradient');
    expect(svg).toContain('fill="#17162a"');
  });

  it('小さくivRoomのブランド表記を含む', () => {
    const svg = buildMbtiResultCardSvg({
      type: 'INTJ',
      identity: 'A',
      scores: createEmptyMbtiScores(),
      roleNote: null,
    });
    expect(svg).toContain('>ivRoom<');
  });
});

describe('renderMbtiResultCard', () => {
  it('有効なPNGバッファを生成する', async () => {
    const buffer = await renderMbtiResultCard({
      type: 'ENFP',
      identity: 'T',
      scores: { EI: 10, SN: -5, TF: -8, JP: 3, AT: -4 },
      roleNote: '<@&123456789012345678> を付与しました',
    });
    const metadata = await sharp(buffer).metadata();
    expect(metadata.format).toBe('png');
    expect(metadata.width).toBe(1200);
    expect(metadata.height).toBe(630);
  });

  it('全16タイプ×2つのidentityでSVGが有効なPNGとしてレンダリングできる', async () => {
    const types = [
      'INTJ',
      'INTP',
      'ENTJ',
      'ENTP',
      'INFJ',
      'INFP',
      'ENFJ',
      'ENFP',
      'ISTJ',
      'ISFJ',
      'ESTJ',
      'ESFJ',
      'ISTP',
      'ISFP',
      'ESTP',
      'ESFP',
    ] as const;
    for (const type of types) {
      for (const identity of ['A', 'T'] as const) {
        const buffer = await renderMbtiResultCard({
          type,
          identity,
          scores: createEmptyMbtiScores(),
          roleNote: null,
        });
        const metadata = await sharp(buffer).metadata();
        expect(metadata.format).toBe('png');
      }
    }
  });
});
