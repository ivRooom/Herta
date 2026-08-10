import { createHash, randomInt } from 'node:crypto';
import { EmbedBuilder, MessageFlags } from 'discord.js';
import type { SlashCommand } from './registry.js';

const MAX_CHOICES = 20;
const MAX_CHOICE_LENGTH = 4_000;
const MAX_DICE_COUNT = 20;
const MAX_DICE_SIDES = 1_000;
const RANDOM_ABSOLUTE_LIMIT = 1_000_000_000;
const EMBED_DESCRIPTION_LIMIT = 4_096;

const EIGHT_BALL_ANSWERS = [
  'かなり期待できそうです！',
  'その可能性は高そうです。',
  'いい結果になりそうです。',
  '今なら進めてよさそうです。',
  'もう少し情報を集めてから決めるのがよさそうです。',
  '今は判断を保留した方がよさそうです。',
  '別のやり方を試す価値がありそうです。',
  '今回は見送る方がよさそうです。',
] as const;

const RPS_HANDS = ['rock', 'paper', 'scissors'] as const;
type RpsHand = (typeof RPS_HANDS)[number];

const RPS_LABELS: Record<RpsHand, string> = {
  rock: '✊ グー',
  paper: '✋ パー',
  scissors: '✌️ チョキ',
};

export function parseChoices(value: string): string[] {
  return value
    .split(/[\n,、]/u)
    .map((choice) => choice.trim())
    .filter(Boolean);
}

export function rollDice(sides: number, count: number): number[] {
  const normalizedSides = Math.min(MAX_DICE_SIDES, Math.max(2, Math.trunc(sides)));
  const normalizedCount = Math.min(MAX_DICE_COUNT, Math.max(1, Math.trunc(count)));
  return Array.from({ length: normalizedCount }, () => randomInt(1, normalizedSides + 1));
}

export function randomIntegerInclusive(min: number, max: number): number {
  const lower = Math.max(
    -RANDOM_ABSOLUTE_LIMIT,
    Math.min(RANDOM_ABSOLUTE_LIMIT, Math.trunc(Math.min(min, max))),
  );
  const upper = Math.max(
    -RANDOM_ABSOLUTE_LIMIT,
    Math.min(RANDOM_ABSOLUTE_LIMIT, Math.trunc(Math.max(min, max))),
  );
  return randomInt(lower, upper + 1);
}

export function shuffleChoices<T>(values: readonly T[]): T[] {
  const shuffled = [...values];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = randomInt(index + 1);
    [shuffled[index], shuffled[target]] = [shuffled[target]!, shuffled[index]!];
  }
  return shuffled;
}

export function formatShuffleDescription(choices: readonly string[]): string {
  return choices.map((choice, index) => `**${index + 1}.** ${choice}`).join('\n');
}

export function resolveRpsResult(player: RpsHand, bot: RpsHand): 'win' | 'draw' | 'lose' {
  if (player === bot) return 'draw';
  if (
    (player === 'rock' && bot === 'scissors') ||
    (player === 'paper' && bot === 'rock') ||
    (player === 'scissors' && bot === 'paper')
  ) {
    return 'win';
  }
  return 'lose';
}

export function deterministicRate(subject: string, userId: string): number {
  const digest = createHash('sha256')
    .update(`${userId}:${subject.trim().toLocaleLowerCase('ja')}`)
    .digest();
  return digest.readUInt32BE(0) % 101;
}

export const chooseCommand: SlashCommand = {
  definition: {
    name: 'choose',
    description: '候補の中からランダムに1つ選びます',
    options: [
      {
        name: 'choices',
        description: 'カンマまたは改行区切りで2〜20件の候補を入力',
        type: 'string',
        required: true,
      },
    ],
  },
  async execute(interaction) {
    const choices = parseChoices(interaction.options.getString('choices', true));
    if (choices.length < 2 || choices.length > MAX_CHOICES) {
      await interaction.reply({
        content: '候補を2〜20件、カンマまたは改行で区切って入力してください。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (choices.some((choice) => choice.length > MAX_CHOICE_LENGTH)) {
      await interaction.reply({
        content: '各候補は4,000文字以内で入力してください。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const selected = choices[randomInt(choices.length)]!;
    const embed = new EmbedBuilder()
      .setTitle('🎯 Herta Choice')
      .setDescription(`**${selected}**`)
      .setColor(0x7c6df2)
      .setFooter({ text: `${choices.length}件の候補から選択` });
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};

export const diceCommand: SlashCommand = {
  definition: {
    name: 'dice',
    description: '指定した面数・個数のダイスを振ります',
    options: [
      {
        name: 'sides',
        description: 'ダイスの面数（2〜1000、既定6）',
        type: 'integer',
      },
      {
        name: 'count',
        description: 'ダイスの個数（1〜20、既定1）',
        type: 'integer',
      },
    ],
  },
  async execute(interaction) {
    const requestedSides = interaction.options.getInteger('sides') ?? 6;
    const requestedCount = interaction.options.getInteger('count') ?? 1;
    if (
      requestedSides < 2 ||
      requestedSides > MAX_DICE_SIDES ||
      requestedCount < 1 ||
      requestedCount > MAX_DICE_COUNT
    ) {
      await interaction.reply({
        content: 'sidesは2〜1000、countは1〜20の範囲で指定してください。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const rolls = rollDice(requestedSides, requestedCount);
    const total = rolls.reduce((sum, value) => sum + value, 0);
    const embed = new EmbedBuilder()
      .setTitle(`🎲 ${requestedCount}d${requestedSides}`)
      .setDescription(rolls.map((value, index) => `#${index + 1}: **${value}**`).join('\n'))
      .setColor(0x7c6df2)
      .addFields({ name: '合計', value: String(total), inline: true });
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};

export const coinflipCommand: SlashCommand = {
  definition: {
    name: 'coinflip',
    description: 'コインを投げて表か裏を決めます',
  },
  async execute(interaction) {
    const result = randomInt(2) === 0 ? '表' : '裏';
    await interaction.reply({
      content: `🪙 **${result}**`,
      flags: MessageFlags.Ephemeral,
    });
  },
};

export const randomCommand: SlashCommand = {
  definition: {
    name: 'random',
    description: '指定範囲からランダムな整数を生成します',
    options: [
      {
        name: 'min',
        description: '最小値（-10億〜10億）',
        type: 'integer',
        required: true,
      },
      {
        name: 'max',
        description: '最大値（-10億〜10億）',
        type: 'integer',
        required: true,
      },
    ],
  },
  async execute(interaction) {
    const min = interaction.options.getInteger('min', true);
    const max = interaction.options.getInteger('max', true);
    if (
      Math.abs(min) > RANDOM_ABSOLUTE_LIMIT ||
      Math.abs(max) > RANDOM_ABSOLUTE_LIMIT ||
      min > max
    ) {
      await interaction.reply({
        content: 'min ≤ max かつ、両方を-10億〜10億の範囲で指定してください。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const result = randomIntegerInclusive(min, max);
    await interaction.reply({
      content: `🔢 **${result.toLocaleString('ja-JP')}**  （${min.toLocaleString('ja-JP')}〜${max.toLocaleString('ja-JP')}）`,
      flags: MessageFlags.Ephemeral,
    });
  },
};

export const eightBallCommand: SlashCommand = {
  definition: {
    name: '8ball',
    description: '質問にHertaが8ボール風に答えます',
    options: [
      {
        name: 'question',
        description: 'Hertaに聞きたいこと',
        type: 'string',
        required: true,
      },
    ],
  },
  async execute(interaction) {
    const question = interaction.options.getString('question', true).trim();
    if (!question || question.length > 500) {
      await interaction.reply({
        content: '質問は1〜500文字で入力してください。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const answer = EIGHT_BALL_ANSWERS[randomInt(EIGHT_BALL_ANSWERS.length)]!;
    const embed = new EmbedBuilder()
      .setTitle('🎱 Herta 8 Ball')
      .setDescription(`**Q.** ${question}\n\n**A.** ${answer}`)
      .setColor(0x7c6df2);
    await interaction.reply({ embeds: [embed] });
  },
};

export const rpsCommand: SlashCommand = {
  definition: {
    name: 'rps',
    description: 'Hertaとじゃんけんします',
    options: [
      {
        name: 'hand',
        description: '出す手を選択',
        type: 'string',
        required: true,
        choices: [
          { name: '✊ グー', value: 'rock' },
          { name: '✋ パー', value: 'paper' },
          { name: '✌️ チョキ', value: 'scissors' },
        ],
      },
    ],
  },
  async execute(interaction) {
    const requested = interaction.options.getString('hand', true);
    if (!RPS_HANDS.includes(requested as RpsHand)) {
      await interaction.reply({
        content: '有効な手を選択してください。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const player = requested as RpsHand;
    const bot = RPS_HANDS[randomInt(RPS_HANDS.length)]!;
    const result = resolveRpsResult(player, bot);
    const resultLabel =
      result === 'win'
        ? '🎉 あなたの勝ち！'
        : result === 'draw'
          ? '🤝 あいこ！'
          : '🤖 Hertaの勝ち！';
    await interaction.reply({
      content: `あなた: ${RPS_LABELS[player]}\nHerta: ${RPS_LABELS[bot]}\n\n**${resultLabel}**`,
    });
  },
};

export const shuffleCommand: SlashCommand = {
  definition: {
    name: 'shuffle',
    description: '入力した候補をランダムな順番に並べ替えます',
    options: [
      {
        name: 'choices',
        description: 'カンマまたは改行区切りで2〜20件の候補を入力',
        type: 'string',
        required: true,
      },
    ],
  },
  async execute(interaction) {
    const choices = parseChoices(interaction.options.getString('choices', true));
    if (choices.length < 2 || choices.length > MAX_CHOICES) {
      await interaction.reply({
        content: '候補を2〜20件入力してください。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (choices.some((choice) => choice.length > 200)) {
      await interaction.reply({
        content: 'shuffleの各候補は200文字以内で入力してください。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const shuffled = shuffleChoices(choices);
    const description = formatShuffleDescription(shuffled);
    if (description.length > EMBED_DESCRIPTION_LIMIT) {
      await interaction.reply({
        content: '候補全体が長すぎます。候補数または各候補の文字数を減らしてください。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('🔀 Shuffle Result')
          .setDescription(description)
          .setColor(0x7c6df2),
      ],
    });
  },
};

export const rateCommand: SlashCommand = {
  definition: {
    name: 'rate',
    description: 'お題を0〜100%でHertaが採点します',
    options: [
      {
        name: 'subject',
        description: '採点するお題',
        type: 'string',
        required: true,
      },
    ],
  },
  async execute(interaction) {
    const subject = interaction.options.getString('subject', true).trim();
    if (!subject || subject.length > 200) {
      await interaction.reply({
        content: 'お題は1〜200文字で入力してください。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const score = deterministicRate(subject, interaction.user.id);
    const meter = '█'.repeat(Math.round(score / 10)) + '░'.repeat(10 - Math.round(score / 10));
    await interaction.reply({
      content: `📊 **${subject}**\n${meter} **${score}%**\n\n同じユーザー・同じお題なら結果は変わりません。`,
      allowedMentions: { parse: [] },
    });
  },
};

export const coreFunUtilityCommands: SlashCommand[] = [
  chooseCommand,
  diceCommand,
  coinflipCommand,
  randomCommand,
  eightBallCommand,
  rpsCommand,
  shuffleCommand,
  rateCommand,
];
