import { describe, expect, it } from 'vitest';
import {
  buildRoleManagerFinalRoleIds,
  buildRolePanelMessage,
  formatRoleManagerListPages,
  normalizeRoleManagerConfig,
  parseRolePanelCustomId,
  planRoleChange,
  planRoleGroupSelection,
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
        panelStyle: 'select',
        roleIds: ['100', '200', '300'],
      },
    ],
    ...overrides,
  };
}

function makeSingleGroup() {
  return {
    enabled: true,
    id: 'platform',
    name: 'Platform',
    description: null,
    mode: 'single' as const,
    maxSelections: 1,
    panelStyle: 'buttons' as const,
    roleIds: ['100', '200', '300'],
  };
}

describe('roleManagerPlugin', () => {
  it('/roleの5サブコマンドを公開する', () => {
    expect(roleManagerPlugin.manifest.commands[0]?.name).toBe('role');
    expect(roleManagerPlugin.manifest.commands[0]?.subcommands?.map((item) => item.name)).toEqual([
      'list',
      'panel',
      'add',
      'remove',
      'toggle',
    ]);
    expect(roleManagerPlugin.manifest.events).toContain('interactionCreate');
  });

  it('新規Group IDへ重複する固定defaultを持たない', () => {
    const configSchema = roleManagerPlugin.manifest.configSchema as {
      properties?: {
        groups?: { items?: { properties?: { id?: { default?: unknown } } } };
      };
    };
    expect(configSchema.properties?.groups?.items?.properties?.id?.default).toBeUndefined();
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

  it('不正GroupとDiscord IDを除外しPanel既定値をselectにする', () => {
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
    expect(config.groups[0]?.roleIds).toEqual(['100', '200']);
    expect(config.groups[0]?.maxSelections).toBe(2);
    expect(config.groups[0]?.panelStyle).toBe('select');
  });

  it('重複Group IDは後続Groupを除外しRoleのグループ間重複も除去する', () => {
    const config = normalizeRoleManagerConfig({
      groups: [
        { id: 'color', name: '旧Color', roleIds: ['100', '200'] },
        { id: 'color', name: '新Color', roleIds: ['300'] },
        { id: 'game', name: 'Game', roleIds: ['300', '400'] },
      ],
    });
    expect(config.groups.map((group) => group.name)).toEqual(['旧Color', 'Game']);
    expect(config.groups.map((group) => group.id)).toEqual(['color', 'game']);
    expect(config.groups[0]?.roleIds).toEqual(['100', '200']);
    expect(config.groups[1]?.roleIds).toEqual(['300', '400']);
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
    expect(planRoleChange(makeConfig(), [], '999', 'add').accepted).toBe(false);
  });

  it('singleグループでは既存Roleを外して新しいRoleへ切り替える', () => {
    const plan = planRoleChange(makeConfig({ groups: [makeSingleGroup()] }), ['100'], '200', 'add');
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
    expect(
      planRoleChange(makeConfig({ allowSelfRemoval: false }), ['100'], '100', 'remove').accepted,
    ).toBe(false);
  });
});

describe('planRoleGroupSelection', () => {
  it('Select Menuの選択状態へmultipleグループを差分更新する', () => {
    const plan = planRoleGroupSelection(makeConfig(), 'color', ['100', '200'], ['200', '300']);
    expect(plan.accepted).toBe(true);
    expect(plan.addRoleIds).toEqual(['300']);
    expect(plan.removeRoleIds).toEqual(['100']);
  });

  it('設定外Roleと最大選択数超過を拒否する', () => {
    expect(planRoleGroupSelection(makeConfig(), 'color', [], ['999']).accepted).toBe(false);
    expect(planRoleGroupSelection(makeConfig(), 'color', [], ['100', '200', '300']).accepted).toBe(
      false,
    );
  });

  it('singleグループをRole Panelから安全に切り替える', () => {
    const config = makeConfig({ groups: [makeSingleGroup()] });
    const plan = planRoleGroupSelection(config, 'platform', ['100'], ['200']);
    expect(plan.addRoleIds).toEqual(['200']);
    expect(plan.removeRoleIds).toEqual(['100']);
  });

  it('自己解除無効時はPanelの全解除を拒否する', () => {
    const plan = planRoleGroupSelection(
      makeConfig({ allowSelfRemoval: false }),
      'color',
      ['100'],
      [],
    );
    expect(plan.accepted).toBe(false);
  });
});

describe('Role Panel components', () => {
  it('Select Menu Panelと解除Buttonを生成する', () => {
    const message = buildRolePanelMessage(makeConfig().groups[0]!, [
      { id: '100', name: 'Red' },
      { id: '200', name: 'Blue' },
      { id: '300', name: 'Green' },
    ]);
    expect(message.components).toHaveLength(2);
    expect(JSON.stringify(message.components)).toContain('herta:role:v2:select:color');
    expect(JSON.stringify(message.components)).toContain('herta:role:v2:clear:color');
  });

  it('Button Panelは5個ごとにAction Rowを分割する', () => {
    const group = { ...makeSingleGroup(), roleIds: ['1', '2', '3', '4', '5', '6'] };
    const message = buildRolePanelMessage(
      group,
      group.roleIds.map((id) => ({ id, name: `Role ${id}` })),
    );
    expect(message.components).toHaveLength(2);
    expect(JSON.stringify(message.components)).toContain('herta:role:v2:toggle:platform:6');
  });

  it('Custom IDを厳格に解析する', () => {
    expect(parseRolePanelCustomId('herta:role:v2:select:color')).toEqual({
      action: 'select',
      groupId: 'color',
      roleId: null,
    });
    expect(parseRolePanelCustomId('herta:role:v2:toggle:color:100')).toEqual({
      action: 'toggle',
      groupId: 'color',
      roleId: '100',
    });
    expect(parseRolePanelCustomId('herta:role:v2:toggle:INVALID ID:100')).toBeNull();
  });
});

describe('buildRoleManagerFinalRoleIds', () => {
  it('single切替で無関係なRoleを維持しつつ対象Roleだけを置き換える', () => {
    const plan = planRoleChange(makeConfig({ groups: [makeSingleGroup()] }), ['100'], '200', 'add');
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

describe('formatRoleManagerListPages', () => {
  it('Role mention・選択上限・Panel方式を表示する', () => {
    const [text] = formatRoleManagerListPages(makeConfig());
    expect(text).toContain('カラー');
    expect(text).toContain('最大2個');
    expect(text).toContain('Select Menu Panel');
    expect(text).toContain('<@&100>');
  });

  it('大量Roleをmention途中で切らず1900文字以内の複数ページへ分割する', () => {
    const groups = Array.from({ length: 10 }, (_, groupIndex) => ({
      enabled: true,
      id: `group-${groupIndex}`,
      name: `Group ${groupIndex}`,
      description: `Group ${groupIndex} のSelf Role一覧`,
      mode: 'multiple' as const,
      maxSelections: 25,
      panelStyle: 'select' as const,
      roleIds: Array.from({ length: 25 }, (_, roleIndex) =>
        (100000000000000000n + BigInt(groupIndex * 25 + roleIndex)).toString(),
      ),
    }));
    const pages = formatRoleManagerListPages(makeConfig({ groups }));
    const mentions = pages.join('\n').match(/<@&\d+>/g) ?? [];
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.every((page) => page.length <= 1900)).toBe(true);
    expect(mentions).toHaveLength(250);
  });
});
