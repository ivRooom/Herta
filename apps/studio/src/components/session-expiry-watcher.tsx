'use client';

import { useEffect } from 'react';

const CHECK_INTERVAL_MS = 5 * 60 * 1000;

/**
 * /dashboardはmiddleware・layoutの双方でサーバー側にセッション切れを検知し/loginへ
 * リダイレクトするが、それはナビゲーション（ページ遷移）が発生した時だけ働く。
 * ページを開いたまま何も操作せずセッション有効期限(8h)を超えたケースをカバーするため、
 * 定期的に/api/auth/sessionを確認し、失効していたら/loginへ強制的に戻す。
 */
export function SessionExpiryWatcher(): null {
  useEffect(() => {
    let cancelled = false;

    const checkSession = async () => {
      try {
        const res = await fetch('/api/auth/session', { cache: 'no-store' });
        if (!res.ok) return;
        const data: unknown = await res.json();
        const hasUser =
          typeof data === 'object' &&
          data !== null &&
          'user' in data &&
          (data as { user?: unknown }).user;
        if (!cancelled && !hasUser) {
          window.location.href = '/login';
        }
      } catch {
        // ネットワーク瞬断等では何もしない。次回のintervalで再確認する。
      }
    };

    const timer = window.setInterval(checkSession, CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
