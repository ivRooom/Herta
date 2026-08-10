import { describe, expect, it } from 'vitest';
import {
  buildRoleManagerFinalRoleIds,
  formatRoleManagerList,
  normalizeRoleManagerConfig,
  planRoleChange,
  roleManagerPlugin,
  withRoleManagerMemberLock,
  type RoleManagerConfig,
} from './role-manager.js';

function makeConfig(overrides: Partial<RoleManagerConfig> = {}): RoleManagerConfig {
  return {
    enabled: true,
    ephemeralResponses: true,
    allowSelfRemoval: true,
    groups: [
      {
        enabled: true,
        id: 'color',
        name: 'カラー',
        description: null,
        mode: 'multiple',
        maxSelections: 2,
        roleIds: ['100', '200', '300'],
      },
    ],
    ...overrides,
  };
}

describe('roleManagerPlugin', () => {
  it('/roleの4サブコマンドを公開する', () => {
    expect(roleManagerPlugin.manifest.commands[0]?.name).toBe('role');
    expect(roleManagerPlugin.manifest.commands[0]?.subcommands?.map((item) => item.name)).toEqual([
      'list',
      'add',
      'remove',
      'toggle',
    ]);
  });
});

describe('normalizeRoleManagerConfig', () => {
  it('安全な既定値を補完する', () => {
    expect(normalizeRoleManagerConfig({})).toEqual({
      enabled: true,
      ephemeralResponses: true,
      allowSelfRemoval: true,
      groups: [],
    });
  });

  it('不正GroupとDiscord IDを除外する', () => {
    const config = normalizeRoleManagerConfig({
      groups: [
        { id: 'INVALID ID', name: '無効', roleIds: ['100'] },
        {
          id: 'games',
          name: 'Games',
          mode: 'multiple',
          maxSelections: 99,
          roleIds: ['100', 'abc', '100', '200'],
        },
      ],
    });

    expect(config.groups).toHaveLength(1);
    expect(config.groups[0]?.id).toBe('games');
    expect(config.groups[0]?.roleIds).toEqual(['100', '200']);
    expect(config.groups[0]?.maxSelections).toBe(2);
  });

  it('同一Group IDは後ろを優先し、Roleのグループ間重複を除去する', () => {
    const config = normalizeRoleManagerConfig({
      groups: [
        { id: 'color', name: '旧Color', roleIds: ['100', '200'] },
        { id: 'color', name: '新Color', roleIds: ['300'] },
        { id: 'game', name: 'Game', roleIds: ['300', '400'] },
      ],
    });

    expect(config.groups.map((group) => group.name)).toEqual(['新Color', 'Game']);
    expect(config.groups[0]?.roleIds).toEqual(['300']);
    expect(config.groups[1]?.roleIds).toEqual(['400']);
  });

  it('singleグループはmaxSelectionsを1に固定する', () => {
    const config = normalizeRoleManagerConfig({
      groups: [
        {
          id: 'platform',
          name: 'Platform',
          mode: 'single',
          maxSelections: 20,
          roleIds: ['100', '200'],
        },
      ],
    });

    expect(config.groups[0]?.maxSelections).toBe(1);
  });
});

describe('planRoleChange', () => {
  it('許可されていないRoleを拒否する', () => {
    const plan = planRoleChange(makeConfig(), [], '999', 'add');

    expect(plan.accepted).toBe(false);
    expect(plan.changed).toBe(false);
  });

  it('singleグループでは既存Roleを外して新しいRoleへ切り替える', () => {
    const config = makeConfig({
      groups: [
        {
          enabled: true,
          id: 'platform',
          name: 'Platform',
          description: null,
          mode: 'single',
          maxSelections: 1,
          roleIds: ['100', '200', '300'],
        },
      ],
    });
    const plan = planRoleChange(config, ['100'], '200', 'add');

    expect(plan.accepted).toBe(true);
    expect(plan.addRoleIds).toEqual(['200']);
    expect(plan.removeRoleIds).toEqual(['100']);
  });

  it('multipleグループの最大選択数を超える追加を拒否する', () => {
    const plan = planRoleChange(makeConfig(), ['100', '200'], '300', 'add');

    expect(plan.accepted).toBe(false);
    expect(plan.message).toContain('最大2個');
  });

  it('toggleは現在の付与状態に応じて追加と解除を切り替える', () => {
    expect(planRoleChange(makeConfig(), [], '100', 'toggle').addRoleIds).toEqual(['100']);
    expect(planRoleChange(makeConfig(), ['100'], '100', 'toggle').removeRoleIds).toEqual(['100']);
  });

  it('自己解除が無効な場合はremoveを拒否する', () => {
    const config = makeConfig({ allowSelfRemoval: false });
    const plan = planRoleChange(config, ['100'], '100', 'remove');

    expect(plan.accepted).toBe(false);
    expect(plan.changed).toBe(false);
  });

  it('すでに付与済みのRole追加はno-opにする', () => {
    const plan = planRoleChange(makeConfig(), ['100'], '100', 'add');

    expect(plan.accepted).toBe(true);
    expect(plan.changed).toBe(false);
  });
});

describe('buildRoleManagerFinalRoleIds', () => {
  it('single切替で無関係なRoleを維持しつつ対象Roleだけを置き換える', () => {
    const plan = planRoleChange(
      makeConfig({
        groups: [
          {
            enabled: true,
            id: 'platform',
            name: 'Platform',
            description: null,
            mode: 'single',
            maxSelections: 1,
            roleIds: ['100', '200'],
          },
        ],
      }),
      ['100'],
      '200',
      'add',
    );

    expect(buildRoleManagerFinalRoleIds(['guild', '100', '900'], 'guild', plan)).toEqual([
      '900',
      '200',
    ]);
  });
});

describe('withRoleManagerMemberLock', () => {
  it('同一Guild・UserのRole更新を直列化する', async () => {
    const order: string[] = [];
    let signalFirstStarted!: () => void;
    let releaseFirst!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      signalFirstStarted = resolve;
    });
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = withRoleManagerMemberLock('guild', 'user', async () => {
      order.push('first-start');
      signalFirstStarted();
      await firstGate;
      order.push('first-end');
    });
    await firstStarted;

    const second = withRoleManagerMemberLock('guild', 'user', async () => {
      order.push('second-start');
    });
    await Promise.resolve();
    expect(order).toEqual(['first-start']);

    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(['first-start', 'first-end', 'second-start']);
  });
});

describe('formatRoleManagerList', () => {
  it('Role mentionと選択上限を表示する', () => {
    const text = formatRoleManagerList(makeConfig());

    expect(text).toContain('カラー');
    expect(text).toContain('最大2個');
    expect(text).toContain('<@&100>');
    expect(text).toContain('<@&300>');
  });
});
