import { createHmac, randomUUID } from 'node:crypto';
import type { PrismaClient } from '@herta/db';
import { decoGachaManifest } from '@herta/plugin-catalog';
import { definePlugin, type CommandHandler } from '@herta/plugin-sdk';
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  type APIActionRowComponent,
  type APIButtonComponent,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { fetchDecoCardImage, renderDecoProfileCard } from './deco-gacha-card.js';

/**
 * Deco Gacha (#1002, ivrm-web Epic #1837 S4): デコガチャの
 * Discord 側プラグイン。おみくじコマンドとプロフィールカード。
 *
 * 判定の正本は ivrm-web の Deco Gacha Bot API (S4 で追加した
 * /gacha/bot/*) で、このプラグインは抽選も残高も持たない:
 * - おみくじは API の executeOmikujiDraw (Member Web と同じ
 *   コア) が日次冪等つきで実行する。Discord と Web で同じ日に
 *   二重には引けない
 * - API が失敗・未設定の間は fail-closed (報酬は付与されず、
 *   エラー文面だけを返す)
 * - 署名形式は submission-review と同じ
 *   (`${timestamp}.${eventId}.POST.${pathname}.${body}` の
 *   HMAC-SHA256)。シークレットは専用の HERTA_DECO_BOT_SECRET
 *   で、review / minecraft 用とは分離する
 *
 * ガチャ自体 (プル) は Web 専用。ここでは結果シェアの導線として
 * おみくじ結果の「チャンネルにシェア」ボタンと、カードの公開
 * 表示を用意する (自動投稿はしない)。
 */

const FETCH_TIMEOUT_MS = 5_000;
const EPHEMERAL_FLAG = 64;
const MEMBER_GACHA_URL = 'https://member.ivrm.jp/gacha';
export const DECO_GACHA_SHARE_PREFIX = 'dg:omikuji-share:';

export const DECO_GACHA_UNAVAILABLE_MESSAGE =
  'デコガチャのBot連携は現在有効化されていません（運営側の設定待ちです）。Web版はこちら: https://member.ivrm.jp/gacha';

// ---------------------------------------------------------------------------
// Config (Studio プラグイン設定が正本)
// ---------------------------------------------------------------------------

export interface DecoGachaConfig {
  enabled: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeDecoGachaConfig(value: unknown): DecoGachaConfig {
  const source = isRecord(value) ? value : {};
  return { enabled: source.enabled === undefined ? true : source.enabled === true };
}

// ---------------------------------------------------------------------------
// 運勢表示 (キーは ivrm-web deco-gacha-core の OMIKUJI_OUTCOMES が正本)
// ---------------------------------------------------------------------------

export const DECO_FORTUNES = {
  daikichi: { label: '大吉', color: 0xf5c542 },
  kichi: { label: '吉', color: 0x57f287 },
  chukichi: { label: '中吉', color: 0x5865f2 },
  shokichi: { label: '小吉', color: 0x9b8cf2 },
  suekichi: { label: '末吉', color: 0x95a5a6 },
} as const;

export type DecoFortuneKey = keyof typeof DECO_FORTUNES;

export function decoFortuneLabel(key: string | null): string | null {
  if (!key || !(key in DECO_FORTUNES)) return null;
  return DECO_FORTUNES[key as DecoFortuneKey].label;
}

export function decoFortuneColor(key: string | null): number {
  if (!key || !(key in DECO_FORTUNES)) return 0x5865f2;
  return DECO_FORTUNES[key as DecoFortuneKey].color;
}

export function decoFortuneColorHex(key: string | null): string {
  return `#${decoFortuneColor(key).toString(16).padStart(6, '0')}`;
}

// ---------------------------------------------------------------------------
// Deco Gacha Bot API クライアント (submission-review と同型の HMAC 署名)
// ---------------------------------------------------------------------------

export interface DecoGachaApiConfig {
  apiBaseUrl: string;
  // ivrm-web の HERTA_DECO_BOT_SECRET と対になる HMAC 共有鍵
  secret: string;
}

/** IVRM_WEB_API_BASE_URL / HERTA_DECO_BOT_SECRET が揃わない場合は null (機能は不活性) */
export function resolveDecoGachaApiConfig(
  env: Partial<Record<string, string | undefined>>,
): DecoGachaApiConfig | null {
  const rawUrl = env['IVRM_WEB_API_BASE_URL']?.trim();
  const secret = env['HERTA_DECO_BOT_SECRET']?.trim();
  if (!rawUrl || !secret) return null;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' && url.hostname !== 'localhost') return null;
    return { apiBaseUrl: rawUrl.replace(/\/+$/, ''), secret };
  } catch {
    return null;
  }
}

export interface DecoGachaApiRequest {
  url: string;
  init: { method: 'POST'; headers: Record<string, string>; body: string };
}

/**
 * ivrm-web 側 herta-deco-service-auth.ts と同じ署名形式で signed
 * request を構築する。ネットワークI/Oを含まないため単体テストで
 * 検証できる。
 */
export function buildDecoGachaApiRequest(
  config: DecoGachaApiConfig,
  path: string,
  fields: Record<string, unknown>,
  options: { timestamp?: string; eventId?: string } = {},
): DecoGachaApiRequest {
  const timestamp = options.timestamp ?? String(Date.now());
  const eventId = options.eventId ?? `dg-${randomUUID()}`;
  const body = JSON.stringify(fields);
  const signature = createHmac('sha256', config.secret)
    .update(`${timestamp}.${eventId}.POST.${path}.${body}`)
    .digest('hex');
  return {
    url: `${config.apiBaseUrl}${path}`,
    init: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-IVRM-Timestamp': timestamp,
        'X-IVRM-Event-Id': eventId,
        'X-IVRM-Signature': signature,
      },
      body,
    },
  };
}

export interface DecoGachaApiResult {
  ok: boolean;
  status: number;
  data: Record<string, unknown> | null;
}

async function callDecoGachaApi(
  config: DecoGachaApiConfig,
  path: string,
  fields: Record<string, unknown>,
): Promise<DecoGachaApiResult> {
  const request = buildDecoGachaApiRequest(config, path, fields);
  try {
    const response = await fetch(request.url, {
      ...request.init,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    return { ok: response.ok, status: response.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

function apiString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function apiNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Bot API のエラーコードを Discord 向けの文面にする */
export function formatDecoGachaApiError(result: DecoGachaApiResult): string {
  const code = result.data ? apiString(result.data['code']) : null;
  switch (code) {
    case 'bot_api_disabled':
      return DECO_GACHA_UNAVAILABLE_MESSAGE;
    case 'user_not_registered':
      return 'あなたの ivRooom アカウントが見つかりませんでした。先に Web ポータルで登録してください: https://member.ivrm.jp';
    case 'target_not_registered':
      return 'そのメンバーの ivRooom アカウントが見つかりませんでした。';
    case 'omikuji_disabled':
      return 'おみくじは現在公開準備中です。もうしばらくお待ちください。';
    case 'deco_disabled':
      return 'デコガチャは現在公開準備中です。もうしばらくお待ちください。';
    default:
      break;
  }
  if (result.status === 0) {
    return '連携APIへ接続できませんでした。時間を置いて再度お試しください。';
  }
  if (code && code.endsWith('_unavailable')) {
    return 'サーバー側で処理できませんでした。時間を置いて再度お試しください。';
  }
  return `エラーが発生しました（${code ?? `HTTP ${result.status}`}）。時間を置いて再度お試しください。`;
}

// ---------------------------------------------------------------------------
// API ペイロードのパース (形が崩れていたら null = fail-closed)
// ---------------------------------------------------------------------------

export interface DecoOmikujiResult {
  alreadyDrawn: boolean;
  dateJst: string;
  fortune: string;
  shardsAwarded: number;
  ticketAwarded: boolean;
  limitedItemId: string | null;
}

export function parseDecoOmikujiDraw(
  data: Record<string, unknown> | null,
): DecoOmikujiResult | null {
  if (!data || data['status'] !== 'ok') return null;
  const fortune = apiString(data['fortune']);
  const dateJst = apiString(data['dateJst']);
  const shardsAwarded = apiNumber(data['shardsAwarded']);
  if (!fortune || !decoFortuneLabel(fortune) || !dateJst || shardsAwarded === null) return null;
  return {
    alreadyDrawn: data['alreadyDrawn'] === true,
    dateJst,
    fortune,
    shardsAwarded,
    ticketAwarded: data['ticketAwarded'] === true,
    limitedItemId: apiString(data['limitedItemId']),
  };
}

export interface DecoOmikujiStatus {
  dateJst: string;
  drawnToday: boolean;
  today: {
    fortune: string;
    shardsAwarded: number;
    ticketAwarded: boolean;
    limitedItemId: string | null;
  } | null;
}

export function parseDecoOmikujiStatus(
  data: Record<string, unknown> | null,
): DecoOmikujiStatus | null {
  if (!data || data['status'] !== 'ok') return null;
  const dateJst = apiString(data['dateJst']);
  if (!dateJst) return null;
  const todayRaw = isRecord(data['today']) ? data['today'] : null;
  let today: DecoOmikujiStatus['today'] = null;
  if (todayRaw) {
    const fortune = apiString(todayRaw['fortune']);
    const shardsAwarded = apiNumber(todayRaw['shardsAwarded']);
    if (!fortune || !decoFortuneLabel(fortune) || shardsAwarded === null) return null;
    today = {
      fortune,
      shardsAwarded,
      ticketAwarded: todayRaw['ticketAwarded'] === true,
      limitedItemId: apiString(todayRaw['limitedItemId']),
    };
  }
  return { dateJst, drawnToday: data['drawnToday'] === true && today !== null, today };
}

export interface DecoProfileItem {
  id: string;
  kind: string;
  rarity: string;
  name: string;
  imageUrl: string | null;
}

export type DecoEquipmentSlot = 'frame' | 'title' | 'cover' | 'theme' | 'card_skin';

export interface DecoProfileData {
  discordUserId: string;
  equipment: Record<DecoEquipmentSlot, DecoProfileItem | null>;
  fortuneToday: string | null;
}

const DECO_EQUIPMENT_SLOTS: DecoEquipmentSlot[] = ['frame', 'title', 'cover', 'theme', 'card_skin'];

export function parseDecoProfile(data: Record<string, unknown> | null): DecoProfileData | null {
  if (!data || data['status'] !== 'ok') return null;
  const discordUserId = apiString(data['discordUserId']);
  if (!discordUserId) return null;
  const rawEquipment = isRecord(data['equipment']) ? data['equipment'] : {};
  const equipment = {} as Record<DecoEquipmentSlot, DecoProfileItem | null>;
  for (const slot of DECO_EQUIPMENT_SLOTS) {
    const raw = rawEquipment[slot];
    if (!isRecord(raw)) {
      equipment[slot] = null;
      continue;
    }
    const id = apiString(raw['id']);
    const name = apiString(raw['name']);
    if (!id || !name) return null;
    equipment[slot] = {
      id,
      kind: apiString(raw['kind']) ?? slot,
      rarity: apiString(raw['rarity']) ?? '',
      name,
      imageUrl: apiString(raw['imageUrl']),
    };
  }
  const fortuneToday = apiString(data['fortuneToday']);
  return {
    discordUserId,
    equipment,
    fortuneToday: fortuneToday && decoFortuneLabel(fortuneToday) ? fortuneToday : null,
  };
}

// ---------------------------------------------------------------------------
// おみくじ結果の表示とシェア導線
// ---------------------------------------------------------------------------

export function buildDecoOmikujiShareCustomId(userId: string, dateJst: string): string {
  return `${DECO_GACHA_SHARE_PREFIX}${userId}:${dateJst}`;
}

export function parseDecoOmikujiShareCustomId(
  customId: string,
): { userId: string; dateJst: string } | null {
  if (!customId.startsWith(DECO_GACHA_SHARE_PREFIX)) return null;
  const rest = customId.slice(DECO_GACHA_SHARE_PREFIX.length);
  const [userId = '', dateJst = ''] = rest.split(':');
  if (!/^\d{17,20}$/.test(userId) || !/^\d{4}-\d{2}-\d{2}$/.test(dateJst)) return null;
  return { userId, dateJst };
}

export function buildDecoOmikujiShareRow(
  userId: string,
  dateJst: string,
): APIActionRowComponent<APIButtonComponent> {
  return new ActionRowBuilder<ButtonBuilder>()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(buildDecoOmikujiShareCustomId(userId, dateJst))
        .setLabel('チャンネルにシェアする')
        .setEmoji('📣')
        .setStyle(ButtonStyle.Secondary),
    )
    .toJSON();
}

export function buildDecoOmikujiEmbed(result: DecoOmikujiResult): EmbedBuilder {
  const label = decoFortuneLabel(result.fortune) ?? result.fortune;
  const rewards = [`きらめき欠片 +${result.shardsAwarded}`];
  if (result.ticketAwarded) rewards.push('ガチャチケット +1');
  if (result.limitedItemId) rewards.push('おみくじ限定称号を獲得！');
  const embed = new EmbedBuilder()
    .setTitle('🎋 ヘルタおみくじ')
    .setColor(decoFortuneColor(result.fortune))
    .addFields(
      { name: '今日の運勢', value: `**${label}**` },
      { name: '報酬', value: rewards.join('\n') },
    )
    .setFooter({ text: `${result.dateJst} のおみくじ · 判定はWeb版と共通です` });
  if (result.alreadyDrawn) {
    embed.setDescription('今日はもう引いています。結果はこちらです。');
  }
  return embed;
}

export function buildDecoOmikujiShareText(
  displayName: string,
  status: DecoOmikujiStatus,
): string | null {
  if (!status.today) return null;
  const label = decoFortuneLabel(status.today.fortune) ?? status.today.fortune;
  const rewards = [`きらめき欠片 +${status.today.shardsAwarded}`];
  if (status.today.ticketAwarded) rewards.push('ガチャチケット +1');
  if (status.today.limitedItemId) rewards.push('おみくじ限定称号を獲得！');
  return [
    `🎋 **${displayName}** の今日のおみくじは **${label}** でした！`,
    `報酬: ${rewards.join(' / ')}`,
    `おみくじは1日1回 · Web版でも引けます: ${MEMBER_GACHA_URL}`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// コマンド実行
// ---------------------------------------------------------------------------

const inFlight = new Set<string>();

type DecoContext = {
  config: DecoGachaConfig;
  guildId: string;
  logger: { error: (obj: unknown, msg: string) => void };
};

async function executeOmikujiCommand(
  context: DecoContext,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const api = resolveDecoGachaApiConfig(process.env);
  if (!api) {
    await interaction.reply({
      content: DECO_GACHA_UNAVAILABLE_MESSAGE,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const key = `${context.guildId}:${interaction.user.id}`;
  if (inFlight.has(key)) {
    await interaction.reply({
      content: '前のおみくじ処理が終わってから、もう一度お試しください。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  inFlight.add(key);
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await callDecoGachaApi(api, '/gacha/bot/omikuji/draw', {
      discordUserId: interaction.user.id,
      guildId: context.guildId,
    });
    if (!result.ok) {
      await interaction.editReply(formatDecoGachaApiError(result));
      return;
    }
    const parsed = parseDecoOmikujiDraw(result.data);
    if (!parsed) {
      await interaction.editReply(
        'おみくじの結果を取得できませんでした。時間を置いて再度お試しください。',
      );
      return;
    }
    await interaction.editReply({
      embeds: [buildDecoOmikujiEmbed(parsed)],
      components: [buildDecoOmikujiShareRow(interaction.user.id, parsed.dateJst)],
    });
  } catch (error) {
    context.logger.error(
      { error: error instanceof Error ? error.name : 'UnknownError' },
      'Deco omikuji command failed',
    );
    await interaction
      .editReply('おみくじを引けませんでした。少し待ってからお試しください。')
      .catch(() => undefined);
  } finally {
    inFlight.delete(key);
  }
}

async function executeDecoCardCommand(
  context: DecoContext,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const api = resolveDecoGachaApiConfig(process.env);
  if (!api) {
    await interaction.reply({
      content: DECO_GACHA_UNAVAILABLE_MESSAGE,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const target = interaction.options.getUser('user') ?? interaction.user;
  const isPublic = interaction.options.getBoolean('public') === true;
  try {
    await interaction.deferReply({ flags: isPublic ? undefined : MessageFlags.Ephemeral });
    const result = await callDecoGachaApi(api, '/gacha/bot/profile', {
      discordUserId: interaction.user.id,
      guildId: context.guildId,
      ...(target.id !== interaction.user.id ? { targetDiscordUserId: target.id } : {}),
    });
    if (!result.ok) {
      await interaction.editReply(formatDecoGachaApiError(result));
      return;
    }
    const profile = parseDecoProfile(result.data);
    if (!profile) {
      await interaction.editReply(
        'プロフィール情報を取得できませんでした。時間を置いて再度お試しください。',
      );
      return;
    }
    const [avatarBytes, coverBytes, skinBytes, frameBytes] = await Promise.all([
      fetchDecoCardImage(target.displayAvatarURL({ extension: 'png', size: 512 })),
      fetchDecoCardImage(profile.equipment.cover?.imageUrl ?? null),
      fetchDecoCardImage(profile.equipment.card_skin?.imageUrl ?? null),
      fetchDecoCardImage(profile.equipment.frame?.imageUrl ?? null),
    ]);
    const card = await renderDecoProfileCard({
      displayName: target.displayName,
      avatarBytes,
      coverBytes,
      skinBytes,
      frameBytes,
      titleName: profile.equipment.title?.name ?? null,
      fortuneLabel: decoFortuneLabel(profile.fortuneToday),
      fortuneColor: profile.fortuneToday ? decoFortuneColorHex(profile.fortuneToday) : null,
    });
    const summary = [`🃏 **${target.displayName}** のプロフィールカード`];
    if (profile.equipment.title) summary.push(`称号: ${profile.equipment.title.name}`);
    const fortuneLabel = decoFortuneLabel(profile.fortuneToday);
    if (fortuneLabel) summary.push(`今日の運勢: ${fortuneLabel}`);
    await interaction.editReply({
      content: summary.join('\n'),
      files: [new AttachmentBuilder(card, { name: 'deco-profile-card.png' })],
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    context.logger.error(
      { error: error instanceof Error ? error.name : 'UnknownError' },
      'Deco profile card command failed',
    );
    await interaction
      .editReply('プロフィールカードを作成できませんでした。少し待ってからお試しください。')
      .catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// シェアボタンの処理 (本人だけが自分の結果を公開できる)
// ---------------------------------------------------------------------------

interface DecoShareInteraction {
  customId: string;
  guildId: string | null;
  user: { id: string; username: string; displayName?: string };
  isButton(): boolean;
  reply(options: { content: string; flags?: number }): Promise<unknown>;
  deferReply(options?: { flags?: number }): Promise<unknown>;
  editReply(content: string): Promise<unknown>;
}

export async function handleDecoOmikujiShare(
  context: DecoContext,
  interaction: DecoShareInteraction,
): Promise<void> {
  const parsed = parseDecoOmikujiShareCustomId(interaction.customId);
  if (!parsed || !interaction.isButton()) return;
  if (interaction.user.id !== parsed.userId) {
    await interaction.reply({
      content: 'シェアできるのは自分の今日のおみくじ結果だけです。',
      flags: EPHEMERAL_FLAG,
    });
    return;
  }
  const api = resolveDecoGachaApiConfig(process.env);
  if (!api) {
    await interaction.reply({
      content: DECO_GACHA_UNAVAILABLE_MESSAGE,
      flags: EPHEMERAL_FLAG,
    });
    return;
  }
  // 公開投稿として defer し、結果をそのままチャンネルへ出す
  await interaction.deferReply();
  const result = await callDecoGachaApi(api, '/gacha/bot/omikuji/status', {
    discordUserId: interaction.user.id,
    guildId: context.guildId,
  });
  if (!result.ok) {
    await interaction.editReply(formatDecoGachaApiError(result));
    return;
  }
  const status = parseDecoOmikujiStatus(result.data);
  if (!status || !status.drawnToday || status.dateJst !== parsed.dateJst) {
    await interaction.editReply(
      'シェアできる今日のおみくじ結果が見つかりませんでした（日付が変わった可能性があります）。',
    );
    return;
  }
  const text = buildDecoOmikujiShareText(
    interaction.user.displayName ?? interaction.user.username,
    status,
  );
  if (!text) {
    await interaction.editReply('シェアできる今日のおみくじ結果が見つかりませんでした。');
    return;
  }
  await interaction.editReply(text);
}

// ---------------------------------------------------------------------------
// Plugin 定義
// ---------------------------------------------------------------------------

export const decoGachaPlugin = definePlugin<DecoGachaConfig, unknown, PrismaClient>({
  manifest: decoGachaManifest,
  provideCommands(context) {
    const omikuji: CommandHandler<ChatInputCommandInteraction> = {
      definition: decoGachaManifest.commands[0]!,
      async execute(interaction) {
        if (!interaction.guildId) {
          await interaction.reply({
            content: 'このコマンドはDiscordサーバー内でのみ利用できます。',
            flags: EPHEMERAL_FLAG,
          });
          return;
        }
        const config = normalizeDecoGachaConfig(context.config);
        if (!config.enabled) {
          await interaction.reply({
            content: 'デコガチャ連携は現在無効です。',
            flags: EPHEMERAL_FLAG,
          });
          return;
        }
        await executeOmikujiCommand(
          { config, guildId: context.guildId, logger: context.logger },
          interaction,
        );
      },
    };
    const card: CommandHandler<ChatInputCommandInteraction> = {
      definition: decoGachaManifest.commands[1]!,
      async execute(interaction) {
        if (!interaction.guildId) {
          await interaction.reply({
            content: 'このコマンドはDiscordサーバー内でのみ利用できます。',
            flags: EPHEMERAL_FLAG,
          });
          return;
        }
        const config = normalizeDecoGachaConfig(context.config);
        if (!config.enabled) {
          await interaction.reply({
            content: 'デコガチャ連携は現在無効です。',
            flags: EPHEMERAL_FLAG,
          });
          return;
        }
        await executeDecoCardCommand(
          { config, guildId: context.guildId, logger: context.logger },
          interaction,
        );
      },
    };
    return [omikuji, card];
  },
  provideEvents() {
    return [
      {
        event: 'interactionCreate',
        async handler(context, ...args) {
          const interaction = args[0] as DecoShareInteraction | undefined;
          if (!interaction || typeof interaction.customId !== 'string') return;
          if (!interaction.customId.startsWith(DECO_GACHA_SHARE_PREFIX)) return;
          if (interaction.guildId && interaction.guildId !== context.guildId) return;
          const config = normalizeDecoGachaConfig(context.config);
          if (!config.enabled) return;
          await handleDecoOmikujiShare(
            { config, guildId: context.guildId, logger: context.logger },
            interaction,
          );
        },
      },
    ];
  },
});
