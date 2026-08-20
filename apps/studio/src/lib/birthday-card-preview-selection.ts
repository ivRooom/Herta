export interface BirthdayCardPreviewSelection {
  guildId: string;
  userId: string;
}

const BIRTHDAY_GUILD_PATH_PATTERN = /\/dashboard\/guilds\/(\d{17,20})\/birthday(?:\/|$)/u;
let selection: BirthdayCardPreviewSelection | null = null;

export function setBirthdayCardPreviewSelection(
  next: BirthdayCardPreviewSelection | null,
): void {
  selection = next;
}

export function getBirthdayCardPreviewSelection(): BirthdayCardPreviewSelection | null {
  return selection;
}

export function getBirthdayCardPreviewSelectionForPathname(
  pathname: string,
): BirthdayCardPreviewSelection | null {
  if (!selection) return null;
  const guildId = BIRTHDAY_GUILD_PATH_PATTERN.exec(pathname)?.[1];
  return guildId === selection.guildId ? selection : null;
}
