import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import prettier from 'prettier';

const achievementFile = 'apps/bot/src/plugins/achievements.ts';
let source = await fs.readFile(achievementFile, 'utf8');
source = source.replace('secret: builtIn.secret,', 'secret: builtIn.secret === true,');
await fs.writeFile(achievementFile, source, 'utf8');

const files = [
  'apps/bot/src/plugins/custom-achievements.test.ts',
  achievementFile,
  'apps/bot/src/plugins/achievements.test.ts',
];
for (const file of files) {
  const input = await fs.readFile(file, 'utf8');
  const options = await prettier.resolveConfig(file);
  const formatted = await prettier.format(input, { ...options, filepath: file });
  await fs.writeFile(file, formatted, 'utf8');
}

const status = execFileSync('git', ['status', '--porcelain', '--', ...files], {
  encoding: 'utf8',
}).trim();
if (!status) process.exit(0);

execFileSync('git', ['config', 'user.name', 'github-actions[bot]']);
execFileSync('git', ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
execFileSync('git', ['add', ...files]);
execFileSync('git', ['commit', '-m', 'Achievements v3のCI指摘を修正']);
const branch = process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME;
execFileSync('git', ['push', 'origin', `HEAD:${branch}`], { stdio: 'inherit' });
