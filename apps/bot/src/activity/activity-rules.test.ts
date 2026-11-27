import { describe, expect, it } from 'vitest';
import {
  communityPointsRatesFromConfig,
  evaluateMessageActivity,
  GAME_ACTIVITY_TYPES,
  gameActivityIdentityKey,
  hasMessageCooldownElapsed,
  isExcludedGameActivityName,
  normalizeActivityRulesConfig,
  selectPrimaryGameActivity,
  selectPrimaryGameActivityName,
  shouldCountCommandPoints,
  shouldCountGamePresence,
  shouldCountLfgPoints,
  shouldCountMessage,
  shouldCountOnlinePresence,
  shouldCountPollPoints,
  shouldCountTeamSplitPoints,
  shouldCountVoice,
} from './activity-rules.js';

describe('Activity Rules v1.3', () => {
  it('既存Community ActivityとXPの挙動を既定値で維持する', () => {
    expect(normalizeActivityRulesConfig(undefined)).toEqual({
      excludedTextChannelIds: [],
      excludedVoiceChannelIds: [],
      excludedRoleIds: [],
      messageCooldownSeconds: 0,
      minimumMessageLength: 0,
      excludeCommandMessages: false,
      commandPrefixes: ['/', '!'],
      applyMessageRulesToXp: false,
      countReactionsGiven: true,
      countReactionsReceived: true,
      countSelfMutedVoice: true,
      countServerMutedVoice: true,
      countSelfDeafenedVoice: true,
      countServerDeafenedVoice: true,
      countOnlinePresence: true,
      countGamePresence: true,
      excludedGameActivityNames: ['Valorant Tracker App'],
      excludedGameApplicationIds: [],
      countCommandPoints: true,
      messagePointsPerMessage: 2,
      reactionPointsPerReaction: 1,
      voicePointsPer10Minutes: 1,
      onlinePointsPerHour: 1,
      onlinePointsDailyCap: 2,
      gamePointsPerHour: 1,
      gamePointsDailyCap: 2,
      achievementPoints: 5,
      commandPointsPerUse: 1,
      commandPointsDailyCap: 10,
      countLfgPoints: true,
      lfgPointsPerJoin: 3,
      lfgPointsDailyCap: 15,
      countTeamSplitPoints: true,
      teamSplitPointsPerJoin: 3,
      teamSplitPointsDailyCap: 15,
      countPollPoints: true,
      pollPointsPerVote: 1,
      pollPointsDailyCap: 10,
    });
  });

  it('ID・数値・コマンドprefix・XP適用設定を安全な範囲へ正規化する', () => {
    const config = normalizeActivityRulesConfig({
      excludedTextChannelIds: ['123', '123', 'bad'],
      excludedVoiceChannelIds: ['456', 'bad'],
      excludedRoleIds: ['789', 'bad'],
      messageCooldownSeconds: 999,
      minimumMessageLength: -5,
      excludeCommandMessages: true,
      commandPrefixes: ['!', ' ! ', '?', 'too-long', 'has space'],
      applyMessageRulesToXp: true,
      countReactionsGiven: false,
      countSelfMutedVoice: false,
    });

    expect(config).toMatchObject({
      excludedTextChannelIds: ['123'],
      excludedVoiceChannelIds: ['456'],
      excludedRoleIds: ['789'],
      messageCooldownSeconds: 300,
      minimumMessageLength: 0,
      excludeCommandMessages: true,
      commandPrefixes: ['!', '?'],
      applyMessageRulesToXp: true,
      countReactionsGiven: false,
      countSelfMutedVoice: false,
    });
  });

  it('除外チャンネル・Role・文字数で発言集計を制御する', () => {
    const config = normalizeActivityRulesConfig({
      excludedTextChannelIds: ['100'],
      excludedRoleIds: ['200'],
      minimumMessageLength: 5,
    });

    expect(
      shouldCountMessage(config, {
        channelId: '100',
        roleIds: [],
        contentAvailable: true,
        contentLength: 20,
      }),
    ).toBe(false);
    expect(
      shouldCountMessage(config, {
        channelId: '101',
        roleIds: ['200'],
        contentAvailable: true,
        contentLength: 20,
      }),
    ).toBe(false);
    expect(
      shouldCountMessage(config, {
        channelId: '101',
        roleIds: [],
        contentAvailable: true,
        contentLength: 4,
      }),
    ).toBe(false);
    expect(
      shouldCountMessage(config, {
        channelId: '101',
        roleIds: [],
        contentAvailable: true,
        contentLength: 5,
      }),
    ).toBe(true);
  });

  it('設定したprefixのコマンド形式メッセージを発言数から除外する', () => {
    const config = normalizeActivityRulesConfig({
      excludeCommandMessages: true,
      commandPrefixes: ['/', '!', '?'],
    });

    expect(
      shouldCountMessage(config, {
        channelId: '101',
        contentAvailable: true,
        content: '/rank',
        contentLength: 5,
      }),
    ).toBe(false);
    expect(
      shouldCountMessage(config, {
        channelId: '101',
        contentAvailable: true,
        content: '   !help',
        contentLength: 8,
      }),
    ).toBe(false);
    expect(
      shouldCountMessage(config, {
        channelId: '101',
        contentAvailable: true,
        content: 'これは!通常メッセージ',
        contentLength: 11,
      }),
    ).toBe(true);
  });

  it('診断用評価は除外理由と一致prefixを返す', () => {
    const config = normalizeActivityRulesConfig({
      excludeCommandMessages: true,
      commandPrefixes: ['!', '?'],
    });
    expect(
      evaluateMessageActivity(config, {
        channelId: '101',
        contentAvailable: true,
        content: '  !help',
      }),
    ).toEqual({
      counted: false,
      blockingReason: 'command_prefix',
      matchedCommandPrefix: '!',
      notices: [],
    });
  });

  it('Message Content Intentが無い場合は本文依存条件だけをスキップして理由を返す', () => {
    const config = normalizeActivityRulesConfig({
      minimumMessageLength: 50,
      excludeCommandMessages: true,
      commandPrefixes: ['!'],
    });
    const evaluation = evaluateMessageActivity(config, {
      channelId: '101',
      roleIds: [],
      contentAvailable: false,
      content: '!help',
      contentLength: 0,
    });

    expect(evaluation.counted).toBe(true);
    expect(evaluation.notices).toEqual([
      'command_check_skipped_without_content',
      'length_check_skipped_without_content',
    ]);
  });

  it('Cooldownの経過を判定する', () => {
    const config = normalizeActivityRulesConfig({ messageCooldownSeconds: 10 });
    expect(hasMessageCooldownElapsed(config, undefined, 20_000)).toBe(true);
    expect(hasMessageCooldownElapsed(config, 15_000, 20_000)).toBe(false);
    expect(hasMessageCooldownElapsed(config, 10_000, 20_000)).toBe(true);
  });

  it('VC除外・Role・mute/deaf条件を適用する', () => {
    const config = normalizeActivityRulesConfig({
      excludedVoiceChannelIds: ['300'],
      excludedRoleIds: ['400'],
      countSelfMutedVoice: false,
      countServerMutedVoice: false,
      countSelfDeafenedVoice: false,
      countServerDeafenedVoice: false,
    });

    expect(shouldCountVoice(config, { channelId: null })).toBe(false);
    expect(shouldCountVoice(config, { channelId: '300' })).toBe(false);
    expect(shouldCountVoice(config, { channelId: '301', roleIds: ['400'] })).toBe(false);
    expect(shouldCountVoice(config, { channelId: '301', selfMute: true })).toBe(false);
    expect(shouldCountVoice(config, { channelId: '301', serverMute: true })).toBe(false);
    expect(shouldCountVoice(config, { channelId: '301', selfDeaf: true })).toBe(false);
    expect(shouldCountVoice(config, { channelId: '301', serverDeaf: true })).toBe(false);
    expect(shouldCountVoice(config, { channelId: '301' })).toBe(true);
  });

  it('プレゼンス集計は設定OFFまたは除外Roleで無効化できる', () => {
    const defaultConfig = normalizeActivityRulesConfig(undefined);
    expect(shouldCountOnlinePresence(defaultConfig, {})).toBe(true);
    expect(shouldCountGamePresence(defaultConfig, {})).toBe(true);

    const disabledConfig = normalizeActivityRulesConfig({
      countOnlinePresence: false,
      countGamePresence: false,
    });
    expect(shouldCountOnlinePresence(disabledConfig, {})).toBe(false);
    expect(shouldCountGamePresence(disabledConfig, {})).toBe(false);

    const excludedRoleConfig = normalizeActivityRulesConfig({ excludedRoleIds: ['400'] });
    expect(shouldCountOnlinePresence(excludedRoleConfig, { roleIds: ['400'] })).toBe(false);
    expect(shouldCountGamePresence(excludedRoleConfig, { roleIds: ['400'] })).toBe(false);
    expect(shouldCountOnlinePresence(excludedRoleConfig, { roleIds: ['999'] })).toBe(true);
  });

  it('コマンド使用ポイントは設定OFFまたは除外Roleで無効化できる', () => {
    const defaultConfig = normalizeActivityRulesConfig(undefined);
    expect(shouldCountCommandPoints(defaultConfig, {})).toBe(true);

    const disabledConfig = normalizeActivityRulesConfig({ countCommandPoints: false });
    expect(shouldCountCommandPoints(disabledConfig, {})).toBe(false);

    const excludedRoleConfig = normalizeActivityRulesConfig({ excludedRoleIds: ['400'] });
    expect(shouldCountCommandPoints(excludedRoleConfig, { roleIds: ['400'] })).toBe(false);
    expect(shouldCountCommandPoints(excludedRoleConfig, { roleIds: ['999'] })).toBe(true);
  });

  it('オンライン・ゲームは既定で低単価+1日上限、OFF時は単価0になる', () => {
    const defaultConfig = normalizeActivityRulesConfig(undefined);
    expect(communityPointsRatesFromConfig(defaultConfig)).toEqual({
      messagePointsPerMessage: 2,
      reactionPointsPerReaction: 1,
      voicePointsPer10Minutes: 1,
      onlinePointsPerHour: 1,
      onlinePointsDailyCap: 2,
      gamePointsPerHour: 1,
      gamePointsDailyCap: 2,
      achievementPoints: 5,
      commandPointsPerUse: 1,
      commandPointsDailyCap: 10,
      lfgPointsPerJoin: 3,
      lfgPointsDailyCap: 15,
      teamSplitPointsPerJoin: 3,
      teamSplitPointsDailyCap: 15,
      pollPointsPerVote: 1,
      pollPointsDailyCap: 10,
    });

    const disabledConfig = normalizeActivityRulesConfig({
      countOnlinePresence: false,
      countGamePresence: false,
      countCommandPoints: false,
      countLfgPoints: false,
      countTeamSplitPoints: false,
      countPollPoints: false,
    });
    const disabledRates = communityPointsRatesFromConfig(disabledConfig);
    expect(disabledRates.onlinePointsPerHour).toBe(0);
    expect(disabledRates.gamePointsPerHour).toBe(0);
    expect(disabledRates.commandPointsPerUse).toBe(0);
    expect(disabledRates.lfgPointsPerJoin).toBe(0);
    expect(disabledRates.teamSplitPointsPerJoin).toBe(0);
    expect(disabledRates.pollPointsPerVote).toBe(0);
  });

  it('ゲーム除外リストは未設定で既定値、明示した配列が正になる', () => {
    // 既存Guild設定(キー無し)は既定の除外リストが適用される(後方互換の明記)
    expect(normalizeActivityRulesConfig(undefined).excludedGameActivityNames).toEqual([
      'Valorant Tracker App',
    ]);
    expect(normalizeActivityRulesConfig({}).excludedGameActivityNames).toEqual([
      'Valorant Tracker App',
    ]);
    // 配列でない値は既定へフォールバックする
    expect(
      normalizeActivityRulesConfig({ excludedGameActivityNames: 'bad' }).excludedGameActivityNames,
    ).toEqual(['Valorant Tracker App']);
    // 空配列の明示は「除外なし」
    expect(
      normalizeActivityRulesConfig({ excludedGameActivityNames: [] }).excludedGameActivityNames,
    ).toEqual([]);
    // 前後空白の除去・空文字と非文字列の除外・大文字小文字を区別しない重複除去
    expect(
      normalizeActivityRulesConfig({
        excludedGameActivityNames: ['  VS Code ', 'vs code', '', 42, 'Visual Studio Code'],
      }).excludedGameActivityNames,
    ).toEqual(['VS Code', 'Visual Studio Code']);
  });

  it('ゲーム除外判定は完全一致で大文字小文字と前後空白を区別しない', () => {
    const excluded = ['Valorant Tracker App'];
    expect(isExcludedGameActivityName('Valorant Tracker App', excluded)).toBe(true);
    expect(isExcludedGameActivityName(' valorant tracker app ', excluded)).toBe(true);
    expect(isExcludedGameActivityName('VALORANT', excluded)).toBe(false);
    expect(isExcludedGameActivityName('Valorant Tracker App 2', excluded)).toBe(false);
    expect(isExcludedGameActivityName('', excluded)).toBe(false);
  });

  it('ゲーム選択は全件走査しPlaying優先・Competingをフォールバックにする', () => {
    const playing = GAME_ACTIVITY_TYPES.playing;
    const competing = GAME_ACTIVITY_TYPES.competing;
    // 従来挙動: 先頭のPlayingを返す(カスタムステータス等は無視)
    expect(
      selectPrimaryGameActivityName(
        [
          { type: 4, name: 'Custom Status' },
          { type: playing, name: 'VALORANT' },
          { type: playing, name: 'Overwatch' },
        ],
        [],
      ),
    ).toBe('VALORANT');
    // Competingのみの場合はCompetingを対象にする
    expect(selectPrimaryGameActivityName([{ type: competing, name: 'Arena' }], [])).toBe('Arena');
    // 並び順が逆でもPlayingをCompetingより優先する
    expect(
      selectPrimaryGameActivityName(
        [
          { type: competing, name: 'Arena' },
          { type: playing, name: 'VALORANT' },
        ],
        [],
      ),
    ).toBe('VALORANT');
    // Spotify等のListeningは対象外、対象が無ければnull
    expect(selectPrimaryGameActivityName([{ type: 2, name: 'Spotify' }], [])).toBeNull();
    expect(selectPrimaryGameActivityName([], [])).toBeNull();
    expect(selectPrimaryGameActivityName(undefined, [])).toBeNull();
    expect(selectPrimaryGameActivityName([{ type: playing, name: '  ' }], [])).toBeNull();
  });

  it('ゲーム選択は除外リストに一致する候補をスキップして次点へ進む', () => {
    const playing = GAME_ACTIVITY_TYPES.playing;
    const competing = GAME_ACTIVITY_TYPES.competing;
    const excluded = ['Valorant Tracker App'];
    // 先頭が除外対象なら次のPlayingへ進む
    expect(
      selectPrimaryGameActivityName(
        [
          { type: playing, name: 'Valorant Tracker App' },
          { type: playing, name: 'VALORANT' },
        ],
        excluded,
      ),
    ).toBe('VALORANT');
    // Playingが全て除外ならCompetingへフォールバックする
    expect(
      selectPrimaryGameActivityName(
        [
          { type: playing, name: 'valorant tracker app' },
          { type: competing, name: 'Arena' },
        ],
        excluded,
      ),
    ).toBe('Arena');
    // 全候補が除外なら計測対象なし
    expect(
      selectPrimaryGameActivityName([{ type: playing, name: 'Valorant Tracker App' }], excluded),
    ).toBeNull();
  });

  it('ゲーム選択はapplication_idを保持し、id除外と同一性キー判定ができる (#1060)', () => {
    const playing = GAME_ACTIVITY_TYPES.playing;
    // applicationIdはそのまま返し、名前版の選択結果と一致する
    expect(
      selectPrimaryGameActivity(
        [{ type: playing, name: 'Genshin Impact', applicationId: '100000000000000001' }],
        [],
      ),
    ).toEqual({ name: 'Genshin Impact', applicationId: '100000000000000001' });
    // idが無い・null・snowflakeでない値はnullへ倒す(名前キーへフォールバック)
    expect(selectPrimaryGameActivity([{ type: playing, name: 'Some Game' }], [])).toEqual({
      name: 'Some Game',
      applicationId: null,
    });
    expect(
      selectPrimaryGameActivity([{ type: playing, name: 'Some Game', applicationId: null }], []),
    ).toEqual({ name: 'Some Game', applicationId: null });
    expect(
      selectPrimaryGameActivity(
        [{ type: playing, name: 'Some Game', applicationId: 'not-a-snowflake' }],
        [],
      ),
    ).toEqual({ name: 'Some Game', applicationId: null });
    // 名前が除外でなくてもapplication_idが除外なら次点へ進む
    expect(
      selectPrimaryGameActivity(
        [
          { type: playing, name: 'Tracker Clone', applicationId: '111' },
          { type: playing, name: 'VALORANT', applicationId: '222' },
        ],
        [],
        ['111'],
      ),
    ).toEqual({ name: 'VALORANT', applicationId: '222' });
    // 同一性キーはid優先: 同じアプリの表示名ゆれは同一、id無しは名前で判定
    expect(
      gameActivityIdentityKey({ name: 'Genshin Impact', applicationId: '100000000000000001' }),
    ).toBe(gameActivityIdentityKey({ name: '原神', applicationId: '100000000000000001' }));
    expect(gameActivityIdentityKey({ name: '原神', applicationId: null })).toBe('name:原神');
    // 除外IDリストの正規化: snowflake以外と重複を落とす
    expect(
      normalizeActivityRulesConfig({
        excludedGameApplicationIds: ['100000000000000001', 'bad', '100000000000000001'],
      }).excludedGameApplicationIds,
    ).toEqual(['100000000000000001']);
  });

  it('LFG・Team Split・Poll参加ポイントは設定OFFまたは除外Roleで無効化できる', () => {
    const defaultConfig = normalizeActivityRulesConfig(undefined);
    expect(shouldCountLfgPoints(defaultConfig, {})).toBe(true);
    expect(shouldCountTeamSplitPoints(defaultConfig, {})).toBe(true);
    expect(shouldCountPollPoints(defaultConfig, {})).toBe(true);

    const disabledConfig = normalizeActivityRulesConfig({
      countLfgPoints: false,
      countTeamSplitPoints: false,
      countPollPoints: false,
    });
    expect(shouldCountLfgPoints(disabledConfig, {})).toBe(false);
    expect(shouldCountTeamSplitPoints(disabledConfig, {})).toBe(false);
    expect(shouldCountPollPoints(disabledConfig, {})).toBe(false);

    const excludedRoleConfig = normalizeActivityRulesConfig({ excludedRoleIds: ['400'] });
    expect(shouldCountLfgPoints(excludedRoleConfig, { roleIds: ['400'] })).toBe(false);
    expect(shouldCountTeamSplitPoints(excludedRoleConfig, { roleIds: ['400'] })).toBe(false);
    expect(shouldCountPollPoints(excludedRoleConfig, { roleIds: ['400'] })).toBe(false);
    expect(shouldCountLfgPoints(excludedRoleConfig, { roleIds: ['999'] })).toBe(true);
  });
});
