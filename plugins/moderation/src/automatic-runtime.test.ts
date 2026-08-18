import { describe, expect, it, vi } from 'vitest';
import {
  executeAutomaticDiscordAction,
  isAutomaticActionBlockedForGuildOwner,
} from './automatic-runtime.js';
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

// Guild Ownerにはメッセージ単位の対応を許可し、member自体を変更する処罰だけを保護する。
describe('automatic moderation Guild Owner protection', () => {
  it.each(['observe', 'warn', 'delete', 'warn_delete'] as const)(
    '%s はGuild Ownerでも実行対象にできる',
    (action) => {
      expect(isAutomaticActionBlockedForGuildOwner(action)).toBe(false);
    },
  );

  it.each(['timeout', 'role', 'blacklist', 'kick', 'ban'] as const)(
    '%s はGuild Ownerへの自動処罰として拒否する',
    (action) => {
      expect(isAutomaticActionBlockedForGuildOwner(action)).toBe(true);
    },
  );
});

describe('automatic moderation Discord action', () => {
  it('危険度mediumかつAction=deleteで検知メッセージを削除する', async () => {
    const deleteMessage = vi.fn(async () => undefined);
    const message = {
      delete: deleteMessage,
      member: null,
      author: { send: vi.fn(async () => undefined) },
    };

    const result = await executeAutomaticDiscordAction(
      message as never,
      BASE_POLICY,
      'test reason',
    );
    expect(deleteMessage).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ outcome: 'executed', discordErrorCode: null });
  });

  it('Discord 10008 Unknown Messageは既に削除済みとして冪等成功にする', async () => {
    const message = {
      delete: vi.fn(async () => {
        throw Object.assign(new Error('Unknown Message'), { code: 10008, status: 404 });
      }),
      member: null,
      author: { send: vi.fn(async () => undefined) },
    };

    const result = await executeAutomaticDiscordAction(
      message as never,
      BASE_POLICY,
      'test reason',
    );
    expect(result).toEqual({ outcome: 'already_satisfied', discordErrorCode: 10008 });
  });

  it('Unknown Message以外のDiscord削除失敗は握り潰さない', async () => {
    const error = Object.assign(new Error('Missing Permissions'), { code: 50013, status: 403 });
    const message = {
      delete: vi.fn(async () => {
        throw error;
      }),
      member: null,
      author: { send: vi.fn(async () => undefined) },
    };

    await expect(
      executeAutomaticDiscordAction(message as never, BASE_POLICY, 'test reason'),
    ).rejects.toBe(error);
  });

  it('warn_deleteでは既に削除済みでも警告DMを送る', async () => {
    const calls: string[] = [];
    const message = {
      delete: vi.fn(async () => {
        calls.push('delete');
        throw Object.assign(new Error('Unknown Message'), { code: '10008', status: 404 });
      }),
      member: null,
      author: {
        send: vi.fn(async () => {
          calls.push('warn');
        }),
      },
    };

    const result = await executeAutomaticDiscordAction(
      message as never,
      { ...BASE_POLICY, action: 'warn_delete' },
      'test reason',
    );
    expect(calls).toEqual(['delete', 'warn']);
    expect(result).toEqual({ outcome: 'already_satisfied', discordErrorCode: 10008 });
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
