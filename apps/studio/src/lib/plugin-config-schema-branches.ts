import {
  applySchemaDefaults,
  isConfigObject,
  schemaPrimaryType,
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
  const withDefaults = mergeDefaultsPreservingValue(value, applySchemaDefaults(branch, value));

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
    resolved = mergeSchemas(resolved, extended.oneOf[activeIndex] ?? {});
  }

  if (extended.anyOf?.length) {
    const discriminator = inferDiscriminator(extended.anyOf);
    const activeIndexes = getActiveBranchIndexes(extended.anyOf, value, 'anyOf', discriminator);
    const indexes = activeIndexes.length > 0 ? activeIndexes : [0];
    for (const index of indexes) {
      resolved = mergeSchemas(resolved, extended.anyOf[index] ?? {});
    }
  }

  if (extended.if) {
    const conditionalBranch = schemaMatchesValue(extended.if, value)
      ? extended.then
      : extended.else;
    if (conditionalBranch) resolved = mergeSchemas(resolved, conditionalBranch);
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

  if (resolved.items && Array.isArray(value)) {
    resolved = {
      ...resolved,
      items: resolveArrayItemSchema(resolved.items, value),
    };
  }

  return resolved;
}

export function schemaMatchesValue(schema: JsonSchema, value: unknown): boolean {
  const extended = schema as ExtendedJsonSchema;

  if ('const' in extended && !jsonValuesEqual(extended.const, value)) return false;
  if (extended.enum && !extended.enum.some((candidate) => jsonValuesEqual(candidate, value)))
    return false;

  const type = schemaPrimaryType(extended);
  if (type && !matchesType(type, value)) return false;

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

function mergeSchemas(base: JsonSchema, branch: ExtendedJsonSchema): JsonSchema {
  const cleanBranch = withoutConditionalKeywords(branch);
  const required = [...new Set([...(base.required ?? []), ...(cleanBranch.required ?? [])])];

  return {
    ...base,
    ...cleanBranch,
    properties:
      base.properties || cleanBranch.properties
        ? { ...(base.properties ?? {}), ...(cleanBranch.properties ?? {}) }
        : undefined,
    required: required.length > 0 ? required : undefined,
    ['x-herta-ui']:
      base['x-herta-ui'] || cleanBranch['x-herta-ui']
        ? { ...(base['x-herta-ui'] ?? {}), ...(cleanBranch['x-herta-ui'] ?? {}) }
        : undefined,
  };
}

function resolveArrayItemSchema(schema: JsonSchema, values: unknown[]): JsonSchema {
  const first = values[0];
  return resolveSchemaForValue(schema, first);
}

function mergeDefaultsPreservingValue(current: unknown, defaults: unknown): unknown {
  if (isConfigObject(current) && isConfigObject(defaults)) {
    const result: ConfigObject = { ...defaults };
    for (const [key, value] of Object.entries(current)) {
      result[key] = key in defaults ? mergeDefaultsPreservingValue(value, defaults[key]) : value;
    }
    return result;
  }

  if (Array.isArray(current)) return current.map(cloneJsonValue);
  return current === undefined ? cloneJsonValue(defaults) : cloneJsonValue(current);
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
