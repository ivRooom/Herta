const URL_PATTERN = /https?:\/\/\S+/gi;
const CUSTOM_EMOJI_PATTERN = /<a?:\w+:\d+>/g;
const EXTENDED_PICTOGRAPHIC_PATTERN = /\p{Extended_Pictographic}/gu;
const HALF_WIDTH_PATTERN = /^[\x00-\x7f]$/;

/**
 * メッセージ本文から「文字ポイント」を算出する。半角(ASCII)文字=1unit(0.5pt)、
 * それ以外(日本語・全角記号等)=2unit(1pt)として、unit(整数)で返す
 * (community_activity_dailyのvalueはBigIntのため小数を避け、表示側でunit/2へ変換する)。
 * URL・Discordカスタム絵文字・Unicode絵文字・空白は「打鍵量」の実感と合わないため集計から除外する。
 */
export function computeCharScoreUnits(content: string): number {
  const stripped = content
    .replace(URL_PATTERN, ' ')
    .replace(CUSTOM_EMOJI_PATTERN, ' ')
    .replace(EXTENDED_PICTOGRAPHIC_PATTERN, ' ');

  let units = 0;
  for (const char of stripped) {
    if (/\s/u.test(char)) continue;
    units += HALF_WIDTH_PATTERN.test(char) ? 1 : 2;
  }
  return units;
}

/** 表示用: unitからptへ変換（小数第1位まで）。 */
export function charScoreUnitsToPoints(units: number): number {
  return Math.round((units / 2) * 10) / 10;
}
