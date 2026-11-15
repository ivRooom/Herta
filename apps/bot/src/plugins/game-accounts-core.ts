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
  /** Enka ショーケース取得に対応しているか (鳴潮・NTE は UID 登録のみ)。 */
  showcaseSupported: boolean;
}

export const GAME_DEFINITIONS: readonly GameDefinition[] = [
  { code: 'genshin', name: '原神', showcaseSupported: true },
  { code: 'starrail', name: '崩壊：スターレイル', showcaseSupported: true },
  { code: 'zzz', name: 'ゼンレスゾーンゼロ', showcaseSupported: true },
  { code: 'endfield', name: 'アークナイツ：エンドフィールド', showcaseSupported: true },
  { code: 'wuthering', name: '鳴潮', showcaseSupported: false },
  { code: 'nte', name: 'NTE', showcaseSupported: false },
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

export function formatRolls(rolls: Record<string, number>): string {
  const entries = Object.entries(rolls)
    .filter(([, count]) => count > 0)
    .sort(
      (a, b) =>
        b[1] - a[1] ||
        (ROLL_STAT_PRIORITY[a[0]] ?? 2) - (ROLL_STAT_PRIORITY[b[0]] ?? 2) ||
        a[0].localeCompare(b[0]),
    );
  if (entries.length === 0) return '有効ロールなし';
  return entries.map(([stat, count]) => `${ROLL_STAT_LABELS[stat] ?? stat}×${count}`).join('・');
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

export function formatLinkSuccess(
  result: Extract<IvrmGameAccountsResult, { status: 'ok'; action: 'link' }>,
): string {
  const name = gameName(result.account.gameCode);
  const lines = [
    `✅ ${name} のUID（${result.account.uid}）を登録しました。Webのマイページにも反映されます。`,
  ];
  if (!isShowcaseSupported(result.account.gameCode)) {
    lines.push('このタイトルはショーケース取得に未対応のため、UIDの登録のみ行いました。');
  } else if (result.showcase.status === 'ok' && result.showcase.fetchedAt) {
    lines.push(`ショーケースを取得しました（${formatJstDateTime(result.showcase.fetchedAt)}）。`);
  } else {
    lines.push(
      `ショーケースはまだ取得できていません（状態：${result.showcase.status}）。時間をおいて /game score で確認してください。`,
    );
  }
  return lines.join('\n');
}

export function formatUnlinkSuccess(gameCode: string): string {
  return `🗑️ ${gameName(gameCode)} のUID登録を解除しました。Webのマイページにも反映されます。`;
}

function formatListEntry(account: GameAccountListEntry): string {
  const name = gameName(account.gameCode);
  if (!isShowcaseSupported(account.gameCode))
    return `・${name}：UID ${account.uid}（ショーケース未対応）`;
  if (account.showcaseFetchedAt)
    return `・${name}：UID ${account.uid}（最終同期：${formatJstDateTime(account.showcaseFetchedAt)}）`;
  return `・${name}：UID ${account.uid}（最終同期：未取得）`;
}

export function formatListMessage(
  result: Extract<IvrmGameAccountsResult, { status: 'ok'; action: 'list' }>,
): string {
  if (result.accounts.length === 0)
    return `登録済みのゲームアカウントはありません。/game link で登録するか、${MEMBER_GAME_ACCOUNTS_URL} のマイページから登録してください。`;
  return [
    '🎮 登録済みのゲームアカウント（Webと同期）',
    ...result.accounts.map(formatListEntry),
  ].join('\n');
}

function formatCharacterScore(character: ShowcaseCharacterScore): string[] {
  const label = character.name ?? `キャラクターID ${character.id}`;
  if (!character.artifactScore) return [`${label} Lv.${character.level} — スコアなし`];
  const lines = [
    `${label} Lv.${character.level} — スコア ${character.artifactScore.total.toFixed(1)}`,
  ];
  character.artifactScore.perPiece.forEach((piece, index) => {
    lines.push(`　${index + 1}. CV ${piece.cv.toFixed(1)}（${formatRolls(piece.rolls)}）`);
  });
  return lines;
}

const MAX_MESSAGE_CHARS = 1900;

export function formatScoreMessage(
  result: Extract<IvrmGameAccountsResult, { status: 'ok'; action: 'score' }>,
): string {
  const name = gameName(result.gameCode);
  if (!result.hasSnapshot || result.characters.length === 0)
    return `${name} のショーケースはまだ取得できていません（状態：${result.showcaseStatus ?? '未取得'}）。/game link で登録し直すか、${MEMBER_GAME_ACCOUNTS_URL} のマイページで同期してください。`;
  const lines = [
    `🎮 ${name} の聖遺物スコア（UID ${result.uid}）`,
    `取得：${formatJstDateTime(result.fetchedAt)}`,
  ];
  let omitted = 0;
  for (const character of result.characters) {
    const characterLines = formatCharacterScore(character);
    if (lines.join('\n').length + characterLines.join('\n').length + 1 > MAX_MESSAGE_CHARS) {
      omitted += 1;
      continue;
    }
    lines.push(...characterLines);
  }
  if (omitted > 0) lines.push(`…ほか ${omitted} 件は省略しました。`);
  return lines.join('\n');
}

export function formatUnsupportedScoreMessage(gameCode: string): string {
  return `${gameName(gameCode)} はショーケース取得に未対応のため、スコアを表示できません。UIDの登録・確認は /game list を使ってください。`;
}
