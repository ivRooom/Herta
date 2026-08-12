import fs from 'node:fs/promises';
import path from 'node:path';
import prettier from 'prettier';

const files = [
  'apps/bot/src/plugins/achievements.ts',
  'apps/bot/src/plugins/achievements.test.ts',
  'apps/bot/src/plugins/custom-achievements.test.ts',
];

const achievementFile = files[0];
let source = await fs.readFile(achievementFile, 'utf8');
source = source.replace('secret: builtIn.secret,', 'secret: builtIn.secret === true,');
await fs.writeFile(achievementFile, source, 'utf8');

const artifactRoot = 'security-artifacts/achievements-v3-formatted';
for (const file of files) {
  const input = await fs.readFile(file, 'utf8');
  const options = await prettier.resolveConfig(file);
  const formatted = await prettier.format(input, { ...options, filepath: file });
  await fs.writeFile(file, formatted, 'utf8');

  const output = path.join(artifactRoot, file);
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, formatted, 'utf8');
}

console.log('Achievements v3 files formatted and exported for CI verification.');
