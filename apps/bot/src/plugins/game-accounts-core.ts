import type {
  GameAccountListEntry,
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

export function buildUnsupportedScoreEmbed(gameCode: string): GameEmbed {
  return buildNoticeEmbed(
    `${gameName(gameCode)} はショーケース取得に未対応のため、スコアを表示できません。UIDの登録・確認は /game list を使ってください。`,
    'neutral',
  );
}
