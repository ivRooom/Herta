'use server';

import { signIn, signOut } from '@/auth';

/** Discord OAuth ログインを開始する (Server Action) */
export async function signInWithDiscord(formData: FormData): Promise<void> {
  const callbackUrl = (formData.get('callbackUrl') as string) || '/dashboard';
  await signIn('discord', { redirectTo: callbackUrl });
}

/** ログアウトして /login へ戻る (Server Action) */
export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: '/login' });
}
