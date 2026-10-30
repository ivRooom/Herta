import type { AnniversaryEvent } from '@herta/db';
export function selectAnniversaries(
  events: readonly AnniversaryEvent[],
  date: string,
  categories: readonly string[],
  limit: number,
) {
  const [year, month, day] = date.split('-').map(Number);
  const seen = new Set<string>();
  return events
    .filter(
      (e) =>
        e.approved &&
        e.public &&
        categories.includes(e.category) &&
        (e.pinned_date ? e.pinned_date === date : e.month === month && e.day === day) &&
        (e.base_year === null || e.base_year <= year!) &&
        /^https:\/\//.test(e.source_url) &&
        Number.isFinite(new Date(e.source_checked_at).getTime()),
    )
    .sort(
      (a, b) =>
        Number(b.pinned_date === date) - Number(a.pinned_date === date) ||
        Number(['general', 'community'].includes(a.category)) -
          Number(['general', 'community'].includes(b.category)) ||
        b.priority - a.priority ||
        a.id.localeCompare(b.id),
    )
    .filter((e) => {
      const key = `${e.title.trim()}:${e.work_name.trim()}:${e.character_name.trim()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, Math.max(0, Math.min(3, limit)))
    .map((e) => ({
      title: e.title,
      summary: e.summary,
      sourceUrl: e.source_url,
      anniversary:
        e.anniversary_mode === 'elapsed' && e.base_year !== null ? year! - e.base_year : null,
    }));
}
