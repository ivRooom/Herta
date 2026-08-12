import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeMessageStudioRequestBody } from './message-studio-request.ts';

test('offset付きISO onceAtを同じ絶対時刻として保持する', () => {
  const result = normalizeMessageStudioRequestBody(
    { onceAt: '2026-08-20T11:00:00.000Z' },
    'Asia/Tokyo',
  );

  assert.ok(result.onceAt instanceof Date);
  assert.equal(result.onceAt.toISOString(), '2026-08-20T11:00:00.000Z');
});

test('datetime-local onceAtは指定Timezoneの壁時計時刻として解釈する', () => {
  const result = normalizeMessageStudioRequestBody(
    { onceAt: '2026-08-20T20:00', timezone: 'Asia/Tokyo' },
    'UTC',
  );

  assert.ok(result.onceAt instanceof Date);
  assert.equal(result.onceAt.toISOString(), '2026-08-20T11:00:00.000Z');
});
