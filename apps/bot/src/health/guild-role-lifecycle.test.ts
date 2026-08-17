import { describe, expect, it } from 'vitest';
import { STUDIO_ROOT_DISCORD_ROLE_ID } from '@herta/shared';
import {
  GuildRoleLifecycleError,
  assertRoleCanBeDeleted,
  parseGuildRoleCreateInput,
} from './guild-role-lifecycle.js';

describe('guild role lifecycle', () => {
  it('validates safe role creation fields', () => {
    expect(
      parseGuildRoleCreateInput({ name: ' Event ', color: 0xff00aa, hoist: false, mentionable: true }),
    ).toEqual({ name: 'Event', color: 0xff00aa, hoist: false, mentionable: true });
    expect(parseGuildRoleCreateInput({ name: '', color: 0, hoist: false, mentionable: false })).toBeNull();
    expect(parseGuildRoleCreateInput({ name: 'x'.repeat(101), color: 0, hoist: false, mentionable: false })).toBeNull();
    expect(parseGuildRoleCreateInput({ name: 'Role', color: 0x1000000, hoist: false, mentionable: false })).toBeNull();
    expect(parseGuildRoleCreateInput({ name: 'Role', color: 0, hoist: 'false', mentionable: false })).toBeNull();
  });

  it('protects everyone, root, managed and non-editable roles', () => {
    const guildId = '123456789012345678';
    for (const candidate of [
      { id: guildId, guildId, managed: false, editable: true },
      { id: STUDIO_ROOT_DISCORD_ROLE_ID, guildId, managed: false, editable: true },
      { id: '234567890123456789', guildId, managed: true, editable: true },
      { id: '345678901234567890', guildId, managed: false, editable: false },
    ]) {
      expect(() => assertRoleCanBeDeleted(candidate)).toThrow(GuildRoleLifecycleError);
    }
  });

  it('allows deletion of an editable unmanaged role below the bot', () => {
    expect(() =>
      assertRoleCanBeDeleted({
        id: '234567890123456789',
        guildId: '123456789012345678',
        managed: false,
        editable: true,
      }),
    ).not.toThrow();
  });
});
