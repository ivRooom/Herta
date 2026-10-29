import { describe, expect, it } from 'vitest';
import { VALORANT_AGENTS } from '@herta/plugin-catalog';
import { pickRandomValorantAgents } from './valorant-random.js';

describe('pickRandomValorantAgents', () => {
  it('公式Agentを重複させず参加者に割り当てる', () => {
    const result = pickRandomValorantAgents(['u3', 'u2', 'u1'], VALORANT_AGENTS, () => 0);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.assignments.map((item) => item.userId)).toEqual(['u1', 'u2', 'u3']);
    expect(new Set(result.assignments.map((item) => item.agent)).size).toBe(3);
    expect(result.assignments.every((item) => VALORANT_AGENTS.some((agent) => agent === item.agent))).toBe(true);
  });

  it('同じユーザーIDの二重登録を1件として扱う', () => {
    const result = pickRandomValorantAgents(['u1', 'u1'], ['Astra'], () => 0);
    expect(result).toEqual({ status: 'ok', assignments: [{ userId: 'u1', agent: 'Astra' }] });
  });

  it('参加者ゼロのとき抽選しない', () => {
    expect(pickRandomValorantAgents([], VALORANT_AGENTS)).toEqual({ status: 'no_participants' });
  });

  it('登録エージェントが参加者より少ない場合は失敗する', () => {
    expect(pickRandomValorantAgents(['u1', 'u2'], ['Astra'])).toEqual({
      status: 'not_enough_agents', required: 2, available: 1,
    });
  });

  it('抽選候補を変更しても入力配列を破壊しない', () => {
    const agents = ['Astra', 'Breach', 'Jett'];
    const copy = [...agents];
    pickRandomValorantAgents(['u1'], agents, () => 0);
    expect(agents).toEqual(copy);
  });

  it('乱数の範囲外は拒否する', () => {
    expect(() => pickRandomValorantAgents(['u1'], ['Astra', 'Jett'], () => 2)).toThrow(RangeError);
  });

  it('Hushを含む公式Agent30名が登録されている', () => {
    expect(VALORANT_AGENTS).toHaveLength(30);
    expect(VALORANT_AGENTS).toContain('Hush');
  });
});
