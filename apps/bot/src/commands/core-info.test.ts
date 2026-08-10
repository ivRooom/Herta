import { describe, expect, it } from 'vitest';
import { coreInformationCommands } from './core-info.js';

const expectedCommandNames = [
  'help',
  'server',
  'userinfo',
  'avatar',
  'botinfo',
  'roleinfo',
  'channelinfo',
  'permissions',
];

describe('coreInformationCommands', () => {
  it('情報系Core Commandを重複なく登録する', () => {
    const names = coreInformationCommands.map((command) => command.definition.name);

    expect(names).toEqual(expectedCommandNames);
    expect(new Set(names).size).toBe(names.length);
  });

  it('DiscordのSlash Command制約内の名前と説明を持つ', () => {
    for (const command of coreInformationCommands) {
      expect(command.definition.name).toMatch(/^[a-z0-9_-]{1,32}$/);
      expect(command.definition.description.length).toBeGreaterThan(0);
      expect(command.definition.description.length).toBeLessThanOrEqual(100);
    }
  });

  it('roleinfoとchannelinfoは対象指定を必須にする', () => {
    const roleInfo = coreInformationCommands.find(
      (command) => command.definition.name === 'roleinfo',
    );
    const channelInfo = coreInformationCommands.find(
      (command) => command.definition.name === 'channelinfo',
    );

    expect(roleInfo?.definition.options?.[0]).toMatchObject({ type: 'role', required: true });
    expect(channelInfo?.definition.options?.[0]).toMatchObject({
      type: 'channel',
      required: true,
    });
  });

  it('userinfo・avatar・permissionsのユーザー指定は任意にする', () => {
    for (const name of ['userinfo', 'avatar', 'permissions']) {
      const command = coreInformationCommands.find(
        (candidate) => candidate.definition.name === name,
      );
      expect(command?.definition.options?.[0]).toMatchObject({ type: 'user' });
      expect(command?.definition.options?.[0]?.required).not.toBe(true);
    }
  });
});
