import { randomInt } from 'node:crypto';
import { EmbedBuilder, MessageFlags } from 'discord.js';
import type { SlashCommand } from './registry.js';

const MAX_CHOICES = 20;
const MAX_DICE_COUNT = 20;
const MAX_DICE_SIDES = 1_000;
const RANDOM_ABSOLUTE_LIMIT = 1_000_000_000;

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

export const coreFunUtilityCommands: SlashCommand[] = [
  chooseCommand,
  diceCommand,
  coinflipCommand,
  randomCommand,
];
