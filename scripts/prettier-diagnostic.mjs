import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
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
  const tempFile = path.join(os.tmpdir(), path.basename(file));
  await fs.writeFile(tempFile, formatted, 'utf8');

  let diff = '';
  try {
    execFileSync('diff', ['-u', file, tempFile], { encoding: 'utf8' });
  } catch (error) {
    diff = String(error.stdout ?? '');
  }

  const encoded = Buffer.from(diff, 'utf8').toString('base64');
  console.log(`::error file=${file},title=PRETTIER_DIFF_BASE64::${encoded}`);
}

process.exitCode = 1;
