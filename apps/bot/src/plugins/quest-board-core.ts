import type {
  IvrmQuestBoardResult,
  QuestBoardPeriod,
  QuestBoardPeriodType,
  QuestBoardQuest,
  QuestBoardStatus,
} from './quest-board-ivrm.js';

/** Web (ivrm-web) のクエストボード。本人向け導線は常にここへ寄せる。 */
export const MEMBER_QUEST_BOARD_URL = 'https://member.ivrm.jp/quests';

export interface QuestBoardPeriodMeta {
  type: QuestBoardPeriodType;
  label: string;
  /** セレクトメニューの補足文。 */
  selectDescription: string;
}

export const QUEST_BOARD_PERIODS: readonly QuestBoardPeriodMeta[] = [
  { type: 'daily', label: 'デイリー', selectDescription: '今日のクエスト' },
  { type: 'weekly', label: 'ウィークリー', selectDescription: '今週のクエスト' },
  { type: 'monthly', label: 'マンスリー', selectDescription: '今月のクエスト' },
];

export function isQuestBoardPeriodType(value: string): value is QuestBoardPeriodType {
  return QUEST_BOARD_PERIODS.some((period) => period.type === value);
}

export function questBoardPeriodLabel(periodType: QuestBoardPeriodType): string {
  return QUEST_BOARD_PERIODS.find((period) => period.type === periodType)?.label ?? periodType;
}

export function questBoardPeriod(board: QuestBoardStatus, periodType: QuestBoardPeriodType) {
  return board.periods.find((period) => period.periodType === periodType);
}

const jstDateTimeFormatter = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** ISO 8601 を JST 表記にする。未取得・不正値は「未取得」。 */
export function formatJstDateTime(iso: string | null | undefined): string {
  if (!iso) return '未取得';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '未取得';
  return `${jstDateTimeFormatter.format(date)} (JST)`;
}

export const PROGRESS_BAR_SEGMENTS = 10;

/** 進捗 (progress / threshold) をブロック文字のバーにする (例: ▰▰▰▰▰▰▱▱▱▱)。範囲外は丸める。 */
export function formatProgressBar(progress: number, threshold: number): string {
  const ratio = threshold > 0 ? progress / threshold : progress >= threshold ? 1 : 0;
  const clamped = Math.min(1, Math.max(0, ratio));
  const filled = Math.round(clamped * PROGRESS_BAR_SEGMENTS);
  return '▰'.repeat(filled) + '▱'.repeat(PROGRESS_BAR_SEGMENTS - filled);
}

/** 進捗率 (%)。閾値を超えた分は 100 に丸める。 */
export function formatProgressPercent(progress: number, threshold: number): number {
  if (threshold <= 0) return progress >= threshold ? 100 : 0;
  return Math.min(100, Math.max(0, Math.floor((progress / threshold) * 100)));
}

/** 「あと少し」の判定境界 (DESIGN: 80%以上・未達成・ロックなし)。 */
export const ALMOST_COMPLETE_RATIO = 0.8;

export function isAlmostComplete(quest: QuestBoardQuest): boolean {
  if (quest.completed || quest.locked || quest.threshold <= 0) return false;
  return quest.progress / quest.threshold >= ALMOST_COMPLETE_RATIO;
}

/** 期間終了 (endsAt) までの残り時間。過ぎている場合はリセット直前として扱う。 */
export function formatRemainingUntil(endsAtIso: string, now: Date = new Date()): string {
  const endsAt = new Date(endsAtIso);
  if (Number.isNaN(endsAt.getTime())) return '';
  const diffMs = endsAt.getTime() - now.getTime();
  if (diffMs <= 0) return 'まもなくリセット';
  const totalMinutes = Math.floor(diffMs / 60_000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `あと${days}日${hours}時間`;
  if (hours > 0) return `あと${hours}時間${minutes}分`;
  return `あと${minutes}分`;
}

/** スロット日 (YYYY-MM-DD) を「M月D日」にする。不正値はそのまま返す。 */
export function formatSlotDate(slotDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(slotDate);
  if (!match) return slotDate;
  return `${Number(match[2])}月${Number(match[3])}日`;
}

/** 対象期間の表記。デイリーは当日、他は開始〜終了。 */
export function formatPeriodRange(period: QuestBoardPeriod): string {
  if (period.periodType === 'daily') return formatSlotDate(period.startSlotDate);
  return `${formatSlotDate(period.startSlotDate)}〜${formatSlotDate(period.endSlotDate)}`;
}

/** ivrm-web 連携の失敗状態を、本人向けの案内文へ変換する。 */
export function formatQuestBoardError(
  result: Exclude<IvrmQuestBoardResult, { status: 'ok' }>,
): string {
  switch (result.status) {
    case 'not-linked':
      return `ivrm-webの会員連携が見つかりません。先に ${MEMBER_QUEST_BOARD_URL} へDiscordでログインして会員登録を済ませてください。その後はこのコマンドでも進捗を確認できます。`;
    case 'duplicate':
      return 'Discordアカウントの会員連携が重複しています。ポータルの連携状態を確認してください。解決しない場合は運営へ連絡してください。';
    case 'disabled':
      return 'クエストボードは現在利用できません。ポータルのお知らせを確認してください。';
    case 'ineligible-guild':
      return 'このサーバーはivrm-webの会員情報連携の対象外です。';
    case 'unconfigured':
      return 'ivrm-webの会員情報連携は未設定です。管理者に連携設定を確認してください。';
    case 'unavailable':
      return 'ivrm-webへ現在接続できません。少し待ってからお試しください。';
  }
}

// ---------------------------------------------------------------------------
// Embed ペイロード生成。game-accounts-core と同じく、core は discord.js
// に依存しない純粋層なので、EmbedBuilder ではなく APIEmbed 互換の
// プレーンオブジェクトを返し、プラグイン側がそのまま `embeds` に渡す。
// ---------------------------------------------------------------------------

export interface QuestBoardEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface QuestBoardEmbed {
  title?: string;
  description?: string;
  color: number;
  fields?: QuestBoardEmbedField[];
  footer?: { text: string };
}

/** ポータル (member.ivrm.jp) のミント系アクセントに寄せた基調色 (game と同値)。 */
export const EMBED_COLOR_PRIMARY = 0x34d399;
/** 全クリアなどの達成も基調のミントで示す。 */
export const EMBED_COLOR_SUCCESS = EMBED_COLOR_PRIMARY;
/** エラーは赤系で明確に分ける。 */
export const EMBED_COLOR_ERROR = 0xed4245;
/** 注意を促す場面はアンバー。 */
export const EMBED_COLOR_WARNING = 0xf0b232;
/** 中立的な通知はグレー。 */
export const EMBED_COLOR_NEUTRAL = 0x9aa5b1;

// Discord の Embed 制限。純粋関数側で必ずこの範囲に収める。
export const MAX_EMBED_TITLE_CHARS = 256;
export const MAX_EMBED_DESCRIPTION_CHARS = 4096;
export const MAX_EMBED_FIELD_NAME_CHARS = 256;
export const MAX_EMBED_FIELD_VALUE_CHARS = 1024;
export const MAX_EMBED_FOOTER_CHARS = 2048;
export const MAX_EMBED_FIELDS = 25;
export const MAX_EMBED_TOTAL_CHARS = 6000;

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 1)}…`;
}

/** Embed 全体の文字数 (Discord の 6000 字制限の数え方に合わせた合計)。 */
export function embedCharacterCount(embed: QuestBoardEmbed): number {
  let total = (embed.title?.length ?? 0) + (embed.description?.length ?? 0);
  total += embed.footer?.text.length ?? 0;
  for (const field of embed.fields ?? []) total += field.name.length + field.value.length;
  return total;
}

export type NoticeTone = 'success' | 'error' | 'warning' | 'neutral';

const NOTICE_COLORS: Record<NoticeTone, number> = {
  success: EMBED_COLOR_SUCCESS,
  error: EMBED_COLOR_ERROR,
  warning: EMBED_COLOR_WARNING,
  neutral: EMBED_COLOR_NEUTRAL,
};

/** 短い通知文を色分けした小さな Embed にする。 */
export function buildNoticeEmbed(description: string, tone: NoticeTone): QuestBoardEmbed {
  return {
    description: truncate(description, MAX_EMBED_DESCRIPTION_CHARS),
    color: NOTICE_COLORS[tone],
  };
}

/** 連携エラーは案内文を赤い Embed で出す。 */
export function buildQuestBoardErrorEmbed(
  result: Exclude<IvrmQuestBoardResult, { status: 'ok' }>,
): QuestBoardEmbed {
  return buildNoticeEmbed(formatQuestBoardError(result), 'error');
}

function buildQuestField(quest: QuestBoardQuest): QuestBoardEmbedField {
  const mark = quest.completed ? '✅' : quest.locked ? '🔒' : '⬜';
  const name = truncate(
    `${mark} ${quest.title}（${quest.xpReward} XP）`,
    MAX_EMBED_FIELD_NAME_CHARS,
  );
  const lines: string[] = [];
  if (quest.description) lines.push(quest.description);
  if (quest.locked) {
    lines.push(
      `前提クエスト「${quest.prerequisiteTitle ?? '（不明）'}」をクリアすると解放されます`,
    );
  }
  const percent = formatProgressPercent(quest.progress, quest.threshold);
  lines.push(
    `${formatProgressBar(quest.progress, quest.threshold)} ${quest.progress} / ${quest.threshold} ${quest.unit}（${percent}%）`,
  );
  if (quest.recorded) lines.push('クリア済みです');
  else if (quest.completed) lines.push('達成条件を満たしています');
  return { name, value: truncate(lines.join('\n'), MAX_EMBED_FIELD_VALUE_CHARS) };
}

/**
 * 1期間分のボード Embed。タイトルに期間、概要に達成状況と全クリア
 * までの導線、フィールドにクエストごとの進捗を出す。「あと少し
 * (80%以上)」のクエストは概要で呼びかける (DESIGN §3.2 の Embed 併記)。
 */
export function buildQuestBoardEmbed(
  board: QuestBoardStatus,
  periodType: QuestBoardPeriodType,
  now: Date = new Date(),
): QuestBoardEmbed {
  const period = questBoardPeriod(board, periodType);
  if (!period)
    return buildNoticeEmbed(
      '期間データを取得できませんでした。少し待ってからお試しください。',
      'error',
    );
  const label = questBoardPeriodLabel(periodType);
  const title = truncate(`📋 クエストボード（${label}）`, MAX_EMBED_TITLE_CHARS);
  if (period.quests.length === 0) {
    return {
      title,
      description: truncate(
        `${formatPeriodRange(period)} ・ 現在表示できるクエストがありません。`,
        MAX_EMBED_DESCRIPTION_CHARS,
      ),
      color: EMBED_COLOR_NEUTRAL,
      footer: {
        text: truncate(
          `ポータルでも確認できます：${MEMBER_QUEST_BOARD_URL}`,
          MAX_EMBED_FOOTER_CHARS,
        ),
      },
    };
  }
  const remaining = period.quests.length - period.completedCount;
  const descriptionLines = [
    `${formatPeriodRange(period)} ・ ${period.completedCount}/${period.quests.length} クリア`,
  ];
  if (period.allClear) {
    descriptionLines.push(
      `🎉 全クリア達成！ 全クリアボーナス ${period.allClearPoints} pt の対象です`,
    );
  } else {
    descriptionLines.push(
      `全クリアまで あと ${remaining} 本（全クリアで ${period.allClearPoints} pt）`,
    );
  }
  const almost = period.quests.filter(isAlmostComplete);
  for (const quest of almost.slice(0, 3)) {
    descriptionLines.push(
      `🔥 あと少し： 「${quest.title}」あと ${quest.threshold - quest.progress} ${quest.unit}`,
    );
  }
  const footerText = truncate(
    `リセット ${formatJstDateTime(period.endsAt)}（${formatRemainingUntil(period.endsAt, now)}） ・ 累計クリア ${board.totalCompletions} 件 ・ ポータルでも確認できます：${MEMBER_QUEST_BOARD_URL}`,
    MAX_EMBED_FOOTER_CHARS,
  );
  const fields: QuestBoardEmbedField[] = [];
  let usedChars = title.length + footerText.length + descriptionLines.join('\n').length;
  let omitted = 0;
  for (let index = 0; index < period.quests.length; index += 1) {
    const field = buildQuestField(period.quests[index]!);
    const remainingAfter = period.quests.length - index - 1;
    // 最後の1枠は「ほか N 件」フィールドのために空けておく。
    const fillsLastSlot = fields.length + 1 >= MAX_EMBED_FIELDS && remainingAfter > 0;
    if (
      fillsLastSlot ||
      usedChars + field.name.length + field.value.length > MAX_EMBED_TOTAL_CHARS
    ) {
      omitted = period.quests.length - index;
      break;
    }
    fields.push(field);
    usedChars += field.name.length + field.value.length;
  }
  if (omitted > 0) {
    const omissionField: QuestBoardEmbedField = {
      name: `…ほか ${omitted} 件のクエスト`,
      value: '表示しきれない分はポータルのクエストボードで確認してください。',
    };
    if (
      fields.length < MAX_EMBED_FIELDS &&
      usedChars + omissionField.name.length + omissionField.value.length <= MAX_EMBED_TOTAL_CHARS
    ) {
      fields.push(omissionField);
    }
  }
  return {
    title,
    description: truncate(descriptionLines.join('\n'), MAX_EMBED_DESCRIPTION_CHARS),
    color: period.allClear ? EMBED_COLOR_SUCCESS : EMBED_COLOR_PRIMARY,
    fields,
    footer: { text: footerText },
  };
}

/** 画像カードの添付ファイル名 (期間ごと)。プラグインが AttachmentBuilder に載せる。 */
export function questBoardCardFileName(periodType: QuestBoardPeriodType): string {
  return `quest-board-${periodType}.png`;
}

/**
 * 画像カードに併記する補助 Embed (DESIGN §3.2)。クエスト一覧は
 * カード側が担うので、こちらは全クリア報酬 pt の状態と「あと少し」
 * の呼びかけ、ポータルへの導線だけを持つ。カードが取得できない
 * 場合は buildQuestBoardEmbed (一覧入り) がフォールバックになる。
 */
export function buildQuestBoardCardEmbed(
  board: QuestBoardStatus,
  periodType: QuestBoardPeriodType,
  now: Date = new Date(),
): QuestBoardEmbed {
  const period = questBoardPeriod(board, periodType);
  if (!period)
    return buildNoticeEmbed(
      '期間データを取得できませんでした。少し待ってからお試しください。',
      'error',
    );
  const label = questBoardPeriodLabel(periodType);
  const title = truncate(`📋 クエストボード（${label}）`, MAX_EMBED_TITLE_CHARS);
  const descriptionLines: string[] = [];
  if (period.quests.length === 0) {
    descriptionLines.push(`${formatPeriodRange(period)} ・ 現在表示できるクエストがありません。`);
  } else if (period.allClear) {
    descriptionLines.push(
      `🎉 全クリア達成！ 全クリアボーナス ${period.allClearPoints} pt の対象です`,
    );
  } else {
    const remaining = period.quests.length - period.completedCount;
    const remainingXp = period.quests
      .filter((quest) => !quest.completed)
      .reduce((sum, quest) => sum + quest.xpReward, 0);
    descriptionLines.push(
      `全クリアまで あと ${remaining} 本（全クリアで ${period.allClearPoints} pt）・ 残り ${remainingXp} XP`,
    );
    const almost = period.quests.filter(isAlmostComplete);
    for (const quest of almost.slice(0, 3)) {
      descriptionLines.push(
        `🔥 あと少し： 「${quest.title}」あと ${quest.threshold - quest.progress} ${quest.unit}`,
      );
    }
  }
  return {
    title,
    description: truncate(descriptionLines.join('\n'), MAX_EMBED_DESCRIPTION_CHARS),
    color: period.allClear ? EMBED_COLOR_SUCCESS : EMBED_COLOR_PRIMARY,
    footer: {
      text: truncate(
        `リセット ${formatJstDateTime(period.endsAt)}（${formatRemainingUntil(period.endsAt, now)}） ・ 累計クリア ${board.totalCompletions} 件 ・ ポータルでも確認できます：${MEMBER_QUEST_BOARD_URL}`,
        MAX_EMBED_FOOTER_CHARS,
      ),
    },
  };
}

// ---------------------------------------------------------------------------
// 期間切替セレクトメニュー (DESIGN §3.1)。customId は
// `quest-board:period:<userId>` で、表示は Ephemeral のため本人だけが
// 切り替えられる。core は discord.js に依存しないので、メニューの
// データだけを返し、プラグイン側が StringSelectMenuBuilder へ載せる。
// ---------------------------------------------------------------------------

export const QUEST_BOARD_PERIOD_CUSTOM_ID_PREFIX = 'quest-board:period:';

export function buildQuestBoardPeriodCustomId(userId: string): string {
  return `${QUEST_BOARD_PERIOD_CUSTOM_ID_PREFIX}${userId}`;
}

export function parseQuestBoardPeriodCustomId(customId: string): { userId: string } | null {
  if (!customId.startsWith(QUEST_BOARD_PERIOD_CUSTOM_ID_PREFIX)) return null;
  const userId = customId.slice(QUEST_BOARD_PERIOD_CUSTOM_ID_PREFIX.length);
  if (!/^\d{17,20}$/.test(userId)) return null;
  return { userId };
}

export interface QuestBoardPeriodSelectData {
  customId: string;
  placeholder: string;
  options: {
    value: QuestBoardPeriodType;
    label: string;
    description: string;
    default: boolean;
  }[];
}

/** 期間切替メニューのデータ。現在の期間が default になる。 */
export function buildQuestBoardPeriodSelect(
  userId: string,
  current: QuestBoardPeriodType,
): QuestBoardPeriodSelectData {
  return {
    customId: buildQuestBoardPeriodCustomId(userId),
    placeholder: '期間を切り替え',
    options: QUEST_BOARD_PERIODS.map((period) => ({
      value: period.type,
      label: period.label,
      description: period.selectDescription,
      default: period.type === current,
    })),
  };
}
