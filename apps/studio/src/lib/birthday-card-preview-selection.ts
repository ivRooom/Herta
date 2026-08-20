export interface BirthdayCardPreviewSelection {
  guildId: string;
  userId: string;
}

let selection: BirthdayCardPreviewSelection | null = null;

export function setBirthdayCardPreviewSelection(
  next: BirthdayCardPreviewSelection | null,
): void {
  selection = next;
}

export function getBirthdayCardPreviewSelection(): BirthdayCardPreviewSelection | null {
  return selection;
}
