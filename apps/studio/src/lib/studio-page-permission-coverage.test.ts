import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'app');

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

const files = walk(appDir);

function boundaryPageId(layoutPath: string): string | null {
  const match = /<StudioPagePermissionBoundary[^>]*pageId="([^"]+)"/.exec(
    readFileSync(layoutPath, 'utf8'),
  );
  return match?.[1] ?? null;
}

test('page.view guarded layouts also guard every page rendered under them', () => {
  // layoutはソフトナビゲーションで再レンダリングされないため、layoutの
  // StudioPagePermissionBoundaryだけに頼るとpageのデータが権限取り消し後も返り続けうる。
  const guardedLayouts = files
    .filter((path) => basename(path) === 'layout.tsx')
    .map((path) => ({ dir: dirname(path), pageId: boundaryPageId(path) }))
    .filter((layout): layout is { dir: string; pageId: string } => layout.pageId !== null);

  assert.ok(guardedLayouts.length > 0);

  const missing: string[] = [];
  for (const layout of guardedLayouts) {
    const pages = files.filter(
      (path) => path.startsWith(`${layout.dir}${sep}`) && basename(path) === 'page.tsx',
    );
    for (const page of pages) {
      const source = readFileSync(page, 'utf8');
      // データを持たずにredirectするだけのpageは対象外とする。
      const redirectOnly = !/return\s*[(<]/.test(source) && /redirect\(/.test(source);
      if (redirectOnly) continue;
      const guardedWithPageId = new RegExp(
        `export default withStudioPagePermission\\(\\s*\\w+,\\s*'${layout.pageId}',?\\s*\\);`,
      ).test(source);
      if (!guardedWithPageId) {
        missing.push(`${relative(appDir, page)} (${layout.pageId})`);
      }
    }
  }

  assert.deepEqual(missing, []);
});
