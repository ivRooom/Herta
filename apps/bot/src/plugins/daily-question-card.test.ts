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

describe('daily question card (#851)', () => {
  it('separates the prompt and numbered options into explicit sections', () => {
    const svg = buildDailyQuestionCardSvg(choice4);
    expect(svg).toContain('❓ 問題');
    expect(svg).toContain('🔢 選択肢');
    expect(svg.indexOf('❓ 問題')).toBeLessThan(svg.indexOf('🔢 選択肢'));
    choice4.options.forEach((option, index) =>
      expect(svg).toContain(`${index + 1}.  ${option.label}`),
    );
    expect(svg).toContain('番号は選択肢と対応しています');
  });

  it('renders a bounded PNG for four choices', async () => {
    const card = await renderDailyQuestionCard(choice4);
    const meta = await sharp(card).metadata();
    expect(meta).toMatchObject({ width: 1000, format: 'png' });
    expect(meta.height).toBeGreaterThan(400);
    expect(card.byteLength).toBeLessThan(1024 * 1024);
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
    const lines = wrapCardText(prompt, 30, 884, 8);
    expect(lines.length).toBeLessThanOrEqual(8);
    expect(lines.at(-1)).toContain('…');
    const card = await renderDailyQuestionCard({ ...choice4, prompt });
    const meta = await sharp(card).metadata();
    expect(meta.height).toBeLessThan(1200);
    expect(card.byteLength).toBeLessThan(1024 * 1024);
  });

  it('wraps long option labels and ellipsizes beyond three lines', () => {
    const lines = wrapCardText('選'.repeat(200), 28, 840, 3);
    expect(lines.length).toBe(3);
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
    expect(svg).toContain('✍ 回答方法');
    expect(svg).toContain('最大300文字');
    expect(svg).not.toContain('🔢 選択肢');
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
