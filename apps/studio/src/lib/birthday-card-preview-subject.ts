export interface BirthdayCardPreviewMember {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  birthday: {
    month: number;
    day: number;
    age: number | null;
  } | null;
}

export interface BirthdayCardPreviewSubject {
  displayName: string;
  avatarUrl: string | null;
  birthdayText: string;
  ageText: string;
  initials: string;
}

export function birthdayCardPreviewSubject(
  member?: BirthdayCardPreviewMember | null,
): BirthdayCardPreviewSubject {
  const displayName = member?.displayName ?? 'Herta Member';
  return {
    displayName,
    avatarUrl: member?.avatarUrl ?? null,
    birthdayText: member
      ? member.birthday
        ? `${member.birthday.month}月${member.birthday.day}日`
        : '誕生日未登録'
      : '8月19日',
    ageText: member
      ? member.birthday?.age === null || member.birthday?.age === undefined
        ? '年齢未登録'
        : `${member.birthday.age}歳`
      : '25歳',
    initials: birthdayCardPreviewInitials(displayName),
  };
}

export function birthdayCardPreviewInitials(value: string): string {
  const normalized = value.trim();
  if (!normalized) return 'HM';
  const words = normalized.split(/\s+/u).filter(Boolean);
  if (words.length >= 2) {
    const first = Array.from(words[0] ?? '')[0] ?? '';
    const second = Array.from(words[1] ?? '')[0] ?? '';
    return `${first}${second}`.toLocaleUpperCase('ja');
  }
  return Array.from(normalized).slice(0, 2).join('').toLocaleUpperCase('ja');
}
