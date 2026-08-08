import { describe, expect, it, vi } from 'vitest';
import { executeAutomaticDiscordAction } from './automatic-runtime.js';
import type { AutomaticEnforcementPolicy } from './enforcement-config.js';

const BASE_POLICY: AutomaticEnforcementPolicy = {
  selector: 'invite_link',
  action: 'delete',
  severity: 'medium',
  timeoutMinutes: 10,
  roleId: null,
  warningMessage: null,
  banDeleteMessageSeconds: 0,
};

describe('automatic moderation Discord action', () => {
  it('危険度mediumかつAction=deleteで検知メッセージを削除する', async () => {
    const deleteMessage = vi.fn(async () => undefined);
    const message = {
      delete: deleteMessage,
      member: null,
      author: { send: vi.fn(async () => undefined) },
    };

    await executeAutomaticDiscordAction(message as never, BASE_POLICY, 'test reason');
    expect(deleteMessage).toHaveBeenCalledTimes(1);
  });

  it('warn_deleteでは削除後に警告DMを送る', async () => {
    const calls: string[] = [];
    const message = {
      delete: vi.fn(async () => {
        calls.push('delete');
      }),
      member: null,
      author: {
        send: vi.fn(async () => {
          calls.push('warn');
        }),
      },
    };

    await executeAutomaticDiscordAction(
      message as never,
      { ...BASE_POLICY, action: 'warn_delete' },
      'test reason',
    );
    expect(calls).toEqual(['delete', 'warn']);
  });
});
