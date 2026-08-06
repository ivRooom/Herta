import { readFileSync, rmSync, writeFileSync } from 'node:fs';

const path = 'plugins/moderation/src/plugin.ts';
let content = readFileSync(path, 'utf8');

content = replaceOnce(
  content,
  `  type ModerationAction,\n  type ModerationCaseRecord,`,
  `  type ModerationAction,\n  type ModerationCaseAction,\n  type ModerationCaseRecord,`,
);

content = replaceOnce(
  content,
  `function actionLabel(action: ModerationAction): string {\n  const labels: Record<ModerationAction, string> = {\n    warn: '警告',\n    timeout: 'タイムアウト',\n    kick: 'Kick',\n    ban: 'BAN',\n  };\n  return labels[action];\n}`,
  `function actionLabel(action: ModerationCaseAction): string {\n  const labels: Record<ModerationCaseAction, string> = {\n    flag: '検知フラグ',\n    warn: '警告',\n    timeout: 'タイムアウト',\n    kick: 'Kick',\n    ban: 'BAN',\n  };\n  return labels[action];\n}`,
);

writeFileSync(path, content);
rmSync('scripts/apply-moderation-detection-case-patches.mjs');
rmSync('.github/workflows/apply-moderation-detection-case-patches.yml');

function replaceOnce(source, before, after) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`置換対象が見つかりません: ${before.slice(0, 80)}`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`置換対象が複数あります: ${before.slice(0, 80)}`);
  }
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}
