import { describe, it, expect } from 'vitest';
import type { AnniversaryEvent } from '@herta/db';
import { selectAnniversaries } from './daily-bonus-content.js';
const event: AnniversaryEvent = {
  id: 'a',
  title: '作品発売日',
  summary: '発売記念',
  category: 'game',
  month: 10,
  day: 29,
  base_year: 2016,
  work_name: '作品',
  character_name: '',
  source_url: 'https://example.test/official',
  source_checked_at: new Date('2026-10-28T00:00:00Z'),
  approved: true,
  public: true,
  priority: 10,
  pinned_date: null,
  anniversary_mode: 'elapsed',
};
describe('anniversary selection', () => {
  it('includes only approved public verified candidates and computes elapsed anniversary', () => {
    const selected = selectAnniversaries(
      [
        event,
        { ...event, id: 'draft', approved: false },
        { ...event, id: 'hidden', public: false },
        { ...event, id: 'bad', source_url: 'javascript:evil' },
      ],
      '2026-10-29',
      ['game'],
      3,
    );
    expect(selected).toHaveLength(1);
    expect(selected[0]!.anniversary).toBe(10);
  });
  it('deduplicates topics, caps three, and does not invent content', () => {
    expect(
      selectAnniversaries([event, { ...event, id: 'copy' }], '2026-10-29', ['game'], 3),
    ).toHaveLength(1);
    expect(selectAnniversaries([], '2026-10-29', ['game'], 3)).toEqual([]);
    expect(selectAnniversaries([event], '2026-10-30', ['game'], 3)).toEqual([]);
  });
});
