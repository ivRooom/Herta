import type { ErrorObject } from 'ajv';

export type PluginConfigValidationIssue = {
  path: string;
  keyword: string;
  message: string;
};

export function toPluginConfigValidationIssues(
  errors: ErrorObject[],
): PluginConfigValidationIssue[] {
  return errors.map((error) => ({
    path: formatAjvInstancePath(error),
    keyword: error.keyword,
    message: formatAjvErrorMessage(error),
  }));
}

function formatAjvInstancePath(error: ErrorObject): string {
  const segments = parseJsonPointer(error.instancePath);

  if (error.keyword === 'required') {
    const missingProperty = readStringParam(error.params, 'missingProperty');
    if (missingProperty) segments.push(missingProperty);
  }

  if (segments.length === 0) return '$';

  return segments.reduce<string>((result, segment) => {
    if (/^\d+$/u.test(segment)) return `${result}[${segment}]`;
    return result ? `${result}.${segment}` : segment;
  }, '');
}

function parseJsonPointer(pointer: string): string[] {
  if (!pointer) return [];
  return pointer
    .split('/')
    .slice(1)
    .map((segment) => segment.replace(/~1/gu, '/').replace(/~0/gu, '~'));
}

function formatAjvErrorMessage(error: ErrorObject): string {
  switch (error.keyword) {
    case 'required':
      return '必須項目です';
    case 'type': {
      const expected = readStringParam(error.params, 'type');
      return expected ? `${expected}型で入力してください` : '値の型が正しくありません';
    }
    case 'enum':
      return '許可されている候補から選択してください';
    case 'minimum': {
      const limit = readNumberParam(error.params, 'limit');
      return limit === undefined ? '最小値を下回っています' : `${limit}以上で入力してください`;
    }
    case 'maximum': {
      const limit = readNumberParam(error.params, 'limit');
      return limit === undefined ? '最大値を超えています' : `${limit}以下で入力してください`;
    }
    case 'minLength': {
      const limit = readNumberParam(error.params, 'limit');
      return limit === undefined ? '文字数が不足しています' : `${limit}文字以上で入力してください`;
    }
    case 'maxLength': {
      const limit = readNumberParam(error.params, 'limit');
      return limit === undefined ? '文字数が多すぎます' : `${limit}文字以内で入力してください`;
    }
    case 'pattern':
      return '指定された入力形式に一致しません';
    case 'format': {
      const format = readStringParam(error.params, 'format');
      return format ? `${format}形式で入力してください` : '入力形式が正しくありません';
    }
    case 'oneOf':
      return '候補のうち1つだけに一致する必要があります';
    case 'anyOf':
      return '候補のいずれかに一致する必要があります';
    default:
      return error.message ?? '設定値が不正です';
  }
}

function readStringParam(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  return typeof value === 'string' ? value : undefined;
}

function readNumberParam(params: Record<string, unknown>, key: string): number | undefined {
  const value = params[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
