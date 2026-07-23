import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_EXCEPTION_DAYS = 90;
const ISSUE_URL_PATTERN = /^https:\/\/github\.com\/ivRooom\/Herta\/issues\/\d+$/;
const VULNERABILITY_ID_PATTERN = /^(CVE-\d{4}-\d{4,}|GHSA-[a-z0-9-]+)$/i;
const PACKAGE_TYPES = new Set([
  'apk',
  'binary',
  'deb',
  'dotnet',
  'gem',
  'golang',
  'java-archive',
  'jenkins-plugin',
  'npm',
  'php-composer',
  'python',
  'rpm',
  'rust-crate',
]);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function parseDate(date, fieldName) {
  assert(typeof date === 'string', `${fieldName}はYYYY-MM-DD形式の文字列で指定してください`);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(date), `${fieldName}はYYYY-MM-DD形式で指定してください: ${date}`);

  const parsed = new Date(`${date}T00:00:00.000Z`);
  assert(!Number.isNaN(parsed.getTime()), `${fieldName}が不正な日付です: ${date}`);
  assert(parsed.toISOString().slice(0, 10) === date, `${fieldName}が不正な日付です: ${date}`);
  return parsed;
}

function validatePackage(value, index) {
  if (value === undefined) {
    return undefined;
  }

  assert(value && typeof value === 'object' && !Array.isArray(value), `allowlist[${index}].packageはobjectで指定してください`);
  assert(typeof value.name === 'string' && value.name.trim().length > 0, `allowlist[${index}].package.nameは必須です`);

  const allowedKeys = new Set(['name', 'type']);
  for (const key of Object.keys(value)) {
    assert(allowedKeys.has(key), `allowlist[${index}].package.${key}は未対応です`);
  }

  if (value.type !== undefined) {
    assert(typeof value.type === 'string' && PACKAGE_TYPES.has(value.type), `allowlist[${index}].package.typeが未対応です: ${value.type}`);
  }

  return {
    name: value.name.trim(),
    ...(value.type ? { type: value.type } : {}),
  };
}

export function validateAllowlist(input, now = new Date()) {
  assert(Array.isArray(input), 'allowlistのルートは配列である必要があります');

  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const maxExpiry = new Date(today);
  maxExpiry.setUTCDate(maxExpiry.getUTCDate() + MAX_EXCEPTION_DAYS);

  const seen = new Set();

  return input.map((entry, index) => {
    assert(entry && typeof entry === 'object' && !Array.isArray(entry), `allowlist[${index}]はobjectで指定してください`);

    const allowedKeys = new Set(['id', 'reason', 'expires', 'issue', 'package']);
    for (const key of Object.keys(entry)) {
      assert(allowedKeys.has(key), `allowlist[${index}].${key}は未対応です`);
    }

    assert(typeof entry.id === 'string' && VULNERABILITY_ID_PATTERN.test(entry.id), `allowlist[${index}].idはCVEまたはGHSA形式で指定してください`);
    assert(typeof entry.reason === 'string' && entry.reason.trim().length >= 10, `allowlist[${index}].reasonは10文字以上で具体的に記載してください`);
    assert(typeof entry.issue === 'string' && ISSUE_URL_PATTERN.test(entry.issue), `allowlist[${index}].issueはivRooom/HertaのIssue URLを指定してください`);

    const expires = parseDate(entry.expires, `allowlist[${index}].expires`);
    assert(expires > today, `allowlist[${index}]は期限切れです: ${entry.expires}`);
    assert(expires <= maxExpiry, `allowlist[${index}].expiresは本日から${MAX_EXCEPTION_DAYS}日以内にしてください`);

    const packageRule = validatePackage(entry.package, index);
    const normalizedId = entry.id.toUpperCase();
    const uniquenessKey = `${normalizedId}|${packageRule?.name ?? '*'}|${packageRule?.type ?? '*'}`;
    assert(!seen.has(uniquenessKey), `allowlist[${index}]が重複しています: ${uniquenessKey}`);
    seen.add(uniquenessKey);

    return {
      id: normalizedId,
      reason: entry.reason.trim(),
      expires: entry.expires,
      issue: entry.issue,
      ...(packageRule ? { package: packageRule } : {}),
    };
  });
}

function yamlString(value) {
  return JSON.stringify(value);
}

export function renderGrypeConfig(entries) {
  if (entries.length === 0) {
    return 'ignore: []\n';
  }

  const lines = ['ignore:'];
  for (const entry of entries) {
    lines.push(`  # reason: ${entry.reason.replaceAll('\n', ' ')}`);
    lines.push(`  # expires: ${entry.expires}`);
    lines.push(`  # issue: ${entry.issue}`);
    lines.push(`  - vulnerability: ${yamlString(entry.id)}`);

    if (entry.package) {
      lines.push('    package:');
      lines.push(`      name: ${yamlString(entry.package.name)}`);
      if (entry.package.type) {
        lines.push(`      type: ${yamlString(entry.package.type)}`);
      }
    }
  }

  return `${lines.join('\n')}\n`;
}

export async function main(args = process.argv.slice(2)) {
  const [inputPath, outputPath] = args;
  assert(inputPath && outputPath, 'Usage: node prepare-grype-config.mjs <allowlist.json> <output.yaml>');

  const raw = await readFile(inputPath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`allowlist JSONの解析に失敗しました: ${error.message}`);
  }

  const entries = validateAllowlist(parsed);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, renderGrypeConfig(entries), 'utf8');
  console.log(`Grype allowlist: ${entries.length}件の有効な例外を読み込みました`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
