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
export type StudioValidationPath = Array<string | number>;

export interface StudioValidationIssue {
  path: StudioValidationPath;
  message: string;
  keyword:
    | 'type'
    | 'required'
    | 'enum'
    | 'minimum'
    | 'maximum'
    | 'minLength'
    | 'maxLength'
    | 'pattern'
    | 'format'
    | 'oneOf'
    | 'anyOf';
}

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

export function validateConfigForStudio(
  schema: JsonSchema,
  value: unknown,
): StudioValidationIssue[] {
  return validateSchemaValue(schema, value, []);
}

export function formatStudioValidationPath(path: StudioValidationPath): string {
  if (path.length === 0) return '$';
  return path.reduce<string>((result, segment) => {
    if (typeof segment === 'number') return `${result}[${segment}]`;
    return result ? `${result}.${segment}` : segment;
  }, '');
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

function validateSchemaValue(
  schema: JsonSchema,
  value: unknown,
  path: StudioValidationPath,
): StudioValidationIssue[] {
  if (value === null) {
    return schemaAllowsNull(schema)
      ? []
      : [{ path, keyword: 'type', message: 'nullは許可されていません' }];
  }

  const combinatorIssues = validateCombinators(schema, value, path);
  if (combinatorIssues.length > 0) return combinatorIssues;

  const type = schemaPrimaryType(schema);
  if (!matchesSchemaType(type, value)) {
    return type
      ? [{ path, keyword: 'type', message: `値は${type}型である必要があります` }]
      : [];
  }

  const issues: StudioValidationIssue[] = [];

  if (schema.enum && !schema.enum.some((candidate) => jsonValuesEqual(candidate, value))) {
    issues.push({ path, keyword: 'enum', message: '許可されている候補から選択してください' });
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      issues.push({ path, keyword: 'minimum', message: `${schema.minimum}以上で入力してください` });
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      issues.push({ path, keyword: 'maximum', message: `${schema.maximum}以下で入力してください` });
    }
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      issues.push({
        path,
        keyword: 'minLength',
        message: `${schema.minLength}文字以上で入力してください`,
      });
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      issues.push({
        path,
        keyword: 'maxLength',
        message: `${schema.maxLength}文字以内で入力してください`,
      });
    }
    if (schema.pattern) {
      try {
        if (!new RegExp(schema.pattern, 'u').test(value)) {
          issues.push({ path, keyword: 'pattern', message: '指定された入力形式に一致しません' });
        }
      } catch {
        issues.push({ path, keyword: 'pattern', message: 'Schemaのpatternが不正です' });
      }
    }
    if (schema.format && !matchesStringFormat(schema.format, value)) {
      issues.push({
        path,
        keyword: 'format',
        message: `${schema.format}形式で入力してください`,
      });
    }
  }

  if (isConfigObject(value)) {
    for (const requiredKey of schema.required ?? []) {
      if (!(requiredKey in value) || value[requiredKey] === undefined) {
        issues.push({
          path: [...path, requiredKey],
          keyword: 'required',
          message: '必須項目です',
        });
      }
    }
    for (const [key, propertySchema] of Object.entries(schema.properties ?? {})) {
      if (!(key in value) || value[key] === undefined) continue;
      issues.push(...validateSchemaValue(propertySchema, value[key], [...path, key]));
    }
  }

  if (Array.isArray(value) && schema.items) {
    value.forEach((item, index) => {
      issues.push(...validateSchemaValue(schema.items!, item, [...path, index]));
    });
  }

  return issues;
}

function validateCombinators(
  schema: JsonSchema,
  value: unknown,
  path: StudioValidationPath,
): StudioValidationIssue[] {
  if (schema.oneOf?.length) {
    const matches = schema.oneOf.filter(
      (candidate) => validateSchemaValue(candidate, value, path).length === 0,
    ).length;
    if (matches !== 1) {
      return [
        {
          path,
          keyword: 'oneOf',
          message: 'oneOfの候補のうち1つだけに一致する必要があります',
        },
      ];
    }
  }

  if (schema.anyOf?.length) {
    const matches = schema.anyOf.some(
      (candidate) => validateSchemaValue(candidate, value, path).length === 0,
    );
    if (!matches) {
      return [
        {
          path,
          keyword: 'anyOf',
          message: 'anyOfの候補のいずれかに一致する必要があります',
        },
      ];
    }
  }

  return [];
}

function matchesSchemaType(type: string | undefined, value: unknown): boolean {
  if (!type) return true;
  if (type === 'object') return isConfigObject(value);
  if (type === 'array') return Array.isArray(value);
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'string') return typeof value === 'string';
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'null') return value === null;
  return true;
}

function matchesStringFormat(format: string, value: string): boolean {
  if (format === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value);
  if (format === 'uri' || format === 'url') {
    try {
      const parsed = new URL(value);
      return Boolean(parsed.protocol && parsed.hostname);
    } catch {
      return false;
    }
  }
  if (format === 'date-time') {
    return /^\d{4}-\d{2}-\d{2}T/u.test(value) && Number.isFinite(Date.parse(value));
  }
  if (format === 'date') {
    return /^\d{4}-\d{2}-\d{2}$/u.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`));
  }
  return true;
}

function jsonValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function cloneJsonValue<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}
