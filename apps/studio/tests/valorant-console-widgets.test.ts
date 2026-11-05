import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ValorantHistoryPreview } from '../src/components/valorant-console-widgets';

describe('VALORANT dashboard preview privacy and legacy data', () => {
  const draws = [
    {
      id: 'older',
      mode: 'RANDOM',
      mapId: 'Ascent',
      completedAt: new Date('2025-12-31T23:45:00.000Z'),
      candidates: [],
      result: [{ agentId: 'guild-agent', agentName: 'ギルド固有Agent' }],
    },
    {
      id: 'newer',
      mode: 'TACTICAL',
      mapId: 'Haven',
      completedAt: new Date('2026-12-31T23:45:00.000Z'),
      candidates: [],
      result: [{ agentId: 'unknown-agent' }],
    },
  ];

  it('shows the UTC year and a persisted Guild custom name without leaking user identifiers', () => {
    const markup = renderToStaticMarkup(
      createElement(ValorantHistoryPreview, {
        rows: draws,
        labels: new Map<string, string>(),
      }),
    );
    expect(markup).toContain('2025-12-31 23:45');
    expect(markup).toContain('2026-12-31 23:45');
    expect(markup).toContain('ギルド固有Agent');
    expect(markup).toContain('unknown-agent');
    expect(markup).not.toContain('userId');
  });

  it('prefers canonical display names over snapshots for official Agents', () => {
    const markup = renderToStaticMarkup(
      createElement(ValorantHistoryPreview, {
        rows: [
          {
            ...draws[0],
            result: [{ agentId: 'jett', agentName: 'old-snapshot' }],
          },
        ],
        labels: new Map([['jett', 'ジェット']]),
      }),
    );
    expect(markup).toContain('ジェット');
    expect(markup).not.toContain('old-snapshot');
  });
});
