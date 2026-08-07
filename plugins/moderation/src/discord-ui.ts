import type {
  AutomaticEnforcementAction,
  AutomaticEnforcementPolicy,
  AutomaticModerationSeverity,
} from './enforcement-config.js';
import type { ModerationCaseAction, ModerationCaseRecord } from './service.js';

const DISCORD_EMBED_DESCRIPTION_LIMIT = 4096;
const DISCORD_EMBED_FIELD_VALUE_LIMIT = 1024;
const DISCORD_EMBED_TITLE_LIMIT = 256;
const DISCORD_EMBED_FOOTER_LIMIT = 2048;
const DEFAULT_PUBLIC_BASE_URL = 'https://herta.ivrm.jp';

export interface DiscordEmbedFieldPayload {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbedPayload {
  title?: string;
  description?: string;
  color?: number;
  url?: string;
  fields?: DiscordEmbedFieldPayload[];
  footer?: { text: string };
  timestamp?: string;
  image?: { url: string };
}

export interface DiscordVisualMessagePayload {
  content?: string;
  embeds?: DiscordEmbedPayload[];
  allowedMentions: { parse: []; roles?: string[] };
  flags?: number;
}

export type ModerationVisualVariant =
  | 'info'
  | 'warning'
  | 'high'
  | 'critical'
  | 'failed'
  | 'case';

const VARIANT_COLORS: Record<ModerationVisualVariant, number> = {
  info: 0x6d67e4,
  warning: 0xd99a39,
  high: 0xeb683a,
  critical: 0xec425b,
  failed: 0xca459a,
  case: 0x48b3b2,
};

const SEVERITY_LABELS: Record<AutomaticModerationSeverity, string> = {
  low: 'LOW / 低',
  medium: 'MEDIUM / 中',
  high: 'HIGH / 高',
  critical: 'CRITICAL / 緊急',
};

const ACTION_LABELS: Record<AutomaticEnforcementAction | ModerationCaseAction, string> = {
  observe: '検知のみ',
  flag: '検知フラグ',
  warn: '警告',
  delete: 'メッセージ削除',
  warn_delete: '警告 + 削除',
  timeout: 'タイムアウト',
  role: 'Role付与',
  blacklist: 'ブラックリスト',
  kick: 'Kick',
  ban: 'BAN',
};

const STATUS_LABELS: Record<ModerationCaseRecord['status'], string> = {
  active: '有効',
  completed: '完了',
  revoked: '解除済み',
  failed: '失敗',
};

export function moderationVisualImageUrl(variant: ModerationVisualVariant): string {
  const baseUrl = (process.env.HERTA_PUBLIC_BASE_URL ?? DEFAULT_PUBLIC_BASE_URL).replace(/\/+$/u, '');
  return `${baseUrl}/api/discord-assets/moderation/${variant}`;
}

export function buildAutomaticAlertEmbed(input: {
  severity: AutomaticModerationSeverity;
  action: AutomaticEnforcementAction;
  targetUserId: string;
  channelId: string;
  matchedSelectors: string[];
  jumpUrl: string;
  createdTimestamp: number;
  excerpt?: string | null;
  failure?: boolean;
  errorMessage?: string | null;
}): DiscordEmbedPayload {
  const variant = input.failure ? 'failed' : severityVariant(input.severity);
  const fields: DiscordEmbedFieldPayload[] = [
    field('危険度', SEVERITY_LABELS[input.severity], true),
    field('対応', ACTION_LABELS[input.action], true),
    field('対象ユーザー', `<@${input.targetUserId}>\n\`${input.targetUserId}\``),
    field('チャンネル', `<#${input.channelId}>`, true),
    field('検知ルール', input.matchedSelectors.map((selector) => `\`${selector}\``).join('、')),
    field('検知日時', `<t:${Math.floor(input.createdTimestamp / 1000)}:F>`),
  ];

  if (input.errorMessage) {
    fields.push(field('エラー', `\`${truncate(input.errorMessage, 900)}\``));
  }
  if (input.excerpt) {
    fields.push(field('本文プレビュー', `\`\`\`\n${truncate(input.excerpt, 900)}\n\`\`\``));
  }

  return {
    title: truncate(
      input.failure ? '🚨 自動Moderation対応に失敗' : severityTitle(input.severity),
      DISCORD_EMBED_TITLE_LIMIT,
    ),
    description: truncate(
      input.failure
        ? '自動対応を完了できませんでした。権限・ロール階層・対象ユーザーの状態を確認してください。'
        : 'ルールに一致するメッセージを検知しました。必要に応じて元メッセージとCase履歴を確認してください。',
      DISCORD_EMBED_DESCRIPTION_LIMIT,
    ),
    color: VARIANT_COLORS[variant],
    url: input.jumpUrl,
    fields,
    footer: { text: truncate('Herta • Moderation Intelligence', DISCORD_EMBED_FOOTER_LIMIT) },
    timestamp: new Date(input.createdTimestamp).toISOString(),
    image: { url: moderationVisualImageUrl(variant) },
  };
}

export function buildAutomaticWarningEmbed(
  policy: AutomaticEnforcementPolicy,
  warningMessage: string,
): DiscordEmbedPayload {
  return {
    title: '⚠️ Herta Moderationからのお知らせ',
    description: truncate(warningMessage, DISCORD_EMBED_DESCRIPTION_LIMIT),
    color: VARIANT_COLORS.warning,
    fields: [
      field('対応', ACTION_LABELS[policy.action], true),
      field('重要度', SEVERITY_LABELS[policy.severity], true),
      field('ご案内', '詳細についてはサーバーのモデレーターへお問い合わせください。'),
    ],
    footer: { text: 'Herta • Community Safety' },
    timestamp: new Date().toISOString(),
    image: { url: moderationVisualImageUrl('warning') },
  };
}

export function buildModerationCaseEmbed(
  moderationCase: ModerationCaseRecord,
  options: { targetNotification?: boolean } = {},
): DiscordEmbedPayload {
  const isFailure = moderationCase.status === 'failed';
  const variant: ModerationVisualVariant = isFailure ? 'failed' : 'case';
  const fields: DiscordEmbedFieldPayload[] = [
    field('Case', `#${moderationCase.caseNumber}`, true),
    field('種別', actionLabel(moderationCase.action), true),
    field('状態', STATUS_LABELS[moderationCase.status], true),
  ];

  if (!options.targetNotification) {
    fields.push(
      field('対象ユーザー', `<@${moderationCase.targetUserId}>\n\`${moderationCase.targetUserId}\``),
      field('実行者', `<@${moderationCase.moderatorUserId}>\n\`${moderationCase.moderatorUserId}\``),
    );
  }
  if (moderationCase.durationSeconds) {
    fields.push(field('期間', `${Math.ceil(moderationCase.durationSeconds / 60)}分`, true));
  }
  if (moderationCase.reason) {
    fields.push(field('理由', moderationCase.reason));
  }

  return {
    title: options.targetNotification
      ? `Moderation Case #${moderationCase.caseNumber}`
      : `📋 Moderation Case #${moderationCase.caseNumber}`,
    description: options.targetNotification
      ? `このサーバーで「${actionLabel(moderationCase.action)}」が記録されました。`
      : 'Moderation Caseの詳細です。',
    color: VARIANT_COLORS[variant],
    fields,
    footer: { text: 'Herta • Moderation Case' },
    timestamp: moderationCase.createdAt.toISOString(),
    image: { url: moderationVisualImageUrl(variant) },
  };
}

export function buildModerationHistoryEmbed(input: {
  targetUserId: string;
  items: ModerationCaseRecord[];
  page: number;
  totalPages: number;
}): DiscordEmbedPayload {
  const description =
    input.items.length === 0
      ? 'このユーザーに紐づくModeration Caseはありません。'
      : input.items
          .map((item) => {
            const reason = item.reason ? `\n└ ${truncate(item.reason, 160)}` : '';
            return `**#${item.caseNumber}** ${actionLabel(item.action)} • ${STATUS_LABELS[item.status]}${reason}`;
          })
          .join('\n\n');

  return {
    title: '📚 Moderation履歴',
    description: truncate(description, DISCORD_EMBED_DESCRIPTION_LIMIT),
    color: VARIANT_COLORS.case,
    fields: [
      field('対象ユーザー', `<@${input.targetUserId}>\n\`${input.targetUserId}\``),
      field('ページ', `${input.page} / ${Math.max(input.totalPages, 1)}`, true),
      field('表示件数', String(input.items.length), true),
    ],
    footer: { text: 'Herta • Moderation History' },
    timestamp: new Date().toISOString(),
    image: { url: moderationVisualImageUrl('case') },
  };
}

export function buildModerationStatusEmbed(input: {
  title: string;
  description: string;
  variant: 'info' | 'warning' | 'failed' | 'case';
  fields?: DiscordEmbedFieldPayload[];
}): DiscordEmbedPayload {
  return {
    title: truncate(input.title, DISCORD_EMBED_TITLE_LIMIT),
    description: truncate(input.description, DISCORD_EMBED_DESCRIPTION_LIMIT),
    color: VARIANT_COLORS[input.variant],
    fields: input.fields,
    footer: { text: 'Herta • Moderation' },
    timestamp: new Date().toISOString(),
    image: { url: moderationVisualImageUrl(input.variant) },
  };
}

export function actionLabel(action: AutomaticEnforcementAction | ModerationCaseAction): string {
  return ACTION_LABELS[action];
}

function severityVariant(severity: AutomaticModerationSeverity): ModerationVisualVariant {
  if (severity === 'critical') return 'critical';
  if (severity === 'high') return 'high';
  if (severity === 'medium') return 'warning';
  return 'info';
}

function severityTitle(severity: AutomaticModerationSeverity): string {
  if (severity === 'critical') return '🚨 Moderation緊急検知';
  if (severity === 'high') return '🟠 Moderation高リスク検知';
  if (severity === 'medium') return '🟡 Moderation注意検知';
  return '🔵 Moderation検知';
}

function field(name: string, value: string, inline = false): DiscordEmbedFieldPayload {
  return {
    name: truncate(name, 256),
    value: truncate(value || '—', DISCORD_EMBED_FIELD_VALUE_LIMIT),
    ...(inline ? { inline: true } : {}),
  };
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, Math.max(maxLength - 1, 0))}…`;
}
