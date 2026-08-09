import {
  formatStudioValidationPath,
  parseConfigJson,
  validateConfigForStudio,
  type ConfigObject,
  type JsonSchema,
} from './plugin-config-studio';

export type ConfigValidationIssue = {
  path: string;
  keyword: string;
  message: string;
  source: 'client' | 'server';
};

export type ConfigValidationState = {
  config: ConfigObject | null;
  issues: ConfigValidationIssue[];
  jsonError: string | null;
};

export function validateStudioDraft(
  schema: JsonSchema,
  mode: 'visual' | 'json',
  config: ConfigObject,
  jsonText: string,
): ConfigValidationState {
  let draft = config;

  if (mode === 'json') {
    try {
      draft = parseConfigJson(jsonText);
    } catch (error) {
      return {
        config: null,
        issues: [],
        jsonError: error instanceof Error ? error.message : 'JSONの形式が不正です',
      };
    }
  }

  return {
    config: draft,
    issues: validateConfigForStudio(schema, draft).map((issue) => ({
      path: formatStudioValidationPath(issue.path),
      keyword: issue.keyword,
      message: issue.message,
      source: 'client' as const,
    })),
    jsonError: null,
  };
}

export function readApiValidationIssues(result: unknown): ConfigValidationIssue[] {
  if (!isObject(result) || !Array.isArray(result.issues)) return [];

  return result.issues.flatMap((issue) => {
    if (!isObject(issue)) return [];
    if (
      typeof issue.path !== 'string' ||
      typeof issue.keyword !== 'string' ||
      typeof issue.message !== 'string'
    ) {
      return [];
    }

    return [
      {
        path: issue.path || '$',
        keyword: issue.keyword,
        message: issue.message,
        source: 'server' as const,
      },
    ];
  });
}

export function mergeValidationIssues(
  clientIssues: ConfigValidationIssue[],
  serverIssues: ConfigValidationIssue[],
): ConfigValidationIssue[] {
  const merged = new Map<string, ConfigValidationIssue>();

  for (const issue of [...clientIssues, ...serverIssues]) {
    const key = `${issue.path}\u0000${issue.keyword}\u0000${issue.message}`;
    if (!merged.has(key)) merged.set(key, issue);
  }

  return [...merged.values()];
}

export function validationIssuesAtPath(
  issues: ConfigValidationIssue[],
  path: string,
): ConfigValidationIssue[] {
  return issues.filter((issue) => issue.path === path);
}

export function validationIssueCountUnderPath(
  issues: ConfigValidationIssue[],
  path: string,
): number {
  return issues.filter(
    (issue) =>
      issue.path === path || issue.path.startsWith(`${path}.`) || issue.path.startsWith(`${path}[`),
  ).length;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
