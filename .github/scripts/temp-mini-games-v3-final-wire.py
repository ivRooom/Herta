from pathlib import Path


def replace(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    actual = text.count(old)
    assert actual == 1, f'{path}: expected 1, got {actual}: {old[:100]!r}'
    file.write_text(text.replace(old, new, 1))

replace(
    'apps/bot/src/plugins/mini-games.ts',
    "import { publishMiniGameCompletion } from './mini-games-completion-events.js';\n",
    "import { publishMiniGameCompletion } from './mini-games-completion-events.js';\nimport { createMiniGamesV3CommandHandlers } from './mini-games-v3.js';\n",
)
replace(
    'apps/bot/src/plugins/mini-games.ts',
    '    return [coinflip, highlow, blackjack, gamestats];',
    '    return [coinflip, highlow, blackjack, gamestats, ...createMiniGamesV3CommandHandlers(context)];',
)
replace(
    'apps/bot/src/plugins/mini-games.test.ts',
    """      'blackjack',
      'gamestats',
    ]);""",
    """      'blackjack',
      'gamestats',
      'dice',
      'chinchiro',
      'gameleaderboard',
    ]);""",
)
