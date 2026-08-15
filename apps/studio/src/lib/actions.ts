'use server';

import { signIn, signOut } from '@/auth';
import { normalizeDashboardCallbackUrl } from '@/lib/auth-navigation';

/** Discord OAuth ログインを開始する (Server Action) */
export async function signInWithDiscord(formData: FormData): Promise<void> {
  const callbackUrl = normalizeDashboardCallbackUrl(formData.get('callbackUrl'));
  await signIn('discord', { redirectTo: callbackUrl });
}

/** ログアウトして /login へ戻る (Server Action) */
export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: '/login' });
}
