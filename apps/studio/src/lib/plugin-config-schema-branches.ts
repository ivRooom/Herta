import {
  applySchemaDefaults,
  isConfigObject,
  type ConfigObject,
  type JsonSchema,
} from './plugin-config-studio.ts';

type ExtendedJsonSchema = JsonSchema & {
  const?: unknown;
  if?: ExtendedJsonSchema;
  then?: ExtendedJsonSchema;
  else?: ExtendedJsonSchema;
  oneOf?: ExtendedJsonSchema[];
  anyOf?: ExtendedJsonSchema[];
  properties?: Record<string, ExtendedJsonSchema>;
  items?: ExtendedJsonSchema;
  ['x-herta-ui']?: JsonSchema['x-herta-ui'] & {
    branchLabel?: string;
    optionLabel?: string;
  };
};

export type SchemaBranchMode = 'oneOf' | 'anyOf';

export type SchemaBranchOption = {
  index: number;
  label: string;
  active: boolean;
  discriminatorKey: string | null;
  discriminatorValue: unknown;
};

export type SchemaBranchState = {
  mode: SchemaBranchMode;
  label: string;
  options: SchemaBranchOption[];
};

export function getSchemaBranchState(schema: JsonSchema, value: unknown): SchemaBranchState | null {
  const extended = schema as ExtendedJsonSchema;
  const mode: SchemaBranchMode | null = extended.oneOf?.length
    ? 'oneOf'
    : extended.anyOf?.length
      ? 'anyOf'
      : null;
  if (!mode) return null;

  const branches = extended[mode] ?? [];
  const discriminator = inferDiscriminator(branches);
  const activeIndexes = getActiveBranchIndexes(branches, value, mode, discriminator);

  return {
    mode,
    label: extended['x-herta-ui']?.branchLabel ?? (mode === 'oneOf' ? '設定タイプ' : '設定候補'),
    options: branches.map((branch, index) => ({
      index,
      label: branch['x-herta-ui']?.optionLabel ?? branch.title ?? `候補 ${index + 1}`,
      active: activeIndexes.includes(index),
      discriminatorKey: discriminator?.key ?? null,
      discriminatorValue: discriminator?.values[index],
    })),
  };
}

export function selectSchemaBranch(schema: JsonSchema, value: unknown, index: number): unknown {
  const extended = schema as ExtendedJsonSchema;
  const branches = extended.oneOf?.length ? extended.oneOf : (extended.anyOf ?? []);
  const branch = branches[index];
  if (!branch) return value;

  const discriminator = inferDiscriminator(branches);
  const branchValue =
    discriminator && isConfigObject(value)
      ? { ...value, [discriminator.key]: cloneJsonValue(discriminator.values[index]) }
      : value;
  const effectiveBranch = resolveSchemaForValue(branch, branchValue);
  const withDefaults = mergeDefaultsPreservingValue(
    branchValue,
    applySchemaDefaults(effectiveBranch, branchValue),
  );

  if (!discriminator || !isConfigObject(withDefaults)) return withDefaults;
  return {
    ...withDefaults,
    [discriminator.key]: cloneJsonValue(discriminator.values[index]),
  };
}

export function resolveSchemaForValue(schema: JsonSchema, value: unknown): JsonSchema {
  const extended = schema as ExtendedJsonSchema;
  let resolved = withoutConditionalKeywords(extended);

  if (extended.oneOf?.length) {
    const discriminator = inferDiscriminator(extended.oneOf);
    const [activeIndex = 0] = getActiveBranchIndexes(extended.oneOf, value, 'oneOf', discriminator);
    const activeBranch = extended.oneOf[activeIndex];
    if (activeBranch) resolved = mergeSchemas(resolved, resolveSchemaForValue(activeBranch, value));
  }

  if (extended.anyOf?.length) {
    const discriminator = inferDiscriminator(extended.anyOf);
    const activeIndexes = getActiveBranchIndexes(extended.anyOf, value, 'anyOf', discriminator);
    const indexes = activeIndexes.length > 0 ? activeIndexes : [0];
    for (const index of indexes) {
      const activeBranch = extended.anyOf[index];
      if (activeBranch)
        resolved = mergeSchemas(resolved, resolveSchemaForValue(activeBranch, value));
    }
  }

  if (extended.if) {
    const conditionalBranch = schemaMatchesValue(extended.if, value)
      ? extended.then
      : extended.else;
    if (conditionalBranch) {
      resolved = mergeSchemas(resolved, resolveSchemaForValue(conditionalBranch, value));
    }
  }

  if (resolved.properties && isConfigObject(value)) {
    resolved = {
      ...resolved,
      properties: Object.fromEntries(
        Object.entries(resolved.properties).map(([key, propertySchema]) => [
          key,
          resolveSchemaForValue(propertySchema, value[key]),
        ]),
      ),
    };
  }

  return resolved;
}

export function resolveSchemaForArrayItem(schema: JsonSchema, value: unknown): JsonSchema {
  return resolveSchemaForValue(schema, value);
}

export function schemaMatchesValue(schema: JsonSchema, value: unknown): boolean {
  const extended = schema as ExtendedJsonSchema;

  if ('const' in extended && !jsonValuesEqual(extended.const, value)) return false;
  if (extended.enum && !extended.enum.some((candidate) => jsonValuesEqual(candidate, value)))
    return false;

  if (!matchesAllowedTypes(extended, value)) return false;

  if (typeof value === 'number') {
    if (extended.minimum !== undefined && value < extended.minimum) return false;
    if (extended.maximum !== undefined && value > extended.maximum) return false;
  }

  if (typeof value === 'string') {
    const length = [...value].length;
    if (extended.minLength !== undefined && length < extended.minLength) return false;
    if (extended.maxLength !== undefined && length > extended.maxLength) return false;
    if (extended.pattern) {
      try {
        if (!new RegExp(extended.pattern, 'u').test(value)) return false;
      } catch {
        return false;
      }
    }
  }

  if (isConfigObject(value)) {
    for (const requiredKey of extended.required ?? []) {
      if (!(requiredKey in value)) return false;
    }
    for (const [key, propertySchema] of Object.entries(extended.properties ?? {})) {
      if (!(key in value)) continue;
      if (!schemaMatchesValue(propertySchema, value[key])) return false;
    }
  }

  if (Array.isArray(value) && extended.items) {
    if (!value.every((item) => schemaMatchesValue(extended.items!, item))) return false;
  }

  if (extended.if) {
    const conditionalBranch = schemaMatchesValue(extended.if, value)
      ? extended.then
      : extended.else;
    if (conditionalBranch && !schemaMatchesValue(conditionalBranch, value)) return false;
  }

  if (extended.oneOf?.length) {
    if (extended.oneOf.filter((branch) => schemaMatchesValue(branch, value)).length !== 1)
      return false;
  }
  if (extended.anyOf?.length) {
    if (!extended.anyOf.some((branch) => schemaMatchesValue(branch, value))) return false;
  }

  return true;
}

function getActiveBranchIndexes(
  branches: ExtendedJsonSchema[],
  value: unknown,
  mode: SchemaBranchMode,
  discriminator: { key: string; values: unknown[] } | null,
): number[] {
  if (discriminator && isConfigObject(value)) {
    const current = value[discriminator.key];
    const index = discriminator.values.findIndex((candidate) =>
      jsonValuesEqual(candidate, current),
    );
    if (index >= 0) return [index];
  }

  const matching = branches.flatMap((branch, index) =>
    schemaMatchesValue(branch, value) ? [index] : [],
  );
  if (mode === 'oneOf') return matching.length === 1 ? matching : matching.slice(0, 1);
  return matching;
}

function inferDiscriminator(
  branches: ExtendedJsonSchema[],
): { key: string; values: unknown[] } | null {
  if (branches.length < 2) return null;

  const firstProperties = branches[0]?.properties ?? {};
  for (const key of Object.keys(firstProperties)) {
    const values: unknown[] = [];
    let valid = true;

    for (const branch of branches) {
      const property = branch.properties?.[key] as ExtendedJsonSchema | undefined;
      const candidate = property ? readSingleValue(property) : undefined;
      if (candidate === undefined) {
        valid = false;
        break;
      }
      values.push(candidate);
    }

    if (valid && new Set(values.map((item) => JSON.stringify(item))).size === branches.length) {
      return { key, values };
    }
  }

  return null;
}

function readSingleValue(schema: ExtendedJsonSchema): unknown {
  if ('const' in schema) return schema.const;
  if (schema.enum?.length === 1) return schema.enum[0];
  return undefined;
}

function withoutConditionalKeywords(schema: ExtendedJsonSchema): JsonSchema {
  const { oneOf: _oneOf, anyOf: _anyOf, if: _if, then: _then, else: _else, ...base } = schema;
  return base;
}

function mergeSchemas(base: JsonSchema, branch: JsonSchema): JsonSchema {
  const required = [...new Set([...(base.required ?? []), ...(branch.required ?? [])])];

  return {
    ...base,
    ...branch,
    properties: mergePropertyMaps(base.properties, branch.properties),
    required: required.length > 0 ? required : undefined,
    ['x-herta-ui']:
      base['x-herta-ui'] || branch['x-herta-ui']
        ? { ...(base['x-herta-ui'] ?? {}), ...(branch['x-herta-ui'] ?? {}) }
        : undefined,
  };
}

function mergePropertyMaps(
  base: Record<string, JsonSchema> | undefined,
  branch: Record<string, JsonSchema> | undefined,
): Record<string, JsonSchema> | undefined {
  if (!base && !branch) return undefined;
  const keys = new Set([...Object.keys(base ?? {}), ...Object.keys(branch ?? {})]);
  return Object.fromEntries(
    [...keys].map((key) => {
      const baseSchema = base?.[key];
      const branchSchema = branch?.[key];
      if (baseSchema && branchSchema) return [key, mergeSchemas(baseSchema, branchSchema)];
      return [key, branchSchema ?? baseSchema ?? {}];
    }),
  );
}

function mergeDefaultsPreservingValue(current: unknown, defaults: unknown): unknown {
  if (isConfigObject(current) && isConfigObject(defaults)) {
    const result: ConfigObject = { ...defaults };
    for (const [key, value] of Object.entries(current)) {
      result[key] = key in defaults ? mergeDefaultsPreservingValue(value, defaults[key]) : value;
    }
    return result;
  }

  if (Array.isArray(current)) {
    const defaultItems = Array.isArray(defaults) ? defaults : [];
    return current.map((item, index) => mergeDefaultsPreservingValue(item, defaultItems[index]));
  }
  return current === undefined ? cloneJsonValue(defaults) : cloneJsonValue(current);
}

function matchesAllowedTypes(schema: ExtendedJsonSchema, value: unknown): boolean {
  const declaredTypes = Array.isArray(schema.type)
    ? schema.type
    : typeof schema.type === 'string'
      ? [schema.type]
      : [];

  if (schema.nullable && !declaredTypes.includes('null')) declaredTypes.push('null');
  if (declaredTypes.length === 0) return true;
  return declaredTypes.some((type) => matchesType(type, value));
}

function matchesType(type: string, value: unknown): boolean {
  switch (type) {
    case 'object':
      return isConfigObject(value);
    case 'array':
      return Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'boolean':
      return typeof value === 'boolean';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'null':
      return value === null;
    default:
      return true;
  }
}

function jsonValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function cloneJsonValue<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}
