from pathlib import Path

lib_path = Path('apps/studio/src/lib/plugin-config-studio.ts')
lib = lib_path.read_text()

lib = lib.replace(
    "  items?: JsonSchema;\n  oneOf?: JsonSchema[];",
    "  items?: JsonSchema;\n  minItems?: number;\n  maxItems?: number;\n  oneOf?: JsonSchema[];",
    1,
)

primary_marker = '''export function schemaPrimaryType(schema: JsonSchema): string | undefined {
  if (typeof schema.type === 'string') return schema.type;
  if (Array.isArray(schema.type)) return schema.type.find((type) => type !== 'null');
  if (schema.properties) return 'object';
  if (schema.items) return 'array';
  return undefined;
}
'''
helper = primary_marker + '''
export function resolveArrayItemBounds(schema: JsonSchema): {
  minItems: number;
  maxItems: number | undefined;
} {
  const rawMin = schema.minItems;
  const rawMax = schema.maxItems;
  const minItems =
    typeof rawMin === 'number' && Number.isSafeInteger(rawMin) && rawMin >= 0 ? rawMin : 0;
  const validMax =
    typeof rawMax === 'number' && Number.isSafeInteger(rawMax) && rawMax >= 0
      ? rawMax
      : undefined;

  return {
    minItems,
    maxItems: validMax === undefined ? undefined : Math.max(minItems, validMax),
  };
}
'''
if primary_marker not in lib:
    raise SystemExit('schemaPrimaryType marker not found')
lib = lib.replace(primary_marker, helper, 1)
lib_path.write_text(lib)

form_path = Path('apps/studio/src/components/plugin-config-studio-form.tsx')
form = form_path.read_text()
form = form.replace(
    "  removeConfigValue,\n  schemaAllowsNull,",
    "  removeConfigValue,\n  resolveArrayItemBounds,\n  schemaAllowsNull,",
    1,
)

array_head = '''  if (type === 'array') {
    const items = Array.isArray(value) ? value : [];
    const itemSchema = schema.items ?? {};
    return (
'''
array_head_new = '''  if (type === 'array') {
    const items = Array.isArray(value) ? value : [];
    const itemSchema = schema.items ?? {};
    const { minItems, maxItems } = resolveArrayItemBounds(schema);
    const atMinimum = items.length <= minItems;
    const atMaximum = maxItems !== undefined && items.length >= maxItems;
    return (
'''
if array_head not in form:
    raise SystemExit('array head not found')
form = form.replace(array_head, array_head_new, 1)

old_delete = '''                  <SmallButton label="削除" danger onClick={() => onRemove([...path, index])} />'''
new_delete = '''                  <SmallButton
                    label="削除"
                    danger
                    disabled={atMinimum}
                    onClick={() => onRemove([...path, index])}
                  />'''
if old_delete not in form:
    raise SystemExit('delete button not found')
form = form.replace(old_delete, new_delete, 1)

old_add = '''          <button
            type="button"
            onClick={() => onChange(path, [...items, makeDefaultValue(itemSchema)])}
            className="w-full rounded-xl border border-dashed border-primary/40 bg-primary/5 px-4 py-3 text-sm font-medium text-primary transition hover:bg-primary/10"
          >
            ＋ 項目を追加
          </button>'''
new_add = '''          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
            <span>現在 {items.length}件</span>
            <span>
              {minItems > 0 ? `最小 ${minItems}件` : '最小制限なし'}
              {' / '}
              {maxItems !== undefined ? `最大 ${maxItems}件` : '最大制限なし'}
            </span>
          </div>
          <button
            type="button"
            disabled={atMaximum}
            onClick={() => onChange(path, [...items, makeDefaultValue(itemSchema)])}
            className="w-full rounded-xl border border-dashed border-primary/40 bg-primary/5 px-4 py-3 text-sm font-medium text-primary transition hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-primary/5"
          >
            {atMaximum ? `最大 ${maxItems}件までです` : '＋ 項目を追加'}
          </button>'''
if old_add not in form:
    raise SystemExit('add button not found')
form = form.replace(old_add, new_add, 1)
form_path.write_text(form)

# Add regression coverage to the existing Config Studio test file.
test_path = Path('apps/studio/src/lib/plugin-config-studio.test.ts')
test_text = test_path.read_text()
test_text = test_text.replace(
    "  removeConfigValue,\n  stringifyConfig,",
    "  removeConfigValue,\n  resolveArrayItemBounds,\n  stringifyConfig,",
    1,
)
marker = "test('array itemを削除・並び替えできる', () => {\n"
if marker not in test_text:
    raise SystemExit('array test marker not found')
new_test = '''test('array minItems/maxItemsを安全なUI境界へ解決する', () => {
  assert.deepEqual(resolveArrayItemBounds({ type: 'array', minItems: 2, maxItems: 5 }), {
    minItems: 2,
    maxItems: 5,
  });
  assert.deepEqual(resolveArrayItemBounds({ type: 'array', minItems: 3, maxItems: 1 }), {
    minItems: 3,
    maxItems: 3,
  });
  assert.deepEqual(resolveArrayItemBounds({ type: 'array', minItems: -1, maxItems: -1 }), {
    minItems: 0,
    maxItems: undefined,
  });
});

'''
test_text = test_text.replace(marker, new_test + marker, 1)
test_path.write_text(test_text)
