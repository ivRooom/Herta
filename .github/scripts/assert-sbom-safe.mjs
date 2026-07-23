import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const FORBIDDEN_LITERALS = [
  'ci-client-secret',
  'ci-bot-token',
  '-----BEGIN PRIVATE KEY-----',
  '-----BEGIN RSA PRIVATE KEY-----',
  '-----BEGIN EC PRIVATE KEY-----',
  '-----BEGIN OPENSSH PRIVATE KEY-----',
];

const FORBIDDEN_PATTERNS = [
  /postgres(?:ql)?:\/\/[^\s"']+:[^\s"'@]+@/i,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /gh[pousr]_[A-Za-z0-9]{30,}/,
  /sk-[A-Za-z0-9_-]{20,}/,
];

export function validateSbom(document, rawText, extraForbiddenValues = []) {
  assert(document && typeof document === 'object' && !Array.isArray(document), 'SBOMのルートはobjectである必要があります');
  assert(document.bomFormat === 'CycloneDX', `SBOM形式がCycloneDXではありません: ${document.bomFormat ?? 'unknown'}`);
  assert(typeof document.specVersion === 'string', 'CycloneDX specVersionがありません');
  assert(Array.isArray(document.components), 'CycloneDX componentsがありません');
  assert(document.components.length > 0, 'CycloneDX componentsが空です');

  const literals = [
    ...FORBIDDEN_LITERALS,
    ...extraForbiddenValues.filter((value) => typeof value === 'string' && value.length >= 6),
  ];

  for (const value of literals) {
    assert(!rawText.includes(value), `SBOMに禁止されたSecret候補が含まれています: ${value.slice(0, 16)}...`);
  }

  for (const pattern of FORBIDDEN_PATTERNS) {
    assert(!pattern.test(rawText), `SBOMにCredentialを含む可能性がある文字列が含まれています: ${pattern}`);
  }

  return {
    components: document.components.length,
    specVersion: document.specVersion,
  };
}

export async function main(args = process.argv.slice(2)) {
  const [sbomPath] = args;
  assert(sbomPath, 'Usage: node assert-sbom-safe.mjs <sbom.cdx.json>');

  const rawText = await readFile(sbomPath, 'utf8');
  let document;
  try {
    document = JSON.parse(rawText);
  } catch (error) {
    throw new Error(`SBOM JSONの解析に失敗しました: ${error.message}`);
  }

  const extraForbiddenValues = (process.env.SBOM_FORBIDDEN_VALUES ?? '')
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean);

  const result = validateSbom(document, rawText, extraForbiddenValues);
  console.log(`CycloneDX ${result.specVersion}: ${result.components} components、Secret候補なし`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
