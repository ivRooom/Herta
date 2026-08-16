import { randomUUID } from 'node:crypto';
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { SlashCommandDefinition } from '@herta/shared';
import type { CommandHandler } from '@herta/plugin-sdk';
import { generateAmidakujiLadder, renderAmidakujiPng, type AmidakujiLadder } from './mini-games-amidakuji-core.js';

const PREFIX = 'herta:amidakuji:v1:';
const sessions = new Map<string, AmidakujiSession>();

interface AmidakujiSession {
  id: string;
  guildId: string;
  memberCount: number;
  allowDuplicate: boolean;
  ladder: AmidakujiLadder;
  selections: Map<string, { userId: string; displayName: string; slot: number }>;
  expiresAt: number;
  processing: boolean;
  timer?: NodeJS.Timeout;
  editReply(payload: Parameters<ChatInputCommandInteraction['editReply']>[0]): ReturnType<ChatInputCommandInteraction['editReply']>;
}

export interface AmidakujiRuntimeConfig {
  enabled: boolean;
  sessionTimeoutSeconds: number;
}

export function createAmidakujiCommandHandler(
  definition: SlashCommandDefinition,
  config: () => AmidakujiRuntimeConfig,
): CommandHandler<ChatInputCommandInteraction> {
  return {
    definition,
    async execute(interaction) {
      await startAmidakuji(interaction, config());
    },
  };
}

export async function handleAmidakujiButton(
  interaction: ButtonInteraction,
  config: AmidakujiRuntimeConfig,
): Promise<boolean> {
  const parsed = parseCustomId(interaction.customId);
  if (!parsed) return false;
  const session = sessions.get(parsed.sessionId);
  if (!session || Date.now() >= session.expiresAt) {
    if (session) endSession(session);
    await interaction.reply({
      content: 'このあみだくじは終了しています。',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }
  if (interaction.guildId !== session.guildId) {
    await interaction.reply({ content: '別サーバーのあみだくじは操作できません。', flags: MessageFlags.Ephemeral });
    return true;
  }
  if (!config.enabled) {
    endSession(session);
    await interaction.update({ content: 'Mini Games Pluginが無効になったため、あみだくじを終了しました。', components: [], attachments: [] });
    return true;
  }
  if (session.processing) {
    await interaction.reply({ content: '前の選択を処理中です。', flags: MessageFlags.Ephemeral });
    return true;
  }
  if (parsed.slot < 0 || parsed.slot >= session.memberCount) {
    await interaction.reply({ content: '不正な選択肢です。', flags: MessageFlags.Ephemeral });
    return true;
  }

  session.processing = true;
  try {
    const occupiedByOther = [...session.selections.values()].some(
      (selection) => selection.userId !== interaction.user.id && selection.slot === parsed.slot,
    );
    if (!session.allowDuplicate && occupiedByOther) {
      await interaction.reply({ content: 'その場所はすでに他のメンバーが選択しています。', flags: MessageFlags.Ephemeral });
      return true;
    }

    session.selections.set(interaction.user.id, {
      userId: interaction.user.id,
      displayName: interaction.member && 'displayName' in interaction.member
        ? String(interaction.member.displayName).slice(0, 32)
        : interaction.user.globalName?.slice(0, 32) ?? interaction.user.username.slice(0, 32),
      slot: parsed.slot,
    });

    if (session.selections.size >= session.memberCount) {
      endSession(session);
      const image = new AttachmentBuilder(renderAmidakujiPng(session.ladder, false), {
        name: `amidakuji-${session.id}-result.png`,
      });
      await interaction.update({
        content: renderResult(session),
        components: [],
        attachments: [],
        files: [image],
        allowedMentions: { parse: [] },
      });
      return true;
    }

    await interaction.update({
      content: renderWaiting(session),
      components: buildRows(session),
      allowedMentions: { parse: [] },
    });
    return true;
  } finally {
    if (sessions.get(session.id) === session) session.processing = false;
  }
}

export function clearAmidakujiGuildSessions(guildId: string): void {
  for (const session of sessions.values()) {
    if (session.guildId === guildId) endSession(session);
  }
}

async function startAmidakuji(
  interaction: ChatInputCommandInteraction,
  config: AmidakujiRuntimeConfig,
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({ content: 'このコマンドはDiscordサーバー内でのみ利用できます。', flags: MessageFlags.Ephemeral });
    return;
  }
  if (!config.enabled) {
    await interaction.reply({ content: 'Mini Games Pluginは現在無効です。', flags: MessageFlags.Ephemeral });
    return;
  }
  const memberCount = interaction.options.getInteger('members', true);
  const allowDuplicate = interaction.options.getBoolean('allow_duplicate') ?? false;
  if (!Number.isInteger(memberCount) || memberCount < 2 || memberCount > 10) {
    await interaction.reply({ content: 'メンバー数は2〜10人で指定してください。', flags: MessageFlags.Ephemeral });
    return;
  }

  const sessionId = randomUUID().replaceAll('-', '');
  const ladder = generateAmidakujiLadder(memberCount);
  const timeoutSeconds = Math.max(30, Math.min(300, config.sessionTimeoutSeconds));
  const session: AmidakujiSession = {
    id: sessionId,
    guildId: interaction.guildId,
    memberCount,
    allowDuplicate,
    ladder,
    selections: new Map(),
    expiresAt: Date.now() + timeoutSeconds * 1000,
    processing: false,
    editReply: (payload) => interaction.editReply(payload),
  };
  sessions.set(sessionId, session);
  session.timer = setTimeout(() => {
    if (sessions.get(session.id) !== session) return;
    endSession(session);
    void session.editReply({
      content: `${renderWaiting(session)}\n\n⌛ **時間切れで終了しました。**`,
      components: [],
      allowedMentions: { parse: [] },
    }).catch(() => undefined);
  }, timeoutSeconds * 1000);
  session.timer.unref?.();

  const hiddenImage = new AttachmentBuilder(renderAmidakujiPng(ladder, true), {
    name: `amidakuji-${sessionId}-hidden.png`,
  });
  await interaction.reply({
    content: renderWaiting(session),
    components: buildRows(session),
    files: [hiddenImage],
    allowedMentions: { parse: [] },
  });
}

function buildRows(session: AmidakujiSession): ActionRowBuilder<ButtonBuilder>[] {
  const occupied = new Set([...session.selections.values()].map((selection) => selection.slot));
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let offset = 0; offset < session.memberCount; offset += 5) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (let slot = offset; slot < Math.min(session.memberCount, offset + 5); slot += 1) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`${PREFIX}${session.id}:${slot}`)
          .setLabel(`${slot + 1}`)
          .setStyle(occupied.has(slot) ? ButtonStyle.Secondary : ButtonStyle.Primary)
          .setDisabled(!session.allowDuplicate && occupied.has(slot)),
      );
    }
    rows.push(row);
  }
  return rows;
}

function renderWaiting(session: AmidakujiSession): string {
  const selections = [...session.selections.values()]
    .sort((a, b) => a.slot - b.slot || a.userId.localeCompare(b.userId))
    .map((selection) => `• ${selection.displayName}: **${selection.slot + 1}番**`);
  return [
    '🪜 **あみだくじ**',
    `参加人数: **${session.memberCount}人** · 同じ場所: **${session.allowDuplicate ? '選択可' : '選択不可'}**`,
    '中央の経路はまだ隠れています。下のButtonから開始位置を選んでください。',
    `選択済み: **${session.selections.size}/${session.memberCount}人**`,
    ...(selections.length ? ['', ...selections] : []),
  ].join('\n');
}

function renderResult(session: AmidakujiSession): string {
  const lines = [...session.selections.values()]
    .sort((a, b) => a.slot - b.slot || a.userId.localeCompare(b.userId))
    .map((selection) => {
      const result = session.ladder.results[selection.slot] ?? selection.slot;
      return `• ${selection.displayName}: **${selection.slot + 1}番 → 結果 ${result + 1}番**`;
    });
  return ['🪜 **あみだくじ結果**', '隠れていた経路を公開しました！', '', ...lines].join('\n');
}

function parseCustomId(customId: string): { sessionId: string; slot: number } | null {
  if (!customId.startsWith(PREFIX)) return null;
  const [sessionId, rawSlot, extra] = customId.slice(PREFIX.length).split(':');
  if (extra !== undefined || !sessionId || !/^[0-9a-f]{32}$/i.test(sessionId)) return null;
  const slot = Number(rawSlot);
  if (!Number.isInteger(slot)) return null;
  return { sessionId, slot };
}

function endSession(session: AmidakujiSession): void {
  if (session.timer) clearTimeout(session.timer);
  sessions.delete(session.id);
}
