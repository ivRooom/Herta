import assert from 'node:assert/strict';
import test from 'node:test';

import { validateSbom } from './assert-sbom-safe.mjs';

function sbom(overrides = {}) {
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    version: 1,
    components: [
      {
        type: 'library',
        name: 'example-package',
        version: '1.0.0',
      },
    ],
    ...overrides,
  };
}

test('有効なCycloneDX SBOMを受理する', () => {
  const document = sbom();
  const result = validateSbom(document, JSON.stringify(document));

  assert.deepEqual(result, {
    components: 1,
    specVersion: '1.6',
  });
});

test('CycloneDX以外を拒否する', () => {
  const document = sbom({ bomFormat: 'SPDX' });
  assert.throws(
    () => validateSbom(document, JSON.stringify(document)),
    /CycloneDXではありません/,
  );
});

test('componentsが空のSBOMを拒否する', () => {
  const document = sbom({ components: [] });
  assert.throws(
    () => validateSbom(document, JSON.stringify(document)),
    /componentsが空/,
  );
});

test('Credentialを含むURLを拒否する', () => {
  const document = sbom({
    metadata: {
      properties: [
        {
          name: 'database',
          value: 'postgresql://user:password@example.invalid/db',
        },
      ],
    },
  });

  assert.throws(
    () => validateSbom(document, JSON.stringify(document)),
    /Credential/,
  );
});

test('CIで指定された禁止値を拒否する', () => {
  const document = sbom({
    metadata: {
      properties: [
        {
          name: 'unexpected',
          value: 'temporary-secret-value',
        },
      ],
    },
  });

  assert.throws(
    () => validateSbom(document, JSON.stringify(document), ['temporary-secret-value']),
    /Secret候補/,
  );
});
