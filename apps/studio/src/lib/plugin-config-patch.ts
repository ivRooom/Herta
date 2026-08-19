export interface PluginConfigPatchInput {
  config?: Record<string, unknown>;
  configPatch?: Record<string, unknown>;
  removeConfigFields?: readonly string[];
}

export function resolvePluginConfigCandidate(
  current: Record<string, unknown>,
  input: PluginConfigPatchInput,
): Record<string, unknown> | undefined {
  if (input.config !== undefined) return input.config;
  if (input.configPatch === undefined && input.removeConfigFields === undefined) return undefined;

  const next = { ...current, ...(input.configPatch ?? {}) };
  for (const field of input.removeConfigFields ?? []) delete next[field];
  return next;
}

export function changedTopLevelConfigFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((key) => !jsonEqual(before[key], after[key])).sort();
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
