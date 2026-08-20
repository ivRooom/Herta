import { describe, expect, it } from 'vitest';
import { moderationManifest } from './manifest.js';

function subcommand(name: string) {
  return moderationManifest.commands[0]?.subcommands?.find((item) => item.name === name);
}

describe('Moderation case lifecycle command manifest', () => {
  it('untimeoutを対象・理由必須で公開する', () => {
    expect(subcommand('untimeout')?.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'user', type: 'user', required: true }),
        expect.objectContaining({ name: 'reason', type: 'string', required: true }),
      ]),
    );
  });

  it('case-statusは編集可能な3状態だけを公開する', () => {
    const status = subcommand('case-status')?.options?.find((option) => option.name === 'status');
    expect(status).toMatchObject({ type: 'string', required: true });
    expect(status?.choices).toEqual([
      { name: '有効', value: 'active' },
      { name: '完了', value: 'completed' },
      { name: '解除済み', value: 'revoked' },
    ]);
  });
});
