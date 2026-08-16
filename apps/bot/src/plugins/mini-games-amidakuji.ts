import { randomUUID } from 'node:crypto';
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { CommandHandler } from '@herta/plugin-sdk';
import {
  generateAmidakujiLadder,
  parseAmidakujiResultLabels,
  renderAmidakujiPng,
  type AmidakujiComplexity,
  type AmidakujiLadder,
  type AmidakujiTheme,
} from './mini-games-amidakuji-core.js';

const PREFIX = 'herta:amidakuji:v1:';
const sessions = new Map<string, AmidakujiSession>();

interface AmidakujiSession {
  id: string;
  guildId: string;
  memberCount: number;
  allowDuplicate: boolean;
  resultLabels: string[];
  ladder: AmidakujiLadder;
  selections: Map<string, { userId: string; displayName: string; slot: number }>;
  expiresAt: number;
  processing: boolean;
  visual: AmidakujiVisualConfig;
}

interface AmidakujiVisualConfig {
  complexity: AmidakujiComplexity;
  theme: AmidakujiTheme;
  hiddenPercent: number;
  revealAnimation: boolean;
  revealDelayMs: number;
  highlightPaths: boolean;
}

export interface AmidakujiRuntimeConfig extends AmidakujiVisualConfig {
  enabled: boolean;
  sessionTimeoutSeconds: number;
}

export function createAmidakujiCommandHandler(
  definition: CommandHandler<ChatInputCommandInteraction>['definition'],
  config: () => AmidakujiRuntimeConfig,
): CommandHandler<ChatInputCommandInteraction> {
  return {
    definition,
    async execute(interaction) {
      await startAmidakuji(interaction, config);
    },
  };
}

export function clearAmidakujiGuildSessions(guildId: string): void {
  for (const session of sessions.values()) {
    if (session.guildId === guildId) sessions.delete(session.id);
  }
}

async function startAmidakuji(
  interaction: ChatInputCommandInteraction,
  configProvider: () => AmidakujiRuntimeConfig,
): Promise<void> {
  const config = configProvider();
  if (!interaction.guildId) {
    await interaction.reply({
      content: 'このコマンドはDiscordサーバー内でのみ利用できます。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (!config.enabled) {
    await interaction.reply({
      content: 'Mini Games Pluginは現在無効です。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const memberCount = interaction.options.getInteger('members', true);
  const allowDuplicate = interaction.options.getBoolean('allow_duplicate') ?? false;
  if (!Number.isInteger(memberCount) || memberCount < 2 || memberCount > 10) {
    await interaction.reply({
      content: 'メンバー数は2〜10人で指定してください。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const resultLabels = parseAmidakujiResultLabels(
    interaction.options.getString('results'),
    memberCount,
  );
  if (!resultLabels) {
    await interaction.reply({
      content:
        'resultsは参加人数と同じ件数を、カンマ・読点・改行のいずれかで区切って指定してください。各結果は50文字以内です。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const sessionId = randomUUID().replaceAll('-', '');
  const visual: AmidakujiVisualConfig = {
    complexity: config.complexity,
    theme: config.theme,
    hiddenPercent: config.hiddenPercent,
    revealAnimation: config.revealAnimation,
    revealDelayMs: config.revealDelayMs,
    highlightPaths: config.highlightPaths,
  };
  const ladder = generateAmidakujiLadder(memberCount, { complexity: visual.complexity });
  const timeoutSeconds = Math.max(30, Math.min(300, config.sessionTimeoutSeconds));
  const session: AmidakujiSession = {
    id: sessionId,
    guildId: interaction.guildId,
    memberCount,
    allowDuplicate,
    resultLabels,
    ladder,
    selections: new Map(),
    expiresAt: Date.now() + timeoutSeconds * 1000,
    processing: false,
    visual,
  };
  sessions.set(sessionId, session);

  const hiddenImage = new AttachmentBuilder(
    renderAmidakujiPng(ladder, {
      hidden: true,
      hiddenPercent: visual.hiddenPercent,
      theme: visual.theme,
    }),
    { name: `amidakuji-${sessionId}-hidden.png` },
  );
  await interaction.reply({
    content: renderWaiting(session),
    components: buildRows(session),
    files: [hiddenImage],
    allowedMentions: { parse: [] },
  });

  const message = await interaction.fetchReply();
  const collector = message.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: timeoutSeconds * 1000,
  });
  collector.on('collect', (button) => {
    void handleButton(button, session, configProvider).then((completed) => {
      if (completed) collector.stop('completed');
    });
  });
  collector.on('end', (_collected, reason) => {
    if (reason === 'completed' || sessions.get(session.id) !== session) return;
    sessions.delete(session.id);
    void interaction
      .editReply({
        content: `${renderWaiting(session)}\n\n⌛ **時間切れで終了しました。**`,
        components: [],
        allowedMentions: { parse: [] },
      })
      .catch(() => undefined);
  });
}

async function handleButton(
  interaction: ButtonInteraction,
  session: AmidakujiSession,
  configProvider: () => AmidakujiRuntimeConfig,
): Promise<boolean> {
  const parsed = parseCustomId(interaction.customId);
  if (!parsed || parsed.sessionId !== session.id) return false;
  if (sessions.get(session.id) !== session || Date.now() >= session.expiresAt) {
    sessions.delete(session.id);
    await interaction.reply({
      content: 'このあみだくじは終了しています。',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }
  if (interaction.guildId !== session.guildId) {
    await interaction.reply({
      content: '別サーバーのあみだくじは操作できません。',
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }
  if (!configProvider().enabled) {
    sessions.delete(session.id);
    await interaction.update({
      content: 'Mini Games Pluginが無効になったため、あみだくじを終了しました。',
      components: [],
      attachments: [],
    });
    return true;
  }
  if (session.processing) {
    await interaction.reply({ content: '前の選択を処理中です。', flags: MessageFlags.Ephemeral });
    return false;
  }
  if (parsed.slot < 0 || parsed.slot >= session.memberCount) {
    await interaction.reply({ content: '不正な選択肢です。', flags: MessageFlags.Ephemeral });
    return false;
  }

  session.processing = true;
  try {
    const occupiedByOther = [...session.selections.values()].some(
      (selection) => selection.userId !== interaction.user.id && selection.slot === parsed.slot,
    );
    if (!session.allowDuplicate && occupiedByOther) {
      await interaction.reply({
        content: 'その場所はすでに他のメンバーが選択しています。',
        flags: MessageFlags.Ephemeral,
      });
      return false;
    }

    session.selections.set(interaction.user.id, {
      userId: interaction.user.id,
      displayName:
        interaction.member && 'displayName' in interaction.member
          ? String(interaction.member.displayName).slice(0, 32)
          : (interaction.user.globalName?.slice(0, 32) ?? interaction.user.username.slice(0, 32)),
      slot: parsed.slot,
    });

    if (session.selections.size >= session.memberCount) {
      sessions.delete(session.id);
      await revealResult(interaction, session);
      return true;
    }

    await interaction.update({
      content: renderWaiting(session),
      components: buildRows(session),
      allowedMentions: { parse: [] },
    });
    return false;
  } finally {
    if (sessions.get(session.id) === session) session.processing = false;
  }
}

async function revealResult(
  interaction: ButtonInteraction,
  session: AmidakujiSession,
): Promise<void> {
  const starts = session.visual.highlightPaths
    ? [...new Set([...session.selections.values()].map((selection) => selection.slot))]
    : [];

  if (session.visual.revealAnimation) {
    const halfway = new AttachmentBuilder(
      renderAmidakujiPng(session.ladder, {
        hidden: true,
        hiddenPercent: session.visual.hiddenPercent,
        revealProgress: 0.58,
        theme: session.visual.theme,
      }),
      { name: `amidakuji-${session.id}-reveal.png` },
    );
    await interaction.update({
      content: '🪜 **あみだくじ**\n✨ 全員の選択が完了しました。経路を解析しています…',
      components: [],
      attachments: [],
      files: [halfway],
      allowedMentions: { parse: [] },
    });
    await delay(session.visual.revealDelayMs);
  } else {
    await interaction.deferUpdate();
  }

  const finalImage = new AttachmentBuilder(
    renderAmidakujiPng(session.ladder, {
      hidden: false,
      theme: session.visual.theme,
      highlightStarts: starts,
    }),
    { name: `amidakuji-${session.id}-result.png` },
  );
  await interaction.editReply({
    content: renderResult(session),
    components: [],
    attachments: [],
    files: [finalImage],
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
  const complexityLabel =
    session.visual.complexity === 'chaos'
      ? 'カオス'
      : session.visual.complexity === 'simple'
        ? 'シンプル'
        : '標準';
  return [
    '🪜 **あみだくじ**',
    `参加人数: **${session.memberCount}人** · 同じ場所: **${session.allowDuplicate ? '選択可' : '選択不可'}** · 複雑度: **${complexityLabel}**`,
    `結果候補: ${session.resultLabels.map((label, index) => `**${index + 1}. ${label}**`).join(' / ')}`,
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
      const resultLabel = session.resultLabels[result] ?? `${result + 1}番`;
      return `• ${selection.displayName}: **${selection.slot + 1}番 → ${resultLabel}**`;
    });
  return [
    '🎊 **あみだくじ結果**',
    session.visual.highlightPaths
      ? '隠れていた経路を公開しました。画像では選択ルートを色分けしています！'
      : '隠れていた経路を公開しました！',
    '',
    ...lines,
  ].join('\n');
}

export function parseAmidakujiCustomId(
  customId: string,
): { sessionId: string; slot: number } | null {
  return parseCustomId(customId);
}

function parseCustomId(customId: string): { sessionId: string; slot: number } | null {
  if (!customId.startsWith(PREFIX)) return null;
  const [sessionId, rawSlot, extra] = customId.slice(PREFIX.length).split(':');
  if (extra !== undefined || !sessionId || !/^[0-9a-f]{32}$/i.test(sessionId)) return null;
  const slot = Number(rawSlot);
  if (!Number.isInteger(slot)) return null;
  return { sessionId, slot };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}
