import assert from 'node:assert/strict';
import test from 'node:test';
import {
  escapeVcRecapCsvCell,
  parseVcRecapExportFilters,
  serializeVcRecapCsv,
  toVcRecapExportObject,
  type VcRecapExportRecord,
} from './vc-recap-export.ts';

const sid = '11111111-1111-4111-8111-111111111111';
const speaker = '123456789012345678';

function record(text: string): VcRecapExportRecord {
  return {
    sessionId: sid,
    guildId: '123456789012345678',
    channelId: '223456789012345678',
    sessionStartedAt: new Date('2026-10-30T12:00:00Z'),
    sessionEndedAt: new Date('2026-10-30T12:20:00Z'),
    userId: speaker,
    segmentId: '33333333-3333-4333-8333-333333333333',
    startedAt: new Date('2026-10-30T12:01:00Z'),
    endedAt: new Date('2026-10-30T12:01:05Z'),
    text,
    summary: 'VCの要約',
    topics: ['話題1', '話題2'],
  };
}

test('セッションまたはJST期間が必須・formatはJSON/CSVのみ', () => {
  assert.equal(parseVcRecapExportFilters(new URLSearchParams()), null);
  assert.equal(parseVcRecapExportFilters(new URLSearchParams('format=x&sessionIds=' + sid)), null);
  assert.equal(parseVcRecapExportFilters(new URLSearchParams('from=2026-10-29')), null);
  assert.equal(
    parseVcRecapExportFilters(new URLSearchParams('from=2026-02-30&to=2026-03-01')),
    null,
  );
  assert.equal(
    parseVcRecapExportFilters(new URLSearchParams('from=2026-10-31&to=2026-10-30')),
    null,
  );
  assert.equal(
    parseVcRecapExportFilters(new URLSearchParams('sessionIds=' + sid + '&speakerId=' + speaker))
      ?.speakerId,
    speaker,
  );
  assert.equal(
    parseVcRecapExportFilters(new URLSearchParams('format=csv&from=2026-10-01&to=2026-10-30'))
      ?.format,
    'csv',
  );
});

test('CSV式の先頭記号と改行を無害化し、引用符を二重化する', () => {
  for (const value of ['=1+1', '+SUM(A1)', '-2+3', '@cmd', '  =1+1', '\t=1+1']) {
    assert.ok(escapeVcRecapCsvCell(value).includes("'"), value);
  }
  assert.equal(escapeVcRecapCsvCell('x"y'), '"x""y"');
  assert.equal(escapeVcRecapCsvCell('first\nsecond'), '"first second"');
});

test('CSVはBOM付きで列数と発言の安全なテキストを保持する', () => {
  const csv = serializeVcRecapCsv([record('=HYPERLINK("x")')], new Date('2026-10-30T12:30:00Z'));
  assert.ok(csv.startsWith('\uFEFFsessionId,'));
  assert.equal(csv.split('\r\n').length, 3);
  assert.ok(csv.includes('"\'=HYPERLINK(""x"")"'));
});

test('JSONは時刻・セグメントID・話題・要約を保持する', () => {
  const output = toVcRecapExportObject([record('安全な本文')], new Date('2026-10-30T13:00:00Z'));
  assert.equal(output.count, 1);
  assert.equal(output.records[0]?.segmentId, '33333333-3333-4333-8333-333333333333');
  assert.deepEqual(output.records[0]?.topics, ['話題1', '話題2']);
  assert.equal(output.records[0]?.sessionStartedAt, '2026-10-30T12:00:00.000Z');
});
