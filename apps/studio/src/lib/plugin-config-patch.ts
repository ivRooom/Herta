import type { PluginConfigPathSegment } from './plugin-config-paths.ts';

const MAX_CONFIG_PATH_DEPTH = 16;
const UNSAFE_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

export interface PluginConfigPathPatchOperation {
  path: readonly PluginConfigPathSegment[];
  value: unknown;
}

export interface PluginConfigPatchInput {
  config?: Record<string, unknown>;
  configPatch?: Record<string, unknown>;
  removeConfigFields?: readonly string[];
  configPathPatch?: readonly PluginConfigPathPatchOperation[];
  removeConfigPaths?: readonly (readonly PluginConfigPathSegment[])[];
}

export class PluginConfigPathPatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PluginConfigPathPatchError';
  }
}

export function resolvePluginConfigCandidate(
  current: Record<string, unknown>,
  input: PluginConfigPatchInput,
): Record<string, unknown> | undefined {
  const hasPathPatch = input.configPathPatch !== undefined || input.removeConfigPaths !== undefined;
  const hasLegacyPatch =
    input.config !== undefined || input.configPatch !== undefined || input.removeConfigFields !== undefined;

  if (hasPathPatch && hasLegacyPatch) {
    throw new PluginConfigPathPatchError('設定全体の変更と設定パスの変更は同時に指定できません');
  }

  if (!hasPathPatch) {
    if (input.config !== undefined) return input.config;
    if (input.configPatch === undefined && input.removeConfigFields === undefined) return undefined;

    const next = { ...current, ...(input.configPatch ?? {}) };
    for (const field of input.removeConfigFields ?? []) delete next[field];
    return next;
  }

  const next = cloneRecord(current);
  for (const operation of input.configPathPatch ?? []) {
    setExistingConfigPath(next, operation.path, operation.value);
  }
  for (const path of input.removeConfigPaths ?? []) {
    removeExistingConfigPath(next, path);
  }
  return next;
}

export function changedTopLevelConfigFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((key) => !jsonEqual(before[key], after[key])).sort();
}

function setExistingConfigPath(
  root: Record<string, unknown>,
  path: readonly PluginConfigPathSegment[],
  value: unknown,
): void {
  const { parent, key } = resolveExistingParent(root, path);
  if (typeof key === 'number') {
    if (!Array.isArray(parent) || key >= parent.length) {
      throw new PluginConfigPathPatchError('設定パスの配列indexが範囲外です');
    }
    parent[key] = cloneJsonValue(value);
    return;
  }

  if (!isRecord(parent) || !Object.hasOwn(parent, key)) {
    throw new PluginConfigPathPatchError('設定パスが現在の設定に存在しません');
  }
  parent[key] = cloneJsonValue(value);
}

function removeExistingConfigPath(
  root: Record<string, unknown>,
  path: readonly PluginConfigPathSegment[],
): void {
  const { parent, key } = resolveExistingParent(root, path);
  if (typeof key === 'number') {
    throw new PluginConfigPathPatchError('配列要素の削除は設定パス更新では実行できません');
  }
  if (!isRecord(parent) || !Object.hasOwn(parent, key)) {
    throw new PluginConfigPathPatchError('削除対象の設定パスが存在しません');
  }
  delete parent[key];
}

function resolveExistingParent(
  root: Record<string, unknown>,
  path: readonly PluginConfigPathSegment[],
): { parent: Record<string, unknown> | unknown[]; key: PluginConfigPathSegment } {
  assertValidPath(path);
  let current: unknown = root;

  for (const segment of path.slice(0, -1)) {
    if (typeof segment === 'number') {
      if (!Array.isArray(current) || segment >= current.length) {
        throw new PluginConfigPathPatchError('設定パスの配列indexが範囲外です');
      }
      current = current[segment];
      continue;
    }

    if (!isRecord(current) || !Object.hasOwn(current, segment)) {
      throw new PluginConfigPathPatchError('設定パスが現在の設定に存在しません');
    }
    current = current[segment];
  }

  if (!isRecord(current) && !Array.isArray(current)) {
    throw new PluginConfigPathPatchError('設定パスの親要素が編集可能なコンテナではありません');
  }
  return { parent: current, key: path[path.length - 1]! };
}

function assertValidPath(path: readonly PluginConfigPathSegment[]): void {
  if (path.length === 0 || path.length > MAX_CONFIG_PATH_DEPTH) {
    throw new PluginConfigPathPatchError('設定パスの深さが不正です');
  }
  for (const segment of path) {
    if (typeof segment === 'number') {
      if (!Number.isSafeInteger(segment) || segment < 0) {
        throw new PluginConfigPathPatchError('設定パスの配列indexが不正です');
      }
      continue;
    }
    if (!segment || UNSAFE_PATH_SEGMENTS.has(segment)) {
      throw new PluginConfigPathPatchError('安全でない設定パスです');
    }
  }
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, cloneJsonValue(child)]),
  );
}

function cloneJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneJsonValue);
  if (isRecord(value)) return cloneRecord(value);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
