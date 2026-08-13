from pathlib import Path


def replace(path: str, old: str, new: str, count: int = 1) -> None:
    file = Path(path)
    text = file.read_text()
    actual = text.count(old)
    assert actual == count, f'{path}: expected {count}, got {actual}: {old[:120]!r}'
    file.write_text(text.replace(old, new, count))


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
