'use client';

import { useEffect, useState } from 'react';

/** コマンドを1文字ずつ入力する。JS無効時・動き低減時は最初から全文を表示する。 */
export function CommandTyper({ text }: { text: string }) {
  const [shown, setShown] = useState(text);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let index = 0;
    let timer = 0;
    setShown('');
    const tick = () => {
      index += 1;
      setShown(text.slice(0, index));
      if (index < text.length) timer = window.setTimeout(tick, 110);
    };
    timer = window.setTimeout(tick, 1400);
    return () => window.clearTimeout(timer);
  }, [text]);

  return (
    <span>
      {shown}
      <span className="lp-caret" aria-hidden="true" />
    </span>
  );
}
