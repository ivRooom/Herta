import type { AiArtifact } from '@herta/plugin-catalog/ai-artifact';
import { describe, expect, it, vi } from 'vitest';
import {
  deliverDiscordArtifacts,
  type DiscordArtifactReplyOptions,
} from './discord-artifact-delivery.js';

type ArtifactReply = (options: DiscordArtifactReplyOptions) => Promise<unknown>;

function imageArtifact(): AiArtifact {
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return {
    filename: 'generated-image.png',
    mimeType: 'image/png',
    bytes,
    size: bytes.byteLength,
    kind: 'image',
    metadata: { width: 64, height: 64, pixels: 4096 },
  };
}

describe('Discord image artifact delivery', () => {
  it('validated image bytesをURLではなくDiscord attachmentとして渡す', async () => {
    const reply = vi.fn<ArtifactReply>(async () => undefined);
    await deliverDiscordArtifacts({ reply }, [imageArtifact()]);

    const payload = reply.mock.calls[0]?.[0];
    expect(payload?.files).toHaveLength(1);
    expect(payload?.files[0]?.name).toBe('generated-image.png');
    expect(payload?.files[0]?.attachment).toEqual(Buffer.from(imageArtifact().bytes));
    expect(payload?.content).not.toContain('http://');
    expect(payload?.content).not.toContain('https://');
  });

  it('Discord attachment送信失敗をcallerへ伝播し成功扱いにしない', async () => {
    const reply = vi.fn<ArtifactReply>(async () => {
      throw new Error('discord attachment failed');
    });
    await expect(deliverDiscordArtifacts({ reply }, [imageArtifact()])).rejects.toThrow(
      'discord attachment failed',
    );
  });
});
