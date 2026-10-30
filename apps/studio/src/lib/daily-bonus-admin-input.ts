export function validDailyBonusDate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d\d-\d\d$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  );
}
export function currentDailyBonusDate(now = new Date()): string {
  return new Date(now.getTime() + 32400000).toISOString().slice(0, 10);
}
export function canOperateDailyAnnouncement(date: string, now = new Date()): boolean {
  return validDailyBonusDate(date) && date === currentDailyBonusDate(now);
}
export function newDailyAnniversaryIdentity() {
  return { id: `anniversary_${globalThis.crypto.randomUUID()}`, sourceCheckedAt: '' };
}
