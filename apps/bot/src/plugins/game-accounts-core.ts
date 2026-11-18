import type {
  GameAccountListEntry,
  GameAccountsRequestInput,
  GameRankingAxis,
  GameRankingEntry,
  GameRankingFormula,
  HoyolabEndgameEntry,
  HoyolabProgressSnapshot,
  IvrmGameAccountsResult,
  ShowcaseCharacterScore,
} from './game-accounts-ivrm.js';

/** Web (ivrm-web) のゲームアカウント登録画面。本人向け導線は常にここへ寄せる。 */
export const MEMBER_GAME_ACCOUNTS_URL = 'https://member.ivrm.jp/profile';

export interface GameDefinition {
  code: string;
  name: string;
  /** スコアの呼称 (原神=聖遺物、スタレ=遺物、ZZZ=ドライブディスク)。 */
  scoreLabel: string;
  /** Enka ショーケース取得に対応しているか (鳴潮・NTE は UID 登録のみ)。 */
  showcaseSupported: boolean;
}

export const GAME_DEFINITIONS: readonly GameDefinition[] = [
  { code: 'genshin', name: '原神', scoreLabel: '聖遺物スコア', showcaseSupported: true },
  {
    code: 'starrail',
    name: '崩壊：スターレイル',
    scoreLabel: '遺物スコア',
    showcaseSupported: true,
  },
  {
    code: 'zzz',
    name: 'ゼンレスゾーンゼロ',
    scoreLabel: 'ドライブディスクスコア',
    showcaseSupported: true,
  },
  {
    code: 'endfield',
    name: 'アークナイツ：エンドフィールド',
    scoreLabel: '装備スコア',
    showcaseSupported: true,
  },
  { code: 'wuthering', name: '鳴潮', scoreLabel: 'スコア', showcaseSupported: false },
  { code: 'nte', name: 'NTE', scoreLabel: 'スコア', showcaseSupported: false },
];

export const GAME_CHOICES = GAME_DEFINITIONS.map((game) => ({
  name: game.name,
  value: game.code,
}));

export function gameDefinition(gameCode: string): GameDefinition | undefined {
  return GAME_DEFINITIONS.find((game) => game.code === gameCode);
}

export function gameName(gameCode: string): string {
  return gameDefinition(gameCode)?.name ?? gameCode;
}

export function scoreLabel(gameCode: string): string {
  return gameDefinition(gameCode)?.scoreLabel ?? 'スコア';
}

export function isShowcaseSupported(gameCode: string): boolean {
  return gameDefinition(gameCode)?.showcaseSupported ?? false;
}

/**
 * HoYoLAB 戦績 (探索度) に対応しているか。API の progress アクションが
 * 受け付けるのは原神と崩壊：スターレイルだけで、他タイトルは 422
 * (progress_not_supported) を返す。表示側も同じ集合で先に案内する。
 */
const PROGRESS_SUPPORTED_GAMES: ReadonlySet<string> = new Set(['genshin', 'starrail']);

export function isProgressSupported(gameCode: string): boolean {
  return PROGRESS_SUPPORTED_GAMES.has(gameCode);
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

const ROLL_STAT_LABELS: Record<string, string> = {
  critRate: '会心率',
  critDmg: '会心ダメージ',
  atkPercent: '攻撃力%',
  atk: '攻撃力',
  hpPercent: 'HP%',
  hp: 'HP',
  defPercent: '防御力%',
  def: '防御力',
  energyRecharge: '元素チャージ効率',
  elementalMastery: '元素熟知',
  spd: '速度',
  effectHitRate: '効果命中',
  effectRes: '効果抵抗',
  breakEffect: '撃破特効',
  healingBoost: '治癒バフ',
};

/** 表示順の優先度: 会心系を先頭に固定し、同順位はロール数の多い順にする。 */
const ROLL_STAT_PRIORITY: Record<string, number> = { critRate: 0, critDmg: 1 };

function sortedRollEntries(rolls: Record<string, number>): [string, number][] {
  return Object.entries(rolls)
    .filter(([, count]) => count > 0)
    .sort(
      (a, b) =>
        b[1] - a[1] ||
        (ROLL_STAT_PRIORITY[a[0]] ?? 2) - (ROLL_STAT_PRIORITY[b[0]] ?? 2) ||
        a[0].localeCompare(b[0]),
    );
}

export function formatRolls(rolls: Record<string, number>): string {
  const entries = sortedRollEntries(rolls);
  if (entries.length === 0) return '有効ロールなし';
  return entries.map(([stat, count]) => `${ROLL_STAT_LABELS[stat] ?? stat}×${count}`).join('・');
}

/**
 * スコア表示用の短縮ラベル。Embed のフィールドは文字数制限が厳しいため、
 * 部位別内訳ではこちらを使う。情報 (有効ロールの種類と回数) は落とさない。
 */
const ROLL_STAT_SHORT_LABELS: Record<string, string> = {
  critRate: '率',
  critDmg: 'ダメ',
  atkPercent: '攻撃%',
  atk: '攻撃',
  hpPercent: 'HP%',
  hp: 'HP',
  defPercent: '防御%',
  def: '防御',
  energyRecharge: 'チャージ',
  elementalMastery: '熟知',
  spd: '速度',
  effectHitRate: '命中',
  effectRes: '抵抗',
  breakEffect: '撃破',
  healingBoost: '治癒',
};

export function formatRollsShort(rolls: Record<string, number>): string {
  const entries = sortedRollEntries(rolls);
  if (entries.length === 0) return '有効ロールなし';
  return entries
    .map(([stat, count]) => `${ROLL_STAT_SHORT_LABELS[stat] ?? stat}×${count}`)
    .join('・');
}

/**
 * スコア凡例 (短縮ラベルのうち自明でないものだけ)。Embed ごとに1回だけ
 * フッターへ入れる。原神は元素系の短縮が多いので専用の凡例を持つ。
 */
export function scoreRollLegend(gameCode: string): string {
  return gameCode === 'genshin'
    ? '率=会心率・ダメ=会心ダメージ・チャージ=元素チャージ効率・熟知=元素熟知'
    : '率=会心率・ダメ=会心ダメージ';
}

/**
 * 部位名。API の artifactScore.perPiece はスロット情報を持たず、ゲーム内の
 * 部位順 (Enka の並び) で返るため、並び順から部位名を割り当てる。
 * 原神・スタレは固定順、ZZZ はディスク番号、エンドフィールドは装備番号。
 */
const SCORE_PIECE_LABELS: Record<string, readonly string[]> = {
  genshin: ['花', '羽', '砂', '杯', '冠'],
  starrail: ['頭', '腕', '胴', '脚', '球', '縄'],
};

export function scorePieceLabel(gameCode: string, index: number): string {
  const labels = SCORE_PIECE_LABELS[gameCode];
  if (labels) return labels[index] ?? `部位${index + 1}`;
  if (gameCode === 'zzz') return `ディスク${index + 1}`;
  if (gameCode === 'endfield') return `装備${index + 1}`;
  return `部位${index + 1}`;
}

/** スコアバーの満点 (合計 CV の現実的な上限)。原神は5部位、他は6部位相当。 */
export const SCORE_BAR_MAX: Record<string, number> = {
  genshin: 250,
  starrail: 300,
  zzz: 300,
  endfield: 200,
};
export const SCORE_BAR_DEFAULT_MAX = 250;
export const SCORE_BAR_SEGMENTS = 10;

/** 合計スコアをブロック文字のバーにする (例: ▰▰▰▰▰▰▱▱▱▱)。 */
export function formatScoreBar(total: number, gameCode: string): string {
  const max = SCORE_BAR_MAX[gameCode] ?? SCORE_BAR_DEFAULT_MAX;
  const ratio = Math.min(1, Math.max(0, total / max));
  const filled = Math.round(ratio * SCORE_BAR_SEGMENTS);
  return '▰'.repeat(filled) + '▱'.repeat(SCORE_BAR_SEGMENTS - filled);
}

export const PERCENT_BAR_SEGMENTS = 10;

/** 探索度 (%) をスコアと同じブロック文字のバーにする。範囲外は丸める。 */
export function formatPercentBar(percent: number): string {
  const ratio = Math.min(1, Math.max(0, percent / 100));
  const filled = Math.round(ratio * PERCENT_BAR_SEGMENTS);
  return '▰'.repeat(filled) + '▱'.repeat(PERCENT_BAR_SEGMENTS - filled);
}

/** 探索度 (%) の数値表記。小数1桁までだが、整数なら小数部を落とす。 */
export function formatPercent(percent: number): string {
  return Number.isInteger(percent) ? `${percent}` : percent.toFixed(1);
}

/** ivrm-web 連携の失敗状態を、本人向けの案内文へ変換する。 */
export function formatGameAccountsError(
  result: Exclude<IvrmGameAccountsResult, { status: 'ok' }>,
): string {
  switch (result.status) {
    case 'not-linked':
      return `ivrm-webの会員連携が見つかりません。先に ${MEMBER_GAME_ACCOUNTS_URL} へDiscordでログインして会員登録を済ませてください。その後はこのコマンドでも登録できます。`;
    case 'not-found':
      return result.error === 'game_not_found'
        ? 'そのゲームは連携対象外です。対応タイトルは /game link の選択肢から選んでください。'
        : 'そのゲームのUIDはまだ登録されていません。/game link で登録してください。';
    case 'invalid-input':
      return result.field
        ? `入力を確認してください（${result.field}：${result.message}）`
        : `入力を確認してください（${result.message}）`;
    case 'card-unavailable':
      return 'カード画像は現在表示できません。';
    case 'progress-unsupported':
      return 'そのゲームは探索度表示に未対応です。対応しているのは原神と崩壊：スターレイルです。';
    case 'ineligible-guild':
      return 'このサーバーはivrm-webの会員情報連携の対象外です。';
    case 'unconfigured':
      return 'ivrm-webの会員情報連携は未設定です。管理者に連携設定を確認してください。';
    case 'unavailable':
      return 'ivrm-webへ現在接続できません。少し待ってからお試しください。';
  }
}

// ---------------------------------------------------------------------------
// Embed ペイロード生成 (#909)。平文の羅列では分かりにくいという Owner
// フィードバックを受け、/game の結果表示を Discord Embed に寄せる。
// core は discord.js に依存しない純粋層なので、EmbedBuilder ではなく
// APIEmbed 互換のプレーンオブジェクトを返し、プラグイン側がそのまま
// `embeds` に渡す (fortune は EmbedBuilder 利用だが、結果は同形)。
// ---------------------------------------------------------------------------

export interface GameEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface GameEmbed {
  title?: string;
  description?: string;
  color: number;
  fields?: GameEmbedField[];
  footer?: { text: string };
}

/** ポータル (member.ivrm.jp) のミント系アクセントに寄せた基調色。 */
export const EMBED_COLOR_PRIMARY = 0x34d399;
/** 成功 (登録・解除の完了など) は基調のミントで示す。 */
export const EMBED_COLOR_SUCCESS = EMBED_COLOR_PRIMARY;
/** エラーは赤系で明確に分ける。 */
export const EMBED_COLOR_ERROR = 0xed4245;
/** 解除確認など、注意を促す場面はアンバー。 */
export const EMBED_COLOR_WARNING = 0xf0b232;
/** キャンセルなど中立的な通知はグレー。 */
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
export function embedCharacterCount(embed: GameEmbed): number {
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
export function buildNoticeEmbed(description: string, tone: NoticeTone): GameEmbed {
  return {
    description: truncate(description, MAX_EMBED_DESCRIPTION_CHARS),
    color: NOTICE_COLORS[tone],
  };
}

/** 連携エラーは現行の文言そのままを赤い Embed で出す。 */
export function buildGameAccountsErrorEmbed(
  result: Exclude<IvrmGameAccountsResult, { status: 'ok' }>,
): GameEmbed {
  return buildNoticeEmbed(formatGameAccountsError(result), 'error');
}

export function buildLinkSuccessEmbed(
  result: Extract<IvrmGameAccountsResult, { status: 'ok'; action: 'link' }>,
): GameEmbed {
  const name = gameName(result.account.gameCode);
  const lines = ['Webのマイページにも反映されます。'];
  if (!isShowcaseSupported(result.account.gameCode)) {
    lines.push('このタイトルはショーケース取得に未対応のため、UIDの登録のみ行いました。');
  } else if (result.showcase.status === 'ok' && result.showcase.fetchedAt) {
    lines.push(`ショーケースを取得しました（${formatJstDateTime(result.showcase.fetchedAt)}）。`);
  } else {
    lines.push(
      `ショーケースはまだ取得できていません（状態：${result.showcase.status}）。時間をおいて /game score で確認してください。`,
    );
  }
  return {
    title: truncate(
      `✅ ${name} のUID（${result.account.uid}）を登録しました`,
      MAX_EMBED_TITLE_CHARS,
    ),
    description: truncate(lines.join('\n'), MAX_EMBED_DESCRIPTION_CHARS),
    color: EMBED_COLOR_SUCCESS,
  };
}

export function buildUnlinkSuccessEmbed(gameCode: string): GameEmbed {
  return {
    title: truncate(`🗑️ ${gameName(gameCode)} のUID登録を解除しました`, MAX_EMBED_TITLE_CHARS),
    description: 'Webのマイページにも反映されます。',
    color: EMBED_COLOR_SUCCESS,
  };
}

export function buildUnlinkConfirmEmbed(gameCode: string): GameEmbed {
  const name = gameName(gameCode);
  return {
    title: truncate(`⚠️ ${name} のUID登録の解除`, MAX_EMBED_TITLE_CHARS),
    description: `${name} のUID登録を解除します。Webのマイページからも消えます。よろしいですか？`,
    color: EMBED_COLOR_WARNING,
  };
}

export function buildUnlinkCancelledEmbed(gameCode: string): GameEmbed {
  return buildNoticeEmbed(`${gameName(gameCode)} のUID登録の解除をキャンセルしました。`, 'neutral');
}

function buildListField(account: GameAccountListEntry): GameEmbedField {
  const lines = [`UID ${account.uid}`];
  if (!isShowcaseSupported(account.gameCode)) lines.push('ショーケース未対応（UID登録のみ）');
  else if (account.showcaseFetchedAt)
    lines.push(`最終同期：${formatJstDateTime(account.showcaseFetchedAt)}`);
  else lines.push('最終同期：未取得');
  return {
    name: truncate(gameName(account.gameCode), MAX_EMBED_FIELD_NAME_CHARS),
    value: truncate(lines.join('\n'), MAX_EMBED_FIELD_VALUE_CHARS),
  };
}

export function buildListEmbed(
  result: Extract<IvrmGameAccountsResult, { status: 'ok'; action: 'list' }>,
): GameEmbed {
  const title = '🎮 登録済みのゲームアカウント';
  if (result.accounts.length === 0)
    return {
      title,
      description: `登録済みのゲームアカウントはありません。/game link で登録するか、${MEMBER_GAME_ACCOUNTS_URL} のマイページから登録してください。`,
      color: EMBED_COLOR_PRIMARY,
    };
  const description = '登録内容はWebのマイページと同期しています。';
  // スコア用と同じく、Embed 全体の文字数予算 (6000) を追跡する。
  // UID が極端に長い場合でも Discord に拒否されないようにするため。
  const fields: GameEmbedField[] = [];
  let usedChars = title.length + description.length;
  let omitted = 0;
  for (let index = 0; index < result.accounts.length; index += 1) {
    const field = buildListField(result.accounts[index]!);
    const remainingAfter = result.accounts.length - index - 1;
    // 最後の1枠は「ほか N 件」フィールドのために空けておく。
    const fillsLastSlot = fields.length + 1 >= MAX_EMBED_FIELDS && remainingAfter > 0;
    if (
      fillsLastSlot ||
      usedChars + field.name.length + field.value.length > MAX_EMBED_TOTAL_CHARS
    ) {
      omitted = result.accounts.length - index;
      break;
    }
    fields.push(field);
    usedChars += field.name.length + field.value.length;
  }
  if (omitted > 0) {
    const omissionField: GameEmbedField = {
      name: `…ほか ${omitted} 件のアカウント`,
      value: '表示しきれない分はWebのマイページで確認してください。',
    };
    if (
      fields.length < MAX_EMBED_FIELDS &&
      usedChars + omissionField.name.length + omissionField.value.length <= MAX_EMBED_TOTAL_CHARS
    ) {
      fields.push(omissionField);
    }
  }
  return { title, description, color: EMBED_COLOR_PRIMARY, fields };
}

function buildCharacterScoreField(
  gameCode: string,
  character: ShowcaseCharacterScore,
): GameEmbedField {
  const label = character.name ?? `キャラクターID ${character.id}`;
  if (!character.artifactScore)
    return {
      name: truncate(`${label} Lv.${character.level}`, MAX_EMBED_FIELD_NAME_CHARS),
      value: 'スコアなし',
    };
  const lines = [formatScoreBar(character.artifactScore.total, gameCode)];
  if (character.artifactScore.perPiece.length === 0) {
    lines.push('部位別の内訳はありません');
  } else {
    character.artifactScore.perPiece.forEach((piece, index) => {
      lines.push(
        `${scorePieceLabel(gameCode, index)} CV ${piece.cv.toFixed(1)}（${formatRollsShort(piece.rolls)}）`,
      );
    });
  }
  return {
    name: truncate(
      `${label} Lv.${character.level} ・ スコア ${character.artifactScore.total.toFixed(1)}`,
      MAX_EMBED_FIELD_NAME_CHARS,
    ),
    value: truncate(lines.join('\n'), MAX_EMBED_FIELD_VALUE_CHARS),
  };
}

export function buildScoreEmbed(
  result: Extract<IvrmGameAccountsResult, { status: 'ok'; action: 'score' }>,
): GameEmbed {
  const name = gameName(result.gameCode);
  const title = truncate(`🎮 ${name}の${scoreLabel(result.gameCode)}`, MAX_EMBED_TITLE_CHARS);
  if (!result.hasSnapshot || result.characters.length === 0)
    return {
      title,
      description: truncate(
        `${name} のショーケースはまだ取得できていません（状態：${result.showcaseStatus ?? '未取得'}）。/game link で登録し直すか、${MEMBER_GAME_ACCOUNTS_URL} のマイページで同期してください。`,
        MAX_EMBED_DESCRIPTION_CHARS,
      ),
      color: EMBED_COLOR_NEUTRAL,
    };
  // スコアがあるキャラが1人でもいれば、短縮ラベルの凡例をフッターに1回だけ入れる。
  const hasAnyScore = result.characters.some((character) => character.artifactScore);
  const footerText = truncate(
    hasAnyScore
      ? `UID ${result.uid} ・ 取得：${formatJstDateTime(result.fetchedAt)} ・ 凡例：${scoreRollLegend(result.gameCode)}`
      : `UID ${result.uid} ・ 取得：${formatJstDateTime(result.fetchedAt)}`,
    MAX_EMBED_FOOTER_CHARS,
  );
  const fields: GameEmbedField[] = [];
  let usedChars = title.length + footerText.length;
  let omitted = 0;
  for (let index = 0; index < result.characters.length; index += 1) {
    const field = buildCharacterScoreField(result.gameCode, result.characters[index]!);
    const remainingAfter = result.characters.length - index - 1;
    // 最後の1枠は「ほか N 件」フィールドのために空けておく。
    const fillsLastSlot = fields.length + 1 >= MAX_EMBED_FIELDS && remainingAfter > 0;
    if (
      fillsLastSlot ||
      usedChars + field.name.length + field.value.length > MAX_EMBED_TOTAL_CHARS
    ) {
      omitted = result.characters.length - index;
      break;
    }
    fields.push(field);
    usedChars += field.name.length + field.value.length;
  }
  if (omitted > 0) {
    const omissionField: GameEmbedField = {
      name: `…ほか ${omitted} 件のキャラクター`,
      value: '表示しきれない分はWebのマイページで確認してください。',
    };
    if (
      fields.length < MAX_EMBED_FIELDS &&
      usedChars + omissionField.name.length + omissionField.value.length <= MAX_EMBED_TOTAL_CHARS
    ) {
      fields.push(omissionField);
    }
  }
  return { title, color: EMBED_COLOR_PRIMARY, fields, footer: { text: footerText } };
}

/**
 * カード切替 UI (#1147 S3c) の対象キャラ数上限。API の一括カード生成
 * (GAME_CARD_MAX_BATCH) と同じ 6 に揃える。
 */
export const SCORE_SWITCHER_MAX_CHARACTERS = 6;

/**
 * カード切替 UI の対象はスコアが付いたキャラだけ (カードはスコア付き
 * キャラにしか生成されない)。ショーケース順のまま上限件数に切る。
 */
export function scoreSwitcherCharacters(
  result: Extract<IvrmGameAccountsResult, { status: 'ok'; action: 'score' }>,
): ShowcaseCharacterScore[] {
  return result.characters
    .filter((character) => character.artifactScore !== null)
    .slice(0, SCORE_SWITCHER_MAX_CHARACTERS);
}

/**
 * 1体分だけのスコア Embed。カード画像に添える小さい Embed と、画像が
 * 使えない場合のフォールバック表示を兼ねる。フッターには切替 UI の
 * 位置 (n / 総数) も入れる。対象キャラが結果に無い場合は null。
 */
export function buildScoreCharacterEmbed(
  result: Extract<IvrmGameAccountsResult, { status: 'ok'; action: 'score' }>,
  characterId: string,
): GameEmbed | null {
  if (!result.hasSnapshot) return null;
  const character = result.characters.find((entry) => entry.id === characterId);
  if (!character) return null;
  const name = gameName(result.gameCode);
  const title = truncate(`🎮 ${name}の${scoreLabel(result.gameCode)}`, MAX_EMBED_TITLE_CHARS);
  const switcher = scoreSwitcherCharacters(result);
  const position = switcher.findIndex((entry) => entry.id === characterId);
  const footerParts = [`UID ${result.uid}`, `取得：${formatJstDateTime(result.fetchedAt)}`];
  if (character.artifactScore) footerParts.push(`凡例：${scoreRollLegend(result.gameCode)}`);
  if (position >= 0 && switcher.length > 1)
    footerParts.push(`${position + 1} / ${switcher.length}`);
  return {
    title,
    color: EMBED_COLOR_PRIMARY,
    fields: [buildCharacterScoreField(result.gameCode, character)],
    footer: { text: truncate(footerParts.join(' ・ '), MAX_EMBED_FOOTER_CHARS) },
  };
}

export function buildUnsupportedScoreEmbed(gameCode: string): GameEmbed {
  return buildNoticeEmbed(
    `${gameName(gameCode)} はショーケース取得に未対応のため、スコアを表示できません。UIDの登録・確認は /game list を使ってください。`,
    'neutral',
  );
}

// ---------------------------------------------------------------------------
// 探索度 Embed (#923)。HoYoLAB 戦績の保存済みスナップショットを表示する。
// スナップショットは API 側で表示向けに正規化済みなので、ここでは
// Discord の制限 (25 フィールド / 値 1024 字 / 全体 6000 字) に収める
// 整形だけを行う。
// ---------------------------------------------------------------------------

type ProgressResult = Extract<IvrmGameAccountsResult, { status: 'ok'; action: 'progress' }>;

function formatCount(value: number): string {
  return value.toLocaleString('ja-JP');
}

function statNumber(snapshot: HoyolabProgressSnapshot, key: string): number | null {
  const value = snapshot.stats[key];
  return typeof value === 'number' ? value : null;
}

/** [ラベル, stats キー] の並びで、数値があるものだけ「ラベル 数値」の行にする。 */
function buildStatLines(
  snapshot: HoyolabProgressSnapshot,
  entries: ReadonlyArray<readonly [string, string]>,
): string[] {
  const lines: string[] = [];
  for (const [label, key] of entries) {
    const value = statNumber(snapshot, key);
    if (value !== null) lines.push(`${label} ${formatCount(value)}`);
  }
  return lines;
}

/** 原神の宝箱内訳 (API が返す5段階)。合計は totalChests として別に来る。 */
const GENSHIN_CHEST_LABELS: ReadonlyArray<readonly [string, string]> = [
  ['普通の宝箱', 'commonChests'],
  ['精巧な宝箱', 'exquisiteChests'],
  ['貴重な宝箱', 'preciousChests'],
  ['豪華な宝箱', 'luxuriousChests'],
  ['珍奇な宝箱', 'magicChests'],
];

const ENDGAME_LABELS: Record<string, string> = {
  spiral_abyss: '深境螺旋',
  memory_of_chaos: '混沌の記憶',
  pure_fiction: '虚構叙事',
  apocalyptic_shadow: '末日の幻影',
};

function formatEndgameValue(entry: HoyolabEndgameEntry): string {
  const parts: string[] = [];
  if (entry.maxFloor) parts.push(`到達 ${entry.maxFloor}`);
  if (entry.totalStars !== null) parts.push(`★${entry.totalStars}`);
  if (entry.totalScore !== null) parts.push(`スコア ${formatCount(entry.totalScore)}`);
  return parts.length > 0 ? parts.join(' ・ ') : '記録あり';
}

function buildEndgameFields(snapshot: HoyolabProgressSnapshot): GameEmbedField[] {
  const recorded = snapshot.endgame.filter((entry) => entry.hasData);
  if (recorded.length === 0) {
    return snapshot.endgame.length > 0
      ? [{ name: '高難易度コンテンツ', value: '今期の記録はまだありません' }]
      : [];
  }
  // 原神は深境螺旋だけなので専用フィールド、スタレは3モードを1つにまとめる。
  if (snapshot.gameCode === 'genshin') {
    return recorded.map((entry) => ({
      name: ENDGAME_LABELS[entry.kind] ?? entry.kind,
      value: formatEndgameValue(entry),
    }));
  }
  return [
    {
      name: '高難易度コンテンツ',
      value: recorded
        .map((entry) => `${ENDGAME_LABELS[entry.kind] ?? entry.kind}：${formatEndgameValue(entry)}`)
        .join('\n'),
    },
  ];
}

/** フィールド値の上限 (1024 字) に余裕を持って収まる行数ずつに切る。 */
const EXPLORATION_LINES_PER_FIELD = 12;

function buildExplorationFields(snapshot: HoyolabProgressSnapshot): GameEmbedField[] {
  if (snapshot.explorations.length === 0) return [];
  const lines = snapshot.explorations.map((area) => {
    const name = area.name ?? '名称不明のエリア';
    if (area.percent === null) return `${name} 未計測`;
    return `${name} ${formatPercentBar(area.percent)} ${formatPercent(area.percent)}%`;
  });
  const fields: GameEmbedField[] = [];
  for (let index = 0; index < lines.length; index += EXPLORATION_LINES_PER_FIELD) {
    fields.push({
      name: index === 0 ? 'エリア別探索度' : 'エリア別探索度（続き）',
      value: lines.slice(index, index + EXPLORATION_LINES_PER_FIELD).join('\n'),
    });
  }
  return fields;
}

function buildGenshinProgressFields(snapshot: HoyolabProgressSnapshot): GameEmbedField[] {
  const fields = buildExplorationFields(snapshot);
  const totalChests = statNumber(snapshot, 'totalChests');
  const chestLines = buildStatLines(snapshot, GENSHIN_CHEST_LABELS);
  if (totalChests !== null || chestLines.length > 0) {
    const lines: string[] = [];
    if (totalChests !== null) lines.push(`合計 ${formatCount(totalChests)}`);
    lines.push(...chestLines);
    fields.push({ name: '宝箱', value: lines.join('\n') });
  }
  const recordLines = buildStatLines(snapshot, [
    ['活動日数', 'activeDays'],
    ['アチーブメント', 'achievements'],
    ['獲得キャラ', 'characters'],
    ['ワープポイント', 'waypoints'],
    ['秘境', 'domains'],
  ]);
  if (recordLines.length > 0) fields.push({ name: '記録', value: recordLines.join('\n') });
  fields.push(...buildEndgameFields(snapshot));
  return fields;
}

function buildStarRailProgressFields(snapshot: HoyolabProgressSnapshot): GameEmbedField[] {
  const fields: GameEmbedField[] = [];
  const recordLines = buildStatLines(snapshot, [
    ['宝箱', 'chests'],
    ['活動日数', 'activeDays'],
    ['アチーブメント', 'achievements'],
    ['獲得キャラ', 'characters'],
  ]);
  if (recordLines.length > 0) fields.push({ name: '記録', value: recordLines.join('\n') });
  fields.push(...buildEndgameFields(snapshot));
  return fields;
}

/** スコア表示と同じ予算管理: 25 フィールド / 全体 6000 字に収め、溢れた分は省略フィールドで示す。 */
function capProgressFields(
  title: string,
  footerText: string,
  fields: GameEmbedField[],
): GameEmbedField[] {
  const capped: GameEmbedField[] = [];
  let usedChars = title.length + footerText.length;
  let omitted = 0;
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index]!;
    const safeField: GameEmbedField = {
      name: truncate(field.name, MAX_EMBED_FIELD_NAME_CHARS),
      value: truncate(field.value, MAX_EMBED_FIELD_VALUE_CHARS),
    };
    const remainingAfter = fields.length - index - 1;
    // 最後の1枠は「ほか N 件」フィールドのために空けておく。
    const fillsLastSlot = capped.length + 1 >= MAX_EMBED_FIELDS && remainingAfter > 0;
    if (
      fillsLastSlot ||
      usedChars + safeField.name.length + safeField.value.length > MAX_EMBED_TOTAL_CHARS
    ) {
      omitted = fields.length - index;
      break;
    }
    capped.push(safeField);
    usedChars += safeField.name.length + safeField.value.length;
  }
  if (omitted > 0) {
    const omissionField: GameEmbedField = {
      name: `…ほか ${omitted} 件の項目`,
      value: '表示しきれない分はWebのマイページで確認してください。',
    };
    if (
      capped.length < MAX_EMBED_FIELDS &&
      usedChars + omissionField.name.length + omissionField.value.length <= MAX_EMBED_TOTAL_CHARS
    ) {
      capped.push(omissionField);
    }
  }
  return capped;
}

export function buildProgressEmbed(result: ProgressResult): GameEmbed {
  const name = gameName(result.gameCode);
  const title = truncate(`🗺️ ${name}の探索度`, MAX_EMBED_TITLE_CHARS);
  if (!result.hasProgress || !result.progress) {
    if (result.progressStatus === 'not_public') {
      return {
        title,
        description: truncate(
          `${name} の戦績はHoYoLABで非公開になっています。HoYoLABの戦績ページの設定で公開をONにすると探索度が表示されるようになります（反映は定期取得のタイミングです）。`,
          MAX_EMBED_DESCRIPTION_CHARS,
        ),
        color: EMBED_COLOR_WARNING,
      };
    }
    return {
      title,
      description: truncate(
        result.progressStatus
          ? `${name} の探索度はまだ取得できていません（状態：${result.progressStatus}）。戦績は定期的に自動取得されるので、時間をおいてからもう一度確認してください。`
          : `${name} の探索度はまだ取得できていません。戦績は定期的に自動取得されるので、時間をおいてからもう一度確認してください。`,
        MAX_EMBED_DESCRIPTION_CHARS,
      ),
      color: EMBED_COLOR_NEUTRAL,
    };
  }
  const snapshot = result.progress;
  const playerParts: string[] = [];
  if (snapshot.player.nickname) playerParts.push(snapshot.player.nickname);
  if (snapshot.player.level !== null) {
    playerParts.push(
      `${result.gameCode === 'starrail' ? '開拓レベル' : '冒険ランク'} ${snapshot.player.level}`,
    );
  }
  const footerText = truncate(
    `UID ${result.uid} ・ 取得：${formatJstDateTime(result.succeededAt ?? result.fetchedAt)}`,
    MAX_EMBED_FOOTER_CHARS,
  );
  const fields = capProgressFields(
    title,
    footerText,
    result.gameCode === 'starrail'
      ? buildStarRailProgressFields(snapshot)
      : buildGenshinProgressFields(snapshot),
  );
  return {
    title,
    ...(playerParts.length > 0
      ? { description: truncate(playerParts.join(' ・ '), MAX_EMBED_DESCRIPTION_CHARS) }
      : {}),
    color: EMBED_COLOR_PRIMARY,
    fields,
    footer: { text: footerText },
  };
}

export function buildUnsupportedProgressEmbed(gameCode: string): GameEmbed {
  return buildNoticeEmbed(
    `${gameName(gameCode)} は探索度（HoYoLAB戦績）の表示に未対応です。対応しているのは原神と崩壊：スターレイルです。`,
    'neutral',
  );
}

// ---------------------------------------------------------------------------
// サーバー内ランキング (#1196 R3)。Web のゲームタブと同じ母集団・軸・
// 計算式を Discord でも見せる。切替はドロップダウン (プラグイン側の
// StringSelectMenu) で行い、ここでは選択状態の型・Embed 生成・選択肢の
// 純粋な組み立てだけを持つ。
// ---------------------------------------------------------------------------

export type RankingSelection = {
  axis: GameRankingAxis;
  characterId: string | null;
  slot: string | null;
  formula: GameRankingFormula;
};

export const RANKING_DEFAULT_SELECTION: RankingSelection = {
  axis: 'character',
  characterId: null,
  slot: null,
  formula: 'cv',
};

/** Discord 表示は上位10件まで (API の既定20件より絞る)。 */
export const RANKING_DISPLAY_LIMIT = 10;

export const RANKING_AXIS_OPTIONS: readonly {
  value: GameRankingAxis;
  label: string;
  description: string;
}[] = [
  { value: 'character', label: 'キャラ別', description: 'キャラクターごとの合計スコア' },
  { value: 'piece', label: '部位別', description: '聖遺物・遺物1部位ごとのスコア' },
  { value: 'formula', label: '計算式別', description: '計算式を変えて集計' },
];

export const RANKING_FORMULA_OPTIONS: readonly {
  value: GameRankingFormula;
  label: string;
  description: string;
}[] = [
  { value: 'cv', label: '会心値 (CV)', description: '会心率×2＋会心ダメージの合計' },
  { value: 'rolls', label: '有効ロール数', description: '有効サブステに乗ったロール数の合計' },
];

export function rankingAxisLabel(axis: GameRankingAxis): string {
  return RANKING_AXIS_OPTIONS.find((option) => option.value === axis)?.label ?? axis;
}

export function rankingFormulaLabel(formula: GameRankingFormula): string {
  return RANKING_FORMULA_OPTIONS.find((option) => option.value === formula)?.label ?? formula;
}

/** API が返すスロットキー (ShowcaseBuildArtifactSlot) の表示名。 */
const RANKING_SLOT_LABELS: Record<string, string> = {
  flower: '花',
  plume: '羽',
  sands: '砂',
  goblet: '杯',
  circlet: '冠',
  head: '頭',
  hands: '腕',
  body: '胴',
  feet: '脚',
  sphere: '球',
  rope: '縄',
  hand: '手部',
  edc: 'EDC',
  edc2: 'EDC 2',
};

export function rankingSlotLabel(slot: string): string {
  const disc = /^disc([1-6])$/.exec(slot);
  if (disc) return `ディスク${disc[1]}`;
  // Slot keys come from the API payload: never resolve them through the
  // prototype chain (a key like "constructor" must stay plain text).
  return Object.hasOwn(RANKING_SLOT_LABELS, slot) ? (RANKING_SLOT_LABELS[slot] as string) : slot;
}

/**
 * 選択状態から ranking アクションの入力を作る。軸に関係ない条件は
 * 送らない (API 側でも軸ごとに意味が変わるため、混ざると表示と
 * 実条件がずれる)。
 */
export function rankingRequestInput(
  gameCode: string,
  selection: RankingSelection,
): GameAccountsRequestInput {
  return {
    action: 'ranking',
    gameCode,
    axis: selection.axis,
    characterId: selection.axis === 'character' ? (selection.characterId ?? undefined) : undefined,
    slot: selection.axis === 'piece' ? (selection.slot ?? undefined) : undefined,
    formula: selection.axis === 'formula' ? selection.formula : undefined,
    limit: RANKING_DISPLAY_LIMIT,
  };
}

type RankingResult = Extract<IvrmGameAccountsResult, { status: 'ok'; action: 'ranking' }>;

/** スコアの表示形。rolls 方式だけは回数表記、それ以外は小数1桁。 */
export function formatRankingScore(result: RankingResult, entry: GameRankingEntry): string {
  if (result.axis === 'formula' && result.formula === 'rolls') return `${entry.score} ロール`;
  return entry.score.toFixed(1);
}

function rankingEntryLine(result: RankingResult, entry: GameRankingEntry): string {
  const character = entry.characterNameJa ?? `キャラクターID ${entry.characterId}`;
  const parts = [`${entry.rank}.`, entry.memberName, '—', character];
  if (result.axis === 'piece' && entry.slot) parts.push(`(${rankingSlotLabel(entry.slot)})`);
  parts.push('・', formatRankingScore(result, entry));
  const line = parts.join(' ');
  return entry.isSelf ? `**${line}**` : line;
}

export function buildRankingEmbed(result: RankingResult, selection: RankingSelection): GameEmbed {
  const name = gameName(result.gameCode);
  const title = truncate(`🏆 ${name}のサーバー内ランキング`, MAX_EMBED_TITLE_CHARS);
  const axisParts = [rankingAxisLabel(selection.axis)];
  if (selection.axis === 'formula') axisParts.push(rankingFormulaLabel(selection.formula));
  if (selection.axis === 'character' && selection.characterId) {
    const character = result.availableCharacters.find(
      (entry) => entry.characterId === selection.characterId,
    );
    axisParts.push(character?.characterNameJa ?? `キャラクターID ${selection.characterId}`);
  }
  if (selection.axis === 'piece' && selection.slot)
    axisParts.push(rankingSlotLabel(selection.slot));
  const descriptionLines = [
    `${axisParts.join(' ・ ')}`,
    `対象は公開設定をONにしたメンバー ${result.populationSize} 人です。`,
  ];
  if (result.entries.length === 0) {
    const emptyLines = [...descriptionLines, 'まだスコア付きのショーケースがありません。'];
    if (!result.viewerInPopulation) {
      emptyLines.push(
        'ランキングに載るには、プロフィールの公開設定で「ゲームアカウント」をONにしてください。',
      );
    }
    return {
      title,
      description: truncate(emptyLines.join('\n'), MAX_EMBED_DESCRIPTION_CHARS),
      color: EMBED_COLOR_NEUTRAL,
      footer: { text: 'Webのゲームタブでも同じランキングが見られます' },
    };
  }
  const fields: GameEmbedField[] = [
    {
      name: '順位',
      value: truncate(
        result.entries.map((entry) => rankingEntryLine(result, entry)).join('\n'),
        MAX_EMBED_FIELD_VALUE_CHARS,
      ),
    },
  ];
  if (result.selfEntries.length > 0) {
    fields.push({
      name: 'あなたの順位',
      value: truncate(
        result.selfEntries
          .slice(0, 5)
          .map((entry) => {
            const piece =
              result.axis === 'piece' && entry.slot ? ` (${rankingSlotLabel(entry.slot)})` : '';
            return `${entry.rank} 位 — ${entry.characterNameJa ?? `キャラクターID ${entry.characterId}`}${piece} ・ ${formatRankingScore(result, entry)}`;
          })
          .join('\n'),
        MAX_EMBED_FIELD_VALUE_CHARS,
      ),
    });
  } else if (!result.viewerInPopulation) {
    fields.push({
      name: 'あなたの順位',
      value:
        'ランキング対象に含まれていません。プロフィールの公開設定で「ゲームアカウント」をONにすると載ります。',
    });
  }
  return {
    title,
    description: truncate(descriptionLines.join('\n'), MAX_EMBED_DESCRIPTION_CHARS),
    color: EMBED_COLOR_PRIMARY,
    fields,
    footer: { text: 'Webのゲームタブでも同じランキングが見られます' },
  };
}

/** キャラ選択ドロップダウンの選択肢 (先頭は「全キャラ」)。上限25件に収める。 */
export function rankingCharacterOptions(
  result: RankingResult,
): { value: string; label: string; description: string }[] {
  const options = [{ value: '', label: '全キャラ', description: 'キャラクターで絞り込まない' }];
  for (const character of result.availableCharacters.slice(0, 24)) {
    options.push({
      value: character.characterId,
      label: character.characterNameJa ?? `キャラクターID ${character.characterId}`,
      description: `${character.memberCount} 人が登録`,
    });
  }
  return options;
}

/** 部位選択ドロップダウンの選択肢 (先頭は「全部位」)。 */
export function rankingSlotOptions(result: RankingResult): { value: string; label: string }[] {
  const options = [{ value: '', label: '全部位' }];
  for (const slot of result.availableSlots.slice(0, 24)) {
    options.push({ value: slot, label: rankingSlotLabel(slot) });
  }
  return options;
}
