import { describe, expect, it, vi } from 'vitest';
import { HERTA_STUDIO_ROOT_DISCORD_ROLE_ID } from '@herta/shared';
import {
  createGuildRole,
  deleteGuildRole,
  GuildRoleMutationError,
  parseGuildRoleCreateInput,
} from './guild-role-mutations.js';

const GUILD_ID = '123456789012345678';
const ROLE_ID = '223456789012345678';
const OPERATION_ID = '123e4567-e89b-42d3-a456-426614174000';

describe('parseGuildRoleCreateInput', () => {
  it('role名をtrimし安全なcolorだけを受け付ける', () => {
    expect(
      parseGuildRoleCreateInput({
        name: '  Event Role  ',
        color: 0x5865f2,
        operationId: OPERATION_ID,
      }),
    ).toEqual({ name: 'Event Role', color: 0x5865f2, operationId: OPERATION_ID });
    expect(parseGuildRoleCreateInput({ name: '', color: 0, operationId: OPERATION_ID })).toBeNull();
    expect(
      parseGuildRoleCreateInput({ name: 'x', color: 0x1000000, operationId: OPERATION_ID }),
    ).toBeNull();
  });
});

describe('createGuildRole', () => {
  it('Discord Roleを現行colors payload・権限0・非mentionable・非hoistで作成する', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe('POST');
      expect(JSON.parse(String(init?.body))).toEqual({
        name: 'Temporary',
        colors: {
          primary_color: 0x123456,
          secondary_color: null,
          tertiary_color: null,
        },
        permissions: '0',
        hoist: false,
        mentionable: false,
      });
      return new Response(
        JSON.stringify({ id: ROLE_ID, name: 'Temporary', color: 0x123456, managed: false }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const result = await createGuildRole(
      'token',
      GUILD_ID,
      { name: 'Temporary', color: 0x123456, operationId: OPERATION_ID },
      fetchImpl as typeof fetch,
    );
    expect(result.id).toBe(ROLE_ID);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('deleteGuildRole', () => {
  it('Studio root RoleはDiscord APIへ到達する前に拒否する', async () => {
    const fetchImpl = vi.fn();
    await expect(
      deleteGuildRole(
        'token',
        GUILD_ID,
        HERTA_STUDIO_ROOT_DISCORD_ROLE_ID,
        OPERATION_ID,
        fetchImpl as typeof fetch,
      ),
    ).rejects.toMatchObject<Partial<GuildRoleMutationError>>({
      status: 403,
      code: 'protected_role',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('Discord managed Roleを削除しない', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify([{ id: ROLE_ID, name: 'Integration', color: 0, managed: true }]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );
    await expect(
      deleteGuildRole('token', GUILD_ID, ROLE_ID, OPERATION_ID, fetchImpl as typeof fetch),
    ).rejects.toMatchObject<Partial<GuildRoleMutationError>>({ status: 409, code: 'managed_role' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('削除競合でDiscordが404を返しても冪等成功として扱う', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([{ id: ROLE_ID, name: 'Old Role', color: 123, managed: false }]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 404 }));

    await expect(
      deleteGuildRole('token', GUILD_ID, ROLE_ID, OPERATION_ID, fetchImpl as typeof fetch),
    ).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
