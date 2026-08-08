export type JsonSchema = {
  type?: string | string[];
  title?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  nullable?: boolean;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  ['x-herta-ui']?: {
    widget?:
      | 'text'
      | 'textarea'
      | 'discord-channel'
      | 'discord-role'
      | 'discord-user'
      | 'discord-emoji'
      | 'discord-message-target'
      | string;
    section?: string;
    placeholder?: string;
    help?: string;
    destructive?: boolean;
    multiple?: boolean;
    editableOnly?: boolean;
    mentionableOnly?: boolean;
  };
};

export type ConfigObject = Record<string, unknown>;

export function isConfigObject(value: unknown): value is ConfigObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function schemaAllowsNull(schema: JsonSchema): boolean {
  if (schema.nullable) return true;
  return Array.isArray(schema.type) && schema.type.includes('null');
}

export function schemaPrimaryType(schema: JsonSchema): string | undefined {
  if (typeof schema.type === 'string') return schema.type;
  if (Array.isArray(schema.type)) return schema.type.find((type) => type !== 'null');
  if (schema.properties) return 'object';
  if (schema.items) return 'array';
  return undefined;
}

export function makeDefaultValue(schema: JsonSchema): unknown {
  if (schema.default !== undefined) return cloneJsonValue(schema.default);

  const type = schemaPrimaryType(schema);
  if (type === 'object') {
    const result: ConfigObject = {};
    for (const [key, propertySchema] of Object.entries(schema.properties ?? {})) {
      const value = makeDefaultValue(propertySchema);
      if (value !== undefined) result[key] = value;
    }
    return result;
  }

  if (type === 'array') return [];
  if (schemaAllowsNull(schema)) return null;
  if (schema.enum?.length) return cloneJsonValue(schema.enum[0]);
  if (type === 'boolean') return false;
  if (type === 'integer' || type === 'number') return schema.minimum ?? 0;
  if (type === 'string') return '';
  return undefined;
}

export function applySchemaDefaults(schema: JsonSchema, value: unknown): unknown {
  if (value === undefined) return makeDefaultValue(schema);
  if (value === null) return schemaAllowsNull(schema) ? null : makeDefaultValue(schema);

  const type = schemaPrimaryType(schema);
  if (type === 'object') {
    const source = isConfigObject(value) ? value : {};
    const result: ConfigObject = { ...source };
    for (const [key, propertySchema] of Object.entries(schema.properties ?? {})) {
      const next = applySchemaDefaults(propertySchema, source[key]);
      if (next !== undefined) result[key] = next;
    }
    return result;
  }

  if (type === 'array') {
    if (!Array.isArray(value)) return [];
    if (!schema.items) return value.map(cloneJsonValue);
    return value.map((item) => applySchemaDefaults(schema.items!, item));
  }

  return cloneJsonValue(value);
}

export function normalizeConfigForStudio(schema: JsonSchema, value: unknown): ConfigObject {
  const normalized = applySchemaDefaults(schema, value);
  return isConfigObject(normalized) ? normalized : {};
}

export function parseConfigJson(text: string): ConfigObject {
  const parsed = JSON.parse(text) as unknown;
  if (!isConfigObject(parsed)) throw new Error('設定JSONはオブジェクト形式で入力してください');
  return parsed;
}

export function stringifyConfig(config: ConfigObject): string {
  return JSON.stringify(config, null, 2);
}

export function updateConfigValue(
  root: unknown,
  path: Array<string | number>,
  nextValue: unknown,
): unknown {
  if (path.length === 0) return nextValue;

  const [head, ...rest] = path;
  if (typeof head === 'number') {
    const source = Array.isArray(root) ? root : [];
    const copy = [...source];
    copy[head] = updateConfigValue(copy[head], rest, nextValue);
    return copy;
  }

  const source = isConfigObject(root) ? root : {};
  return {
    ...source,
    [head]: updateConfigValue(source[head], rest, nextValue),
  };
}

export function removeConfigValue(root: unknown, path: Array<string | number>): unknown {
  if (path.length === 0) return undefined;
  const [head, ...rest] = path;

  if (typeof head === 'number') {
    const source = Array.isArray(root) ? [...root] : [];
    if (rest.length === 0) {
      source.splice(head, 1);
      return source;
    }
    source[head] = removeConfigValue(source[head], rest);
    return source;
  }

  const source = isConfigObject(root) ? { ...root } : {};
  if (rest.length === 0) {
    delete source[head];
    return source;
  }
  source[head] = removeConfigValue(source[head], rest);
  return source;
}

export function moveArrayItem(value: unknown, fromIndex: number, toIndex: number): unknown[] {
  const source = Array.isArray(value) ? [...value] : [];
  if (
    fromIndex < 0 ||
    fromIndex >= source.length ||
    toIndex < 0 ||
    toIndex >= source.length ||
    fromIndex === toIndex
  ) {
    return source;
  }

  const [item] = source.splice(fromIndex, 1);
  source.splice(toIndex, 0, item);
  return source;
}

export function fieldMatchesSearch(key: string, schema: JsonSchema, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase('ja');
  if (!normalized) return true;

  const haystack = [key, schema.title, schema.description, schema['x-herta-ui']?.help]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLocaleLowerCase('ja');

  if (haystack.includes(normalized)) return true;
  return Object.entries(schema.properties ?? {}).some(([childKey, childSchema]) =>
    fieldMatchesSearch(childKey, childSchema, normalized),
  );
}

function cloneJsonValue<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}
