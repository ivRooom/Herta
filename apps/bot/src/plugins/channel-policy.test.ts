import { afterEach, describe, expect, it } from 'vitest';
import {
  channelPolicyMessageContentIntentEnabled,
  evaluateChannelPolicyMessage,
  findChannelPolicyRule,
  normalizeChannelPolicyConfig,
  resetChannelPolicyRuntime,
  shouldSendChannelPolicyWarning,
  type ChannelPolicyRule,
} from './channel-policy.js';

type Attachment = { contentType?: string | null; name?: string | null };

function makeMessage(content = '', attachments: Attachment[] = [], stickerCount = 0) {
  return {
    content,
    attachments: {
      size: attachments.length,
      values: () => attachments.values(),
    },
    stickers: { size: stickerCount },
  };
}

function makeRule(overrides: Partial<ChannelPolicyRule> = {}): ChannelPolicyRule {
  return {
    enabled: true,
    channelId: '1234567890',
    mode: 'commands_only',
    action: 'warn_delete',
    allowCaption: true,
    allowStickers: false,
    includeThreads: true,
    exemptRoleIds: [],
    exemptUserIds: [],
    warningMessage: null,
    ...overrides,
  };
}

afterEach(() => {
  resetChannelPolicyRuntime();
});

describe('channelPolicyMessageContentIntentEnabled', () => {
  it('trueまたは1だけを有効として扱う', () => {
    expect(channelPolicyMessageContentIntentEnabled('true')).toBe(true);
    expect(channelPolicyMessageContentIntentEnabled(' 1 ')).toBe(true);
    expect(channelPolicyMessageContentIntentEnabled('false')).toBe(false);
    expect(channelPolicyMessageContentIntentEnabled(undefined)).toBe(false);
  });
});

describe('normalizeChannelPolicyConfig', () => {
  it('既定値を補完する', () => {
    expect(normalizeChannelPolicyConfig({})).toEqual({
      enabled: true,
      warningCooldownSeconds: 15,
      defaultWarningMessage:
        '{user} このチャンネルでは `{mode}` ルールが有効です。投稿内容を確認してください。',
      rules: [],
    });
  });

  it('同一チャンネルの重複は後ろのルールを優先する', () => {
    const config = normalizeChannelPolicyConfig({
      rules: [
        { channelId: '100', mode: 'text_only', action: 'log_only' },
        { channelId: '100', mode: 'images_only', action: 'delete' },
      ],
    });

    expect(config.rules).toHaveLength(1);
    expect(config.rules[0]?.mode).toBe('images_only');
    expect(config.rules[0]?.action).toBe('delete');
  });

  it('不正なIDと上限外Cooldownを正規化する', () => {
    const config = normalizeChannelPolicyConfig({
      warningCooldownSeconds: 99999,
      rules: [{ channelId: 'abc', mode: 'text_only' }],
    });

    expect(config.warningCooldownSeconds).toBe(3600);
    expect(config.rules).toEqual([]);
  });
});

describe('findChannelPolicyRule', () => {
  it('直接指定されたチャンネルをスレッド親より優先する', () => {
    const parent = makeRule({ channelId: '10', mode: 'media_only' });
    const direct = makeRule({ channelId: '20', mode: 'text_only' });
    const config = normalizeChannelPolicyConfig({ rules: [parent, direct] });

    expect(findChannelPolicyRule(config, '20', '10', true)?.mode).toBe('text_only');
  });

  it('ThreadかつincludeThreads=trueなら親チャンネルのルールを継承する', () => {
    const config = normalizeChannelPolicyConfig({
      rules: [makeRule({ channelId: '10', mode: 'images_only', includeThreads: true })],
    });

    expect(findChannelPolicyRule(config, '20', '10', true)?.mode).toBe('images_only');
  });

  it('通常チャンネルのCategory parentIdからルールを継承しない', () => {
    const config = normalizeChannelPolicyConfig({
      rules: [makeRule({ channelId: '10', mode: 'images_only', includeThreads: true })],
    });

    expect(findChannelPolicyRule(config, '20', '10', false)).toBeNull();
  });

  it('ThreadでもincludeThreads=falseなら親ルールを継承しない', () => {
    const config = normalizeChannelPolicyConfig({
      rules: [makeRule({ channelId: '10', mode: 'images_only', includeThreads: false })],
    });

    expect(findChannelPolicyRule(config, '20', '10', true)).toBeNull();
  });
});

describe('evaluateChannelPolicyMessage', () => {
  it('commands_onlyでは通常メッセージを拒否する', () => {
    expect(evaluateChannelPolicyMessage(makeMessage('/help'), makeRule()).allowed).toBe(false);
  });

  it('media_onlyでは画像・動画を許可し、それ以外の添付を拒否する', () => {
    const rule = makeRule({ mode: 'media_only' });

    expect(
      evaluateChannelPolicyMessage(
        makeMessage('caption', [{ contentType: 'image/png', name: 'image.png' }]),
        rule,
      ).allowed,
    ).toBe(true);
    expect(
      evaluateChannelPolicyMessage(
        makeMessage('', [{ contentType: 'application/pdf', name: 'document.pdf' }]),
        rule,
      ).allowed,
    ).toBe(false);
  });

  it('contentTypeがない画像・動画も拡張子から判定する', () => {
    expect(
      evaluateChannelPolicyMessage(
        makeMessage('', [{ contentType: null, name: 'photo.WEBP' }]),
        makeRule({ mode: 'images_only' }),
      ).allowed,
    ).toBe(true);
    expect(
      evaluateChannelPolicyMessage(
        makeMessage('', [{ contentType: null, name: 'clip.MP4' }]),
        makeRule({ mode: 'videos_only' }),
      ).allowed,
    ).toBe(true);
  });

  it('allowCaption=falseではメディア付き本文を拒否する', () => {
    const result = evaluateChannelPolicyMessage(
      makeMessage('説明文', [{ contentType: 'image/jpeg', name: 'photo.jpg' }]),
      makeRule({ mode: 'images_only', allowCaption: false }),
    );

    expect(result.allowed).toBe(false);
  });

  it('media_onlyでは明示設定時だけSticker単独投稿を許可する', () => {
    const message = makeMessage('', [], 1);

    expect(
      evaluateChannelPolicyMessage(message, makeRule({ mode: 'media_only', allowStickers: true }))
        .allowed,
    ).toBe(true);
    expect(
      evaluateChannelPolicyMessage(message, makeRule({ mode: 'media_only', allowStickers: false }))
        .allowed,
    ).toBe(false);
  });

  it('text_onlyでは添付のない本文だけを許可する', () => {
    const rule = makeRule({ mode: 'text_only' });

    expect(evaluateChannelPolicyMessage(makeMessage('hello'), rule).allowed).toBe(true);
    expect(
      evaluateChannelPolicyMessage(
        makeMessage('hello', [{ contentType: 'image/png', name: 'a.png' }]),
        rule,
      ).allowed,
    ).toBe(false);
  });

  it('links_onlyではHTTP(S)リンクだけの本文を許可する', () => {
    const rule = makeRule({ mode: 'links_only' });

    expect(evaluateChannelPolicyMessage(makeMessage('https://example.com'), rule).allowed).toBe(
      true,
    );
    expect(evaluateChannelPolicyMessage(makeMessage('<https://example.com>'), rule).allowed).toBe(
      true,
    );
    expect(
      evaluateChannelPolicyMessage(makeMessage('おすすめ https://example.com'), rule).allowed,
    ).toBe(false);
  });

  it('no_linksではHTTP(S)リンクを拒否する', () => {
    const rule = makeRule({ mode: 'no_links' });

    expect(evaluateChannelPolicyMessage(makeMessage('通常テキスト'), rule).allowed).toBe(true);
    expect(
      evaluateChannelPolicyMessage(makeMessage('https://example.com/path?q=1'), rule).allowed,
    ).toBe(false);
  });
});

describe('shouldSendChannelPolicyWarning', () => {
  it('同一Guild・Channel・Userの警告をCooldownする', () => {
    expect(shouldSendChannelPolicyWarning('g', 'c', 'u', 10, 1000)).toBe(true);
    expect(shouldSendChannelPolicyWarning('g', 'c', 'u', 10, 5000)).toBe(false);
    expect(shouldSendChannelPolicyWarning('g', 'c', 'u', 10, 11000)).toBe(true);
  });

  it('Cooldown 0では毎回警告できる', () => {
    expect(shouldSendChannelPolicyWarning('g', 'c', 'u', 0, 1000)).toBe(true);
    expect(shouldSendChannelPolicyWarning('g', 'c', 'u', 0, 1001)).toBe(true);
  });
});
