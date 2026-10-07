import { AttachmentBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { getPrismaClient } from '@herta/db';
import { periodStart, type CommunityActivityPeriod } from '../activity/community-activity.js';
import type { SlashCommand } from './registry.js';

const prisma = getPrismaClient();

/** 1回のエクスポートで出力する最大行数。超過時は上限で打ち切り、打ち切った旨を案内する。 */
const MAX_EXPORT_ROWS = 50_000;

const periodChoices = [
  { name: '今日', value: 'today' },
  { name: '7日間', value: '7d' },
  { name: '30日間', value: '30d' },
  { name: '全期間', value: 'all' },
];

const formatChoices = [
  { name: 'CSV', value: 'csv' },
  { name: 'JSON', value: 'json' },
];

function readPeriod(value: string | null): CommunityActivityPeriod {
  return value === 'today' || value === '30d' || value === 'all' ? value : '7d';
}

type ExportFormat = 'csv' | 'json';

function readFormat(value: string | null): ExportFormat {
  return value === 'json' ? 'json' : 'csv';
}

export interface CommunityActivityExportRow {
  userId: string;
  activityDate: string;
  metric: string;
  value: number;
}

function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(rows: readonly CommunityActivityExportRow[]): string {
  const lines = rows.map(
    (row) => `${csvField(row.userId)},${row.activityDate},${csvField(row.metric)},${row.value}`,
  );
  return ['user_id,date,metric,value', ...lines].join('\n');
}

export function toJson(rows: readonly CommunityActivityExportRow[]): string {
  return JSON.stringify(rows, null, 2);
}

export const communityActivityExportCommand: SlashCommand = {
  definition: {
    name: 'activity-export',
    description: 'コミュニティ活動データをCSV/JSONでエクスポートします（管理者のみ）',
    options: [
      {
        name: 'period',
        description: '集計期間',
        type: 'string',
        choices: periodChoices,
      },
      {
        name: 'format',
        description: '出力形式（既定: CSV）',
        type: 'string',
        choices: formatChoices,
      },
    ],
  },
  async execute(interaction) {
    if (!interaction.guildId) {
      await interaction.reply({
        content: 'サーバー内でのみ利用できます。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const hasPermission =
      interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
    if (!hasPermission) {
      await interaction.reply({
        content: 'このコマンドは「サーバーの管理」権限を持つユーザーだけが利用できます。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const period = readPeriod(interaction.options.getString('period'));
    const format = readFormat(interaction.options.getString('format'));

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const rows = await prisma.communityActivityDaily.findMany({
      where: { guildId: interaction.guildId, activityDate: { gte: periodStart(period) } },
      orderBy: [{ activityDate: 'asc' }, { userId: 'asc' }, { metric: 'asc' }],
      take: MAX_EXPORT_ROWS,
      select: { userId: true, activityDate: true, metric: true, value: true },
    });

    if (rows.length === 0) {
      await interaction.followUp({
        content: 'この期間のデータはありません。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const exportRows: CommunityActivityExportRow[] = rows.map((row) => ({
      userId: row.userId,
      activityDate: row.activityDate.toISOString().slice(0, 10),
      metric: row.metric,
      value: Number(row.value),
    }));

    const content = format === 'csv' ? toCsv(exportRows) : toJson(exportRows);
    const extension = format === 'csv' ? 'csv' : 'json';
    const attachment = new AttachmentBuilder(Buffer.from(content, 'utf-8'), {
      name: `community-activity-${interaction.guildId}-${period}.${extension}`,
    });

    const truncatedNote =
      rows.length >= MAX_EXPORT_ROWS
        ? `\n⚠️ 件数が上限（${MAX_EXPORT_ROWS.toLocaleString('ja-JP')}件）に達したため、一部のデータのみ出力しています。期間を絞って再実行してください。`
        : '';

    await interaction.followUp({
      content: `📦 ${exportRows.length.toLocaleString('ja-JP')}件のデータを出力しました。${truncatedNote}`,
      files: [attachment],
      flags: MessageFlags.Ephemeral,
    });
  },
};

export const communityActivityExportCommands = [communityActivityExportCommand];
