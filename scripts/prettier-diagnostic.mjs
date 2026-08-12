import fs from 'node:fs/promises';
import process from 'node:process';
import prettier from 'prettier';

const files = [
  'apps/bot/src/plugins/custom-achievements.test.ts',
  'apps/bot/src/plugins/achievements.ts',
  'apps/bot/src/plugins/achievements.test.ts',
];

for (const file of files) {
  const source = await fs.readFile(file, 'utf8');
  const options = await prettier.resolveConfig(file);
  const formatted = await prettier.format(source, { ...options, filepath: file });
  const encoded = Buffer.from(formatted, 'utf8').toString('base64');
  console.log(`::error file=${file},title=PRETTIER_BASE64::${encoded}`);
}

process.exitCode = 1;
