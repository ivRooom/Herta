import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  buildDailyQuestionCardSvg,
  renderDailyQuestionCard,
  wrapCardText,
  type DailyQuestionCardInput,
} from './daily-question-card.js';

const choice4: DailyQuestionCardInput = {
  slot: 'daily',
  prompt: 'AKB48のシングル「ヘビーローテーション」でセンターを務めたのは？',
  options: [
    { label: '前田敦子' },
    { label: '渡辺麻友' },
    { label: '高橋みなみ' },
    { label: '大島優子' },
  ],
  format: 'choice4',
  maxTextLength: 500,
};

// The production host fonts lack color emoji, so no pictograph glyph may
// appear in the SVG; status and markers are drawn shapes instead.
const FORBIDDEN_GLYPHS = ['❓', '🔢', '✍', '✅', '❌', '⏳', '▶'];

describe('daily question card (#851, 1920x1080 chalkboard redesign)', () => {
  it('uses a fixed 1920x1080 landscape canvas with separate question and choices zones', () => {
    const svg = buildDailyQuestionCardSvg(choice4);
    expect(svg).toContain('width="1920"');
    expect(svg).toContain('height="1080"');
    expect(svg).toContain('HERTA / DAILY QUESTION');
    expect(svg).toContain('今日の問題');
    expect(svg).toContain('QUESTION');
    expect(svg).toContain('CHOICES');
    choice4.options.forEach((option) => expect(svg).toContain(option.label));
    expect(svg).toContain('回答は下のボタンから。番号は選択肢と対応しています。');
  });

  it('contains no emoji or pictograph characters anywhere', () => {
    const variants: DailyQuestionCardInput[] = [
      choice4,
      {
        ...choice4,
        result: {
          state: 'graded',
          isCorrect: true,
          selectedOptionIndex: 3,
          selectedText: null,
          rewardPoints: 10,
        },
      },
      {
        ...choice4,
        result: {
          state: 'graded',
          isCorrect: false,
          selectedOptionIndex: 0,
          selectedText: null,
          rewardPoints: 0,
        },
      },
      {
        ...choice4,
        result: {
          state: 'pending',
          isCorrect: null,
          selectedOptionIndex: 1,
          selectedText: null,
          rewardPoints: 0,
        },
      },
      {
        slot: 'daily',
        prompt: '今日の感想を教えてください',
        options: [],
        format: 'free_text',
        maxTextLength: 300,
        result: {
          state: 'graded',
          isCorrect: null,
          selectedOptionIndex: null,
          selectedText: 'とても楽しかった',
          rewardPoints: 5,
        },
      },
      {
        ...choice4,
        heading: '昨日の問題',
        result: {
          state: 'graded',
          isCorrect: false,
          selectedOptionIndex: 0,
          selectedText: null,
          rewardPoints: 0,
          correctOptionIndex: 3,
        },
      },
      {
        ...choice4,
        heading: '昨日の問題',
        result: {
          state: 'graded',
          isCorrect: null,
          selectedOptionIndex: null,
          selectedText: null,
          rewardPoints: 0,
          correctOptionIndex: 1,
          unanswered: true,
        },
      },
    ];
    for (const input of variants) {
      const svg = buildDailyQuestionCardSvg(input);
      for (const glyph of FORBIDDEN_GLYPHS) expect(svg).not.toContain(glyph);
      expect(svg).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it('renders a 1920x1080 PNG for four choices', async () => {
    const card = await renderDailyQuestionCard(choice4);
    const meta = await sharp(card).metadata();
    expect(meta).toMatchObject({ width: 1920, height: 1080, format: 'png' });
    expect(card.byteLength).toBeLessThan(2 * 1024 * 1024);
  });

  it('renders two choices and the bonus slot heading', async () => {
    const input: DailyQuestionCardInput = {
      ...choice4,
      slot: 'bonus',
      format: 'choice2',
      options: [{ label: 'はい' }, { label: 'いいえ' }],
    };
    expect(buildDailyQuestionCardSvg(input)).toContain('ボーナス問題');
    const card = await renderDailyQuestionCard(input);
    expect((await sharp(card).metadata()).format).toBe('png');
  });

  it('bounds a maximum-length prompt instead of overflowing the card', async () => {
    const prompt = 'あ'.repeat(1000);
    const lines = wrapCardText(prompt, 46, 830, 6);
    expect(lines.length).toBeLessThanOrEqual(6);
    expect(lines.at(-1)).toContain('…');
    const card = await renderDailyQuestionCard({ ...choice4, prompt });
    const meta = await sharp(card).metadata();
    expect(meta).toMatchObject({ width: 1920, height: 1080 });
    expect(card.byteLength).toBeLessThan(2 * 1024 * 1024);
  });

  it('wraps long option labels and ellipsizes beyond two lines', () => {
    const lines = wrapCardText('選'.repeat(200), 38, 510, 2);
    expect(lines.length).toBe(2);
    expect(lines.at(-1)).toContain('…');
  });

  it('shows how to answer a free-text question instead of options', () => {
    const svg = buildDailyQuestionCardSvg({
      slot: 'daily',
      prompt: '今日の感想を教えてください',
      options: [],
      format: 'free_text',
      maxTextLength: 300,
    });
    expect(svg).toContain('回答方法');
    expect(svg).toContain('最大300文字');
    expect(svg).not.toContain('CHOICES');
  });

  it('bounds concurrent rendering and recovers after busy fallback', async () => {
    const cards = await Promise.allSettled([
      renderDailyQuestionCard(choice4),
      renderDailyQuestionCard(choice4),
      renderDailyQuestionCard(choice4),
    ]);
    expect(cards.filter((c) => c.status === 'fulfilled')).toHaveLength(2);
    expect(cards.filter((c) => c.status === 'rejected')).toHaveLength(1);
    expect((await renderDailyQuestionCard(choice4)).length).toBeGreaterThan(0);
  });

  it('uses a flat chalkboard design with no gradients or filters anywhere', () => {
    const variants: DailyQuestionCardInput[] = [
      choice4,
      {
        ...choice4,
        result: {
          state: 'graded',
          isCorrect: true,
          selectedOptionIndex: 3,
          selectedText: null,
          rewardPoints: 10,
        },
      },
      {
        ...choice4,
        result: {
          state: 'pending',
          isCorrect: null,
          selectedOptionIndex: 0,
          selectedText: null,
          rewardPoints: 0,
        },
      },
    ];
    for (const input of variants) {
      const svg = buildDailyQuestionCardSvg(input);
      expect(svg).not.toContain('<linearGradient');
      expect(svg).not.toContain('<radialGradient');
      expect(svg).not.toContain('Gradient');
      expect(svg).not.toContain('<filter');
      expect(svg).toContain('fill="#2E4B3F"');
      expect(svg).toContain('fill="#9C6B43"');
      expect(svg).toContain('fill="#7C5233"');
    }
  });

  it('outlines unanswered rows with a dashed chalk stroke', () => {
    const svg = buildDailyQuestionCardSvg(choice4);
    expect(svg.match(/stroke-dasharray="14 10"/g)).toHaveLength(4);
    expect(svg).toContain('stroke="#F7F3E6"');
  });

  it('leaves the unanswered card free of answered-state markers', () => {
    const svg = buildDailyQuestionCardSvg(choice4);
    expect(svg).not.toMatch(/<rect[^>]*width="700"[^>]*fill="#EF8FB5"/);
    expect(svg).not.toContain('正解');
    expect(svg).not.toContain('獲得');
  });

  it('fills only the selected row with saturated pink on a correct card', () => {
    const svg = buildDailyQuestionCardSvg({
      ...choice4,
      result: {
        state: 'graded',
        isCorrect: true,
        selectedOptionIndex: 3,
        selectedText: null,
        rewardPoints: 10,
      },
    });
    expect(svg).toContain('>正解<');
    expect(svg).toContain('fill="#7ED6A5"');
    expect(svg.match(/<rect[^>]*width="700"[^>]*fill="#EF8FB5"/g)).toHaveLength(1);
    expect(svg).toContain('fill="#F5D76E"');
    expect(svg).toContain('獲得 10pt');
    expect(svg).not.toContain('番号は選択肢と対応しています');
  });

  it('shows the incorrect pill, the pending pill and the void pill with their footers', () => {
    const incorrect = buildDailyQuestionCardSvg({
      ...choice4,
      result: {
        state: 'graded',
        isCorrect: false,
        selectedOptionIndex: 0,
        selectedText: null,
        rewardPoints: 0,
      },
    });
    expect(incorrect).toContain('>不正解<');
    expect(incorrect).toContain('fill="#F2A7C3"');
    expect(incorrect).toContain('獲得 0pt');

    const pending = buildDailyQuestionCardSvg({
      ...choice4,
      result: {
        state: 'pending',
        isCorrect: null,
        selectedOptionIndex: 1,
        selectedText: null,
        rewardPoints: 0,
      },
    });
    expect(pending).toContain('>結果待ち<');
    expect(pending).toContain('fill="#F5D76E"');
    expect(pending.match(/<rect[^>]*width="700"[^>]*fill="#EF8FB5"/g)).toHaveLength(1);
    expect(pending).toContain('結果が確定したらお知らせします。');
    expect(pending).not.toContain('獲得');

    const voided = buildDailyQuestionCardSvg({
      ...choice4,
      result: {
        state: 'void',
        isCorrect: null,
        selectedOptionIndex: null,
        selectedText: null,
        rewardPoints: 0,
      },
    });
    expect(voided).toContain('>無効化<');
    expect(voided).toContain('fill="#8FAF9F"');
    expect(voided).toContain('ポイントは付与されません。');
    expect(voided).not.toMatch(/<rect[^>]*width="700"[^>]*fill="#EF8FB5"/);
  });

  it('shows a plain answered pill when a graded result has no verdict', () => {
    const svg = buildDailyQuestionCardSvg({
      ...choice4,
      result: {
        state: 'graded',
        isCorrect: null,
        selectedOptionIndex: 2,
        selectedText: null,
        rewardPoints: 5,
      },
    });
    expect(svg).toContain('>回答済み<');
    expect(svg).toContain('獲得 5pt');
  });

  it('shows the submitted text instead of how-to-answer on a free-text answered card', () => {
    const svg = buildDailyQuestionCardSvg({
      slot: 'daily',
      prompt: '今日の感想を教えてください',
      options: [],
      format: 'free_text',
      maxTextLength: 300,
      result: {
        state: 'graded',
        isCorrect: null,
        selectedOptionIndex: null,
        selectedText: 'とても楽しかった',
        rewardPoints: 5,
      },
    });
    expect(svg).toContain('あなたの回答');
    expect(svg).toContain('とても楽しかった');
    expect(svg).not.toContain('回答方法');
    expect(svg).toContain('獲得 5pt');

    const missing = buildDailyQuestionCardSvg({
      slot: 'daily',
      prompt: '今日の感想を教えてください',
      options: [],
      format: 'free_text',
      maxTextLength: 300,
      result: {
        state: 'pending',
        isCorrect: null,
        selectedOptionIndex: null,
        selectedText: null,
        rewardPoints: 0,
      },
    });
    expect(missing).toContain('（回答なし）');
  });

  it('renders an answered card to a 1920x1080 PNG', async () => {
    const card = await renderDailyQuestionCard({
      ...choice4,
      result: {
        state: 'graded',
        isCorrect: true,
        selectedOptionIndex: 3,
        selectedText: null,
        rewardPoints: 10,
      },
    });
    const meta = await sharp(card).metadata();
    expect(meta).toMatchObject({ width: 1920, height: 1080, format: 'png' });
    expect(card.byteLength).toBeLessThan(2 * 1024 * 1024);
  });

  it('uses the heading override instead of the slot title (#820)', () => {
    const svg = buildDailyQuestionCardSvg({ ...choice4, heading: '昨日の問題' });
    expect(svg).toContain('昨日の問題');
    expect(svg).not.toContain('今日の問題');
    const bonus = buildDailyQuestionCardSvg({
      ...choice4,
      slot: 'bonus',
      heading: '昨日のボーナス問題',
    });
    expect(bonus).toContain('昨日のボーナス問題');
    expect(bonus).not.toContain('今日の問題');
  });

  it('badges the selected row when it is also the correct row (#820)', () => {
    const svg = buildDailyQuestionCardSvg({
      ...choice4,
      heading: '昨日の問題',
      result: {
        state: 'graded',
        isCorrect: true,
        selectedOptionIndex: 3,
        selectedText: null,
        rewardPoints: 10,
        correctOptionIndex: 3,
      },
    });
    expect(svg.match(/<rect[^>]*width="700"[^>]*fill="#EF8FB5"/g)).toHaveLength(1);
    expect(svg).toContain('fill="#9FE8C1"');
    // Status pill plus the badge on the selected row.
    expect(svg.match(/>正解</g)).toHaveLength(2);
    expect(svg).toContain('獲得 10pt');
  });

  it('outlines and badges the correct row when another option was picked (#820)', () => {
    const svg = buildDailyQuestionCardSvg({
      ...choice4,
      heading: '昨日の問題',
      result: {
        state: 'graded',
        isCorrect: false,
        selectedOptionIndex: 0,
        selectedText: null,
        rewardPoints: 0,
        correctOptionIndex: 3,
      },
    });
    expect(svg).toContain('>不正解<');
    expect(svg).toContain('stroke="#9FE8C1"');
    // Badge only; the pill reports the member's own miss.
    expect(svg.match(/>正解</g)).toHaveLength(1);
    // The two untouched rows keep their dashed chalk outline.
    expect(svg.match(/stroke-dasharray="14 10"/g)).toHaveLength(2);
  });

  it('shows no pill or points for an unanswered review and names the correct option (#820)', () => {
    const svg = buildDailyQuestionCardSvg({
      ...choice4,
      heading: '昨日の問題',
      result: {
        state: 'graded',
        isCorrect: null,
        selectedOptionIndex: null,
        selectedText: null,
        rewardPoints: 0,
        correctOptionIndex: 1,
        unanswered: true,
      },
    });
    expect(svg).not.toContain('回答済み');
    expect(svg).not.toContain('獲得');
    expect(svg).not.toMatch(/<rect[^>]*width="700"[^>]*fill="#EF8FB5"/);
    expect(svg).toContain('stroke="#9FE8C1"');
    expect(svg).toContain('正解は 2 番です');
    expect(svg.match(/stroke-dasharray="14 10"/g)).toHaveLength(3);
  });

  it('escapes markup in prompt and option labels', () => {
    const svg = buildDailyQuestionCardSvg({
      ...choice4,
      prompt: '<script>"x"</script>',
      options: [{ label: 'a & b' }],
    });
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).toContain('a &amp; b');
  });
});
