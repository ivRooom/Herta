from pathlib import Path

DEFAULT_PRESETS = [
    'Minecraft',
    'VALORANT',
    'Apex Legends',
    'Fortnite',
    'Overwatch 2',
    'League of Legends',
    'Splatoon 3',
    'Monster Hunter Wilds',
    '雑談・イベント',
]

# config.ts
path = Path('plugins/lfg/src/config.ts')
text = path.read_text()
text = text.replace(
    '  maxPlayersLimit: number;\n  maxTitleLength: number;',
    '  maxPlayersLimit: number;\n  defaultMaxPlayers: number;\n  gamePresets: string[];\n  maxTitleLength: number;',
    1,
)
text = text.replace(
    '  maxPlayersLimit: 100,\n  maxTitleLength: 100,',
    "  maxPlayersLimit: 100,\n  defaultMaxPlayers: 4,\n  gamePresets: [\n    'Minecraft',\n    'VALORANT',\n    'Apex Legends',\n    'Fortnite',\n    'Overwatch 2',\n    'League of Legends',\n    'Splatoon 3',\n    'Monster Hunter Wilds',\n    '雑談・イベント',\n  ],\n  maxTitleLength: 100,",
    1,
)
old_start = '''export function normalizeLfgConfig(input: unknown): LfgConfig {
  const source = isRecord(input) ? input : {};
  return {
'''
new_start = '''export function normalizeLfgConfig(input: unknown): LfgConfig {
  const source = isRecord(input) ? input : {};
  const maxPlayersLimit = readInteger(
    source['maxPlayersLimit'],
    LFG_DEFAULTS.maxPlayersLimit,
    2,
    500,
  );
  return {
'''
if old_start not in text:
    raise SystemExit('normalizeLfgConfig start target not found')
text = text.replace(old_start, new_start, 1)
old_max = "    maxPlayersLimit: readInteger(source['maxPlayersLimit'], LFG_DEFAULTS.maxPlayersLimit, 2, 500),\n"
new_max = '''    maxPlayersLimit,
    defaultMaxPlayers: readInteger(
      source['defaultMaxPlayers'],
      Math.min(LFG_DEFAULTS.defaultMaxPlayers, maxPlayersLimit),
      2,
      maxPlayersLimit,
    ),
    gamePresets: readStringArray(source['gamePresets'], LFG_DEFAULTS.gamePresets, 30, 80),
'''
if old_max not in text:
    raise SystemExit('maxPlayersLimit normalize target not found')
text = text.replace(old_max, new_max, 1)
helper_marker = '''function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

'''
helper = helper_marker + '''function readStringArray(
  value: unknown,
  fallback: string[],
  maxItems: number,
  maxLength: number,
): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const normalized = item.trim();
    if (!normalized || normalized.length > maxLength || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= maxItems) break;
  }
  return result;
}

'''
if 'function readStringArray(' not in text:
    if helper_marker not in text:
        raise SystemExit('readBoolean helper target not found')
    text = text.replace(helper_marker, helper, 1)
path.write_text(text)

# manifest.ts
path = Path('plugins/lfg/src/manifest.ts')
text = path.read_text()
max_schema = '''      maxPlayersLimit: {
        type: 'integer',
        title: '募集可能な最大人数',
        minimum: 2,
        maximum: 500,
        default: 100,
      },
'''
extra_schema = max_schema + '''      defaultMaxPlayers: {
        type: 'integer',
        title: '新規募集の既定定員',
        description: 'Studioで新しい募集を作る際の初期人数です。最大人数設定を超える場合は自動調整されます。',
        minimum: 2,
        maximum: 500,
        default: 4,
      },
      gamePresets: {
        type: 'array',
        title: 'ゲーム・イベントPreset',
        description: 'Studioの募集作成フォームに候補として表示します。候補外の名前も自由入力できます。',
        maxItems: 30,
        items: { type: 'string', minLength: 1, maxLength: 80 },
        default: [
          'Minecraft',
          'VALORANT',
          'Apex Legends',
          'Fortnite',
          'Overwatch 2',
          'League of Legends',
          'Splatoon 3',
          'Monster Hunter Wilds',
          '雑談・イベント',
        ],
      },
'''
if 'defaultMaxPlayers:' not in text:
    if max_schema not in text:
        raise SystemExit('manifest maxPlayersLimit target not found')
    text = text.replace(max_schema, extra_schema, 1)
text = text.replace(
    "      'maxPlayersLimit',\n      'maxTitleLength',",
    "      'maxPlayersLimit',\n      'defaultMaxPlayers',\n      'gamePresets',\n      'maxTitleLength',",
    1,
)
path.write_text(text)

# config.test.ts
path = Path('plugins/lfg/src/config.test.ts')
text = path.read_text()
insert_after = '''  it('設定値を許容範囲へ制限する', () => {
    expect(
      normalizeLfgConfig({
        maxOpenPostsPerGuild: 9999,
        maxOpenPostsPerChannel: 0,
        creationCooldownSeconds: 9999,
        maxPlayersLimit: 1,
      }),
    ).toMatchObject({
      maxOpenPostsPerGuild: 500,
      maxOpenPostsPerChannel: 1,
      creationCooldownSeconds: 3600,
      maxPlayersLimit: 2,
    });
  });
'''
extra_tests = insert_after + '''
  it('既定定員をmaxPlayersLimit以下へ調整する', () => {
    expect(normalizeLfgConfig({ maxPlayersLimit: 3, defaultMaxPlayers: 8 })).toMatchObject({
      maxPlayersLimit: 3,
      defaultMaxPlayers: 3,
    });
  });

  it('ゲームPresetをtrim・重複除去して保持する', () => {
    expect(
      normalizeLfgConfig({
        gamePresets: [' Minecraft ', 'VALORANT', 'Minecraft', '', 123, 'Apex Legends'],
      }).gamePresets,
    ).toEqual(['Minecraft', 'VALORANT', 'Apex Legends']);
  });

  it('ゲームPresetは空配列も許可する', () => {
    expect(normalizeLfgConfig({ gamePresets: [] }).gamePresets).toEqual([]);
  });
'''
if "既定定員をmaxPlayersLimit以下へ調整する" not in text:
    if insert_after not in text:
        raise SystemExit('config test insertion target not found')
    text = text.replace(insert_after, extra_tests, 1)
path.write_text(text)

# lfg-manager.tsx
path = Path('apps/studio/src/components/lfg-manager.tsx')
text = path.read_text()
const_start = text.find('const GAME_PRESETS = [')
const_end_marker = '] as const;\n\nconst initialForm: CreateForm = {'
const_end = text.find(const_end_marker, const_start)
if const_start < 0 or const_end < 0:
    raise SystemExit('GAME_PRESETS/initialForm block not found')
const_end += len('] as const;\n\n')
text = text[:const_start] + text[const_end:]
old_form = '''const initialForm: CreateForm = {
  channelId: '',
  game: '',
  title: '',
  description: '',
  maxPlayers: '4',
  startTime: '',
  durationMinutes: '180',
};
'''
new_form = '''function createInitialForm(
  defaultMaxPlayers: number,
  defaultDurationMinutes: number,
): CreateForm {
  return {
    channelId: '',
    game: '',
    title: '',
    description: '',
    maxPlayers: String(defaultMaxPlayers),
    startTime: '',
    durationMinutes: String(defaultDurationMinutes),
  };
}
'''
if old_form not in text:
    raise SystemExit('initialForm target not found')
text = text.replace(old_form, new_form, 1)
text = text.replace(
    '''  pluginEnabled,
  maxPlayersLimit,
  discordOptions,
}: {''',
    '''  pluginEnabled,
  maxPlayersLimit,
  defaultMaxPlayers,
  defaultDurationMinutes,
  gamePresets,
  discordOptions,
}: {''',
    1,
)
text = text.replace(
    '''  pluginEnabled: boolean;
  maxPlayersLimit: number;
  discordOptions?: GuildConfigurationOptions | null;''',
    '''  pluginEnabled: boolean;
  maxPlayersLimit: number;
  defaultMaxPlayers: number;
  defaultDurationMinutes: number;
  gamePresets: string[];
  discordOptions?: GuildConfigurationOptions | null;''',
    1,
)
text = text.replace(
    "  const [form, setForm] = useState<CreateForm>(initialForm);",
    "  const [form, setForm] = useState<CreateForm>(() =>\n    createInitialForm(defaultMaxPlayers, defaultDurationMinutes),\n  );",
    1,
)
text = text.replace(
    '      setForm(initialForm);',
    '      setForm(createInitialForm(defaultMaxPlayers, defaultDurationMinutes));',
    1,
)
text = text.replace('              {GAME_PRESETS.map((game) => (', '              {gamePresets.map((game) => (', 1)
path.write_text(text)

# LFG page props
path = Path("apps/studio/src/app/dashboard/guilds/[guildId]/lfg/page.tsx")
text = path.read_text()
text = text.replace(
    '''            maxPlayersLimit={config.maxPlayersLimit}
            discordOptions={discordOptions}''',
    '''            maxPlayersLimit={config.maxPlayersLimit}
            defaultMaxPlayers={config.defaultMaxPlayers}
            defaultDurationMinutes={config.defaultDurationMinutes}
            gamePresets={config.gamePresets}
            discordOptions={discordOptions}''',
    1,
)
path.write_text(text)
