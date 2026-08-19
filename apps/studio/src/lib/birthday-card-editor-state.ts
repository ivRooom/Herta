import {
  BIRTHDAY_CARD_CONFIG_FIELD_KEYS,
  type BirthdayCardConfig,
  type BirthdayCardConfigFieldKey,
} from '@herta/shared';

export function birthdayCardDirtyFieldKeys(
  current: BirthdayCardConfig,
  saved: BirthdayCardConfig,
  editable: ReadonlySet<string>,
): BirthdayCardConfigFieldKey[] {
  return BIRTHDAY_CARD_CONFIG_FIELD_KEYS.filter(
    (key) => editable.has(key) && !Object.is(current[key], saved[key]),
  );
}

export function restoreBirthdayCardEditableConfig(
  current: BirthdayCardConfig,
  saved: BirthdayCardConfig,
  editable: ReadonlySet<string>,
): BirthdayCardConfig {
  const next = { ...current };

  for (const key of BIRTHDAY_CARD_CONFIG_FIELD_KEYS) {
    if (!editable.has(key) || Object.is(next[key], saved[key])) continue;
    Object.assign(next, { [key]: saved[key] });
  }

  return next;
}
