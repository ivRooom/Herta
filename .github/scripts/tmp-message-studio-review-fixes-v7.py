from pathlib import Path

runner = Path('.tmp-message-studio-runner/.github/scripts/tmp-message-studio-review-fixes-v6.py')
exec(compile(runner.read_text(), str(runner), 'exec'), {'__name__': '__main__'})

Path('apps/studio/src/lib/message-studio-request.test.ts').write_text(r'''import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeMessageStudioRequestBody } from './message-studio-request.ts';

test('datetime-localは設定Timezoneの壁時計時刻としてUTCへ変換する', () => {
  const body = normalizeMessageStudioRequestBody(
    { onceAt: '2026-08-20T20:00', timezone: 'Asia/Tokyo' },
    'UTC',
  );
  assert.deepEqual(body.onceAt, new Date('2026-08-20T11:00:00.000Z'));
});

test('GETで返るZ付きISO timestampをGET→PATCHでそのまま保持する', () => {
  const iso = '2026-08-20T11:00:00.000Z';
  const body = normalizeMessageStudioRequestBody(
    { onceAt: iso, timezone: 'Asia/Tokyo' },
    'UTC',
  );
  assert.equal(body.onceAt, iso);
});

test('明示offset付きISO timestampもローカル時刻へ再解釈しない', () => {
  const iso = '2026-08-20T20:00:00+09:00';
  const body = normalizeMessageStudioRequestBody({ onceAt: iso, timezone: 'UTC' }, 'UTC');
  assert.equal(body.onceAt, iso);
});
''')
