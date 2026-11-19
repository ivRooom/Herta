import type { DailySpecialDayRuleRow } from '@herta/db';

/**
 * Special-day overrides for the 09:00 announcement (#705): a rule
 * replaces the announcement title and/or the intro line (the plugin
 * messageTemplate) for one JST date. Resolution is a pure function
 * of the guild's rules and the JST date: an exact-date rule beats an
 * annual month-day rule, disabled rules never fire, and an annual
 * 02-29 rule only matches in leap years because the JST date itself
 * only exists then. Everything else about the announcement (title
 * URL, claim buttons, deadline, anniversaries, bundle) is untouched.
 */
export interface SpecialDayOverride {
  ruleId: string;
  kind: 'date' | 'annual';
  title: string | null;
  intro: string | null;
}

const JST_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Discord embed limits: title 256 chars; the intro heads the description. */
const TITLE_MAX = 256;
const INTRO_MAX = 1000;

function normalizeText(value: string | null, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function toOverride(rule: DailySpecialDayRuleRow): SpecialDayOverride | null {
  const title = normalizeText(rule.title, TITLE_MAX);
  const intro = normalizeText(rule.intro, INTRO_MAX);
  if (title === null && intro === null) return null;
  return { ruleId: rule.id, kind: rule.kind, title, intro };
}

export function resolveSpecialDayOverride(
  rules: readonly DailySpecialDayRuleRow[],
  dateJst: string,
): SpecialDayOverride | null {
  if (!JST_DATE.test(dateJst)) return null;
  const monthDay = dateJst.slice(5);
  let annual: SpecialDayOverride | null = null;
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (rule.kind === 'date' && rule.exact_date === dateJst) {
      const override = toOverride(rule);
      if (override) return override;
    } else if (rule.kind === 'annual' && rule.month_day === monthDay && annual === null) {
      annual = toOverride(rule);
    }
  }
  return annual;
}
