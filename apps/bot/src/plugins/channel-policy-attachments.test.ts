import { describe, expect, it } from 'vitest';
import { evaluateChannelPolicyMessage, type ChannelPolicyRule } from './channel-policy.js';

function makeImagesOnlyRule(): ChannelPolicyRule {
  return {
    enabled: true,
    channelId: '1234567890',
    mode: 'images_only',
    action: 'log_only',
    allowCaption: true,
    allowStickers: false,
    includeThreads: true,
    exemptRoleIds: [],
    exemptUserIds: [],
    warningMessage: null,
  };
}

function evaluateAttachment(contentType: string | null, name: string) {
  const attachments = [{ contentType, name }];
  return evaluateChannelPolicyMessage(
    {
      content: '',
      attachments: {
        size: attachments.length,
        values: () => attachments.values(),
      },
      stickers: { size: 0 },
    },
    makeImagesOnlyRule(),
  );
}

describe('Channel Policy attachment classification', () => {
  it('明確な非画像MIMEは画像拡張子でも拒否する', () => {
    expect(evaluateAttachment('application/pdf', 'document.png').allowed).toBe(false);
  });

  it('MIMEがない場合は拡張子へfallbackする', () => {
    expect(evaluateAttachment(null, 'photo.png').allowed).toBe(true);
  });

  it('generic MIMEの場合は拡張子へfallbackする', () => {
    expect(evaluateAttachment('application/octet-stream', 'photo.webp').allowed).toBe(true);
  });
});
