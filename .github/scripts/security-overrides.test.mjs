import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function readOverrides() {
  const packageJson = JSON.parse(
    await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
  );
  return packageJson.pnpm?.overrides ?? {};
}

test('Production imageで既知脆弱版へ戻さないSecurity overrideを固定する', async () => {
  const overrides = await readOverrides();

  assert.equal(overrides.browserslist, '4.28.7', 'CVE-2026-73088/CVE-2026-73089修正版を維持する');
  assert.equal(
    overrides['fast-uri'],
    '4.1.3',
    'CVE-2026-18446/CVE-2026-75899/CVE-2026-75931/CVE-2026-75975/CVE-2026-76172修正版を維持する',
  );
  assert.equal(overrides.nanoid, '3.3.18', 'CVE-2026-67213修正版を維持する');
  assert.equal(overrides.postcss, '8.5.23', 'CVE-2026-69153修正版を維持する');
  assert.equal(overrides.qs, '6.15.2', 'CVE-2026-8723修正版を維持する');
});
