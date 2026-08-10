import { describe, expect, it } from 'vitest';
import {
  canManageDailyContentThreads,
  checkDailyContentSendPermissions,
  computeDiscordChannelPermissions,
  DISCORD_ADMINISTRATOR,
  DISCORD_MANAGE_THREADS,
  DISCORD_SEND_MESSAGES,
  DISCORD_SEND_MESSAGES_IN_THREADS,
  DISCORD_VIEW_CHANNEL,
} from './permissions.js';

const guildId = '100000000000000000';
const userId = '200000000000000000';
const roleId = '300000000000000000';

function bits(...values: bigint[]): string {
  return values.reduce((total, value) => total | value, 0n).toString();
}

describe('Discord permission computation', () => {
  it('everyoneとmember roleの権限を合成する', () => {
    const permissions = computeDiscordChannelPermissions({
      guildId,
      member: { userId, roleIds: [roleId] },
      roles: [
        { id: guildId, permissions: DISCORD_VIEW_CHANNEL.toString() },
        { id: roleId, permissions: DISCORD_SEND_MESSAGES.toString() },
      ],
      overwrites: [],
    });
    expect(checkDailyContentSendPermissions(permissions, false)).toEqual(
      expect.objectContaining({ allowed: true, missing: [] }),
    );
  });

  it('role overwriteのdeny後にallowを適用する', () => {
    const permissions = computeDiscordChannelPermissions({
      guildId,
      member: { userId, roleIds: [roleId] },
      roles: [
        {
          id: guildId,
          permissions: bits(DISCORD_VIEW_CHANNEL, DISCORD_SEND_MESSAGES),
        },
        { id: roleId, permissions: '0' },
      ],
      overwrites: [
        {
          id: roleId,
          type: 0,
          allow: DISCORD_SEND_MESSAGES_IN_THREADS.toString(),
          deny: DISCORD_SEND_MESSAGES.toString(),
        },
      ],
    });
    expect(checkDailyContentSendPermissions(permissions, false).missing).toContain('SEND_MESSAGES');
    expect(checkDailyContentSendPermissions(permissions, true).allowed).toBe(true);
  });

  it('member overwriteを最後に適用する', () => {
    const permissions = computeDiscordChannelPermissions({
      guildId,
      member: { userId, roleIds: [roleId] },
      roles: [
        {
          id: guildId,
          permissions: bits(DISCORD_VIEW_CHANNEL, DISCORD_SEND_MESSAGES),
        },
        { id: roleId, permissions: '0' },
      ],
      overwrites: [
        {
          id: userId,
          type: 1,
          allow: '0',
          deny: DISCORD_VIEW_CHANNEL.toString(),
        },
      ],
    });
    expect(checkDailyContentSendPermissions(permissions, false)).toEqual(
      expect.objectContaining({ allowed: false, missing: ['VIEW_CHANNEL'] }),
    );
  });

  it('Administratorはoverwriteをバイパスする', () => {
    const permissions = computeDiscordChannelPermissions({
      guildId,
      member: { userId, roleIds: [] },
      roles: [{ id: guildId, permissions: DISCORD_ADMINISTRATOR.toString() }],
      overwrites: [
        {
          id: guildId,
          type: 0,
          allow: '0',
          deny: bits(DISCORD_VIEW_CHANNEL, DISCORD_SEND_MESSAGES, DISCORD_SEND_MESSAGES_IN_THREADS),
        },
      ],
    });
    expect(checkDailyContentSendPermissions(permissions, false).allowed).toBe(true);
    expect(checkDailyContentSendPermissions(permissions, true).allowed).toBe(true);
  });

  it('Manage ThreadsまたはAdministratorだけがArchived Threadを再開できる', () => {
    expect(canManageDailyContentThreads(DISCORD_MANAGE_THREADS)).toBe(true);
    expect(canManageDailyContentThreads(DISCORD_ADMINISTRATOR)).toBe(true);
    expect(canManageDailyContentThreads(DISCORD_SEND_MESSAGES_IN_THREADS)).toBe(false);
  });
});
