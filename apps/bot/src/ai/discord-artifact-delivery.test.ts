import { describe, expect, it, vi } from 'vitest';
import type { AiArtifact } from '@herta/plugin-catalog/ai-artifact';
import {
  deliverDiscordArtifacts,
  type DiscordArtifactReplyOptions,
} from './discord-artifact-delivery.js';

type ArtifactReply = (options: DiscordArtifactReplyOptions) => Promise<unknown>;

function artifact(content: string): AiArtifact {
  const bytes = new TextEncoder().encode(content);
  return {
    filename: 'fizzbuzz.py',
    mimeType: 'text/x-python',
    bytes,
    size: bytes.byteLength,
    kind: 'code',
  };
}

describe('Discord artifact delivery', () => {
  it('本文は短いsummaryだけにしsource全文はattachmentの正本として保持する', async () => {
    const source = 'for i in range(1, 101):\n    print(i)\n';
    const reply = vi.fn<ArtifactReply>(async () => undefined);

    await deliverDiscordArtifacts({ reply }, [artifact(source)]);

    expect(reply).toHaveBeenCalledTimes(1);
    const payload = reply.mock.calls[0]?.[0];
    expect(payload?.content).toBe('作成しました。`fizzbuzz.py` を添付します。');
    expect(payload?.content).not.toContain(source);
    expect(payload?.allowedMentions).toEqual({ parse: [] });
    expect(payload?.files).toHaveLength(1);
    expect(payload?.files[0]?.name).toBe('fizzbuzz.py');
    expect(payload?.files[0]?.attachment.toString('utf8')).toBe(source);
  });

  it('Discord送信失敗を成功扱いせずcallerへ伝播する', async () => {
    const reply = vi.fn<ArtifactReply>(async () => {
      throw new Error('discord unavailable');
    });

    await expect(deliverDiscordArtifacts({ reply }, [artifact('print(1)')])).rejects.toThrow(
      'discord unavailable',
    );
    expect(reply).toHaveBeenCalledTimes(1);
  });
});
