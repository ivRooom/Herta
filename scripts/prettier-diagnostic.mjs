import fs from 'node:fs/promises';
import process from 'node:process';
import prettier from 'prettier';

const files = [
  'apps/bot/src/plugins/custom-achievements.test.ts',
  'apps/bot/src/plugins/achievements.ts',
  'apps/bot/src/plugins/achievements.test.ts',
];
const chunkSize = 6000;

for (const file of files) {
  const source = await fs.readFile(file, 'utf8');
  const options = await prettier.resolveConfig(file);
  const formatted = await prettier.format(source, { ...options, filepath: file });
  const encoded = Buffer.from(formatted, 'utf8').toString('base64');
  const chunks = [];
  for (let offset = 0; offset < encoded.length; offset += chunkSize) {
    chunks.push(encoded.slice(offset, offset + chunkSize));
  }
  chunks.forEach((chunk, index) => {
    const sequence = `${String(index + 1).padStart(3, '0')}_OF_${String(chunks.length).padStart(3, '0')}`;
    console.log(`::error file=${file},title=PRETTIER_BASE64_${sequence}::${chunk}`);
  });
}

process.exitCode = 1;
