import type { CSSProperties } from 'react';

/**
 * 見出しを1文字ずつのspanに分け、ぼかしから順に現れさせる(CSSのみ。JS無効でも表示される)。
 * 読み上げでは分割しないよう、呼び出し側が親に aria-label を付け、こちらは aria-hidden にする。
 */
export function Chars({
  text,
  start = 0,
  className = '',
}: {
  text: string;
  /** この文字列の先頭の通し番号 (行をまたいで遅延をつなぐ) */
  start?: number;
  className?: string;
}) {
  return (
    <>
      {Array.from(text).map((char, offset) => (
        <span
          key={offset}
          aria-hidden="true"
          className={`lp-char ${className}`}
          style={{ '--i': String(start + offset), '--lp-base': '120ms' } as CSSProperties}
        >
          {char}
        </span>
      ))}
    </>
  );
}
