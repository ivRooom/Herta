import { describe, expect, it } from 'vitest';
import { createLfgComponentId, parseLfgComponentId } from './component-id.js';

const secret = '12345678901234567890123456789012';
const postId = '11111111-1111-4111-8111-111111111111';

describe('LFG component customId', () => {
  it('署名付きIDを生成・検証する', () => {
    const value = createLfgComponentId('join', postId, secret);
    expect(parseLfgComponentId(value, secret)).toEqual({ action: 'join', postId });
    expect(value.length).toBeLessThanOrEqual(100);
  });

  it('action・postId・署名の改ざんを拒否する', () => {
    const value = createLfgComponentId('leave', postId, secret);
    expect(parseLfgComponentId(value.replace(':leave:', ':join:'), secret)).toBeNull();
    expect(
      parseLfgComponentId(value.replace(postId, '22222222-2222-4222-8222-222222222222'), secret),
    ).toBeNull();
    expect(parseLfgComponentId(`${value.slice(0, -1)}x`, secret)).toBeNull();
  });

  it('短いsecretを拒否する', () => {
    expect(() => createLfgComponentId('join', postId, 'short')).toThrow();
    expect(parseLfgComponentId('lfg:join:test:signature', 'short')).toBeNull();
  });
});
