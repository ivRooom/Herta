const MAX_SCHEMA_PATH_DEPTH = 8;
const MAX_SCHEMA_PERMISSION_FIELDS = 512;

export type PluginConfigPathSegment = string | number;

export interface PluginConfigPermissionField {
  path: string;
  topLevelKey: string;
  label: string;
  description: string;
  depth: number;
}

export interface ConcretePluginConfigValue {
  path: PluginConfigPathSegment[];
  permissionPath: string;
  label: string;
  value: unknown;
}

const MISSING = Symbol('missing-plugin-config-value');

export function pluginConfigPermissionFields(
  schema: Record<string, unknown>,
): PluginConfigPermissionField[] {
  const properties = recordValue(schema['properties']);
  if (!properties) return [];

  const fields: PluginConfigPermissionField[] = [];
  for (const [key, rawNode] of Object.entries(properties)) {
    if (fields.length >= MAX_SCHEMA_PERMISSION_FIELDS) break;
    const node = recordValue(rawNode) ?? {};
    const label = text(node['title']) || humanizeKey(key);
    fields.push({
      path: key,
      topLevelKey: key,
      label,
      description: text(node['description']),
      depth: 0,
    });
    collectNestedPermissionFields(node, key, key, label, 1, fields);
  }
  return fields;
}

export function topLevelConfigFieldKeys(schema: Record<string, unknown>): string[] {
  const properties = recordValue(schema['properties']);
  return properties ? Object.keys(properties) : [];
}

export function pluginConfigPermissionPaths(schema: Record<string, unknown>): string[] {
  return pluginConfigPermissionFields(schema).map((field) => field.path);
}

export function configPathAncestorPaths(path: string): string[] {
  const normalized = path.trim();
  if (!normalized) return [];

  const tokens = normalized.split('.').filter(Boolean);
  if (tokens.length === 0) return [];
  const ancestors: string[] = [];
  let prefix = '';

  for (const token of tokens) {
    prefix = prefix ? `${prefix}.${token}` : token;
    let containerPath = prefix;
    while (containerPath.endsWith('[]')) containerPath = containerPath.slice(0, -2);
    if (containerPath && !ancestors.includes(containerPath)) ancestors.push(containerPath);
  }
  if (!ancestors.includes(normalized)) ancestors.push(normalized);
  return ancestors;
}

export function resolvePluginConfigPermissionPath(
  schema: Record<string, unknown>,
  segments: readonly PluginConfigPathSegment[],
): string | null {
  if (segments.length === 0 || segments.length > MAX_SCHEMA_PATH_DEPTH * 2) return null;

  let node: Record<string, unknown> = schema;
  let canonical = '';
  for (const segment of segments) {
    if (typeof segment === 'string') {
      const properties = recordValue(node['properties']);
      const child = properties ? recordValue(properties[segment]) : null;
      if (!child) return null;
      canonical = canonical ? `${canonical}.${segment}` : segment;
      node = child;
      continue;
    }

    if (!Number.isSafeInteger(segment) || segment < 0) return null;
    const items = recordValue(node['items']);
    if (!items) return null;
    canonical += '[]';
    node = items;
  }

  const permissionPaths = new Set(pluginConfigPermissionPaths(schema));
  return permissionPaths.has(canonical) ? canonical : null;
}

export function filterPluginConfigByReadablePaths(
  config: Record<string, unknown>,
  schema: Record<string, unknown>,
  canRead: (permissionPath: string) => boolean,
): Record<string, unknown> {
  const filtered = filterNode(config, schema, '', canRead);
  return isRecord(filtered) ? filtered : {};
}

export function listConcretePluginConfigValues(
  config: Record<string, unknown>,
  schema: Record<string, unknown>,
): ConcretePluginConfigValue[] {
  const labels = new Map(
    pluginConfigPermissionFields(schema).map((field) => [field.path, field.label]),
  );
  const values: ConcretePluginConfigValue[] = [];
  collectConcreteValues(config, schema, [], '', '', labels, values);
  return values;
}

function collectNestedPermissionFields(
  node: Record<string, unknown>,
  path: string,
  topLevelKey: string,
  parentLabel: string,
  depth: number,
  fields: PluginConfigPermissionField[],
): void {
  if (depth > MAX_SCHEMA_PATH_DEPTH || fields.length >= MAX_SCHEMA_PERMISSION_FIELDS) return;

  const properties = recordValue(node['properties']);
  if (properties) {
    for (const [key, rawChild] of Object.entries(properties)) {
      if (fields.length >= MAX_SCHEMA_PERMISSION_FIELDS) return;
      const child = recordValue(rawChild) ?? {};
      const childPath = `${path}.${key}`;
      const childLabel = text(child['title']) || humanizeKey(key);
      fields.push({
        path: childPath,
        topLevelKey,
        label: `${parentLabel} / ${childLabel}`,
        description: text(child['description']),
        depth,
      });
      collectNestedPermissionFields(
        child,
        childPath,
        topLevelKey,
        `${parentLabel} / ${childLabel}`,
        depth + 1,
        fields,
      );
    }
    return;
  }

  const items = recordValue(node['items']);
  if (!items) return;
  const itemProperties = recordValue(items['properties']);
  if (itemProperties) {
    const itemPath = `${path}[]`;
    for (const [key, rawChild] of Object.entries(itemProperties)) {
      if (fields.length >= MAX_SCHEMA_PERMISSION_FIELDS) return;
      const child = recordValue(rawChild) ?? {};
      const childPath = `${itemPath}.${key}`;
      const childLabel = text(child['title']) || humanizeKey(key);
      fields.push({
        path: childPath,
        topLevelKey,
        label: `${parentLabel} / ${childLabel}`,
        description: text(child['description']),
        depth,
      });
      collectNestedPermissionFields(
        child,
        childPath,
        topLevelKey,
        `${parentLabel} / ${childLabel}`,
        depth + 1,
        fields,
      );
    }
  }
}

function filterNode(
  value: unknown,
  schema: Record<string, unknown>,
  permissionPath: string,
  canRead: (permissionPath: string) => boolean,
): unknown | typeof MISSING {
  const properties = recordValue(schema['properties']);
  if (properties) {
    if (!isRecord(value)) return MISSING;
    const output: Record<string, unknown> = {};
    for (const [key, childValue] of Object.entries(value)) {
      const childSchema = recordValue(properties[key]);
      if (!childSchema) continue;
      const childPath = permissionPath ? `${permissionPath}.${key}` : key;
      const filtered = filterNode(childValue, childSchema, childPath, canRead);
      if (filtered !== MISSING) output[key] = filtered;
    }
    if (Object.keys(output).length > 0) return output;
    if (permissionPath && canRead(permissionPath) && Object.keys(value).length === 0) return {};
    return permissionPath ? MISSING : output;
  }

  const items = recordValue(schema['items']);
  if (items) {
    if (!Array.isArray(value)) return MISSING;
    if (!recordValue(items['properties']) && !recordValue(items['items'])) {
      return canRead(permissionPath) ? cloneJsonValue(value) : MISSING;
    }
    if (value.length === 0) return canRead(permissionPath) ? [] : MISSING;
    const output: unknown[] = [];
    let hasVisibleValue = false;
    for (const item of value) {
      const filtered = filterNode(item, items, `${permissionPath}[]`, canRead);
      if (filtered === MISSING) {
        output.push(null);
      } else {
        output.push(filtered);
        hasVisibleValue = true;
      }
    }
    return hasVisibleValue ? output : MISSING;
  }

  return canRead(permissionPath) ? cloneJsonValue(value) : MISSING;
}

function collectConcreteValues(
  value: unknown,
  schema: Record<string, unknown>,
  segments: PluginConfigPathSegment[],
  permissionPath: string,
  fallbackLabel: string,
  labels: ReadonlyMap<string, string>,
  output: ConcretePluginConfigValue[],
): void {
  if (segments.length > MAX_SCHEMA_PATH_DEPTH * 2) return;
  const properties = recordValue(schema['properties']);
  if (properties && isRecord(value)) {
    for (const [key, childValue] of Object.entries(value)) {
      const childSchema = recordValue(properties[key]);
      if (!childSchema) continue;
      const childPath = permissionPath ? `${permissionPath}.${key}` : key;
      collectConcreteValues(
        childValue,
        childSchema,
        [...segments, key],
        childPath,
        labels.get(childPath) ?? humanizeKey(key),
        labels,
        output,
      );
    }
    return;
  }

  const items = recordValue(schema['items']);
  if (
    items &&
    Array.isArray(value) &&
    (recordValue(items['properties']) || recordValue(items['items']))
  ) {
    value.forEach((item, index) => {
      collectConcreteValues(
        item,
        items,
        [...segments, index],
        `${permissionPath}[]`,
        `${fallbackLabel || labels.get(permissionPath) || permissionPath} #${index + 1}`,
        labels,
        output,
      );
    });
    return;
  }

  if (!permissionPath) return;
  output.push({
    path: segments,
    permissionPath,
    label: labels.get(permissionPath) ?? (fallbackLabel || permissionPath),
    value: cloneJsonValue(value),
  });
}

function cloneJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneJsonValue);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, cloneJsonValue(child)]),
    );
  }
  return value;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function humanizeKey(value: string): string {
  const normalized = value
    .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .replace(/[_-]+/gu, ' ')
    .trim();
  if (!normalized) return value;
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}
