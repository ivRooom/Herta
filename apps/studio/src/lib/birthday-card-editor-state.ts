import {
  BIRTHDAY_CARD_CONFIG_FIELD_KEYS,
  type BirthdayCardConfig,
  type BirthdayCardConfigFieldKey,
} from '@herta/shared';

/** 編集権限があるBirthday Card項目のうち、保存済み値と異なるfieldだけを返す。 */
export function birthdayCardDirtyFieldKeys(
  current: BirthdayCardConfig,
  saved: BirthdayCardConfig,
  editable: ReadonlySet<string>,
): BirthdayCardConfigFieldKey[] {
  return BIRTHDAY_CARD_CONFIG_FIELD_KEYS.filter(
    (key) => editable.has(key) && !Object.is(current[key], saved[key]),
  );
}

/** 現在のdraftを維持しつつ、編集権限があるfieldだけを保存済み値へ復元する。 */
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
