import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACHIEVEMENT_TEMPLATE_PACKS,
  materializeAchievementTemplatePack,
  templatePackStats,
} from './achievement-templates.ts';

test('Built-in Template PackはSchema上限内のSeriesとStageを持つ', () => {
  assert.ok(ACHIEVEMENT_TEMPLATE_PACKS.length >= 6);
  for (const pack of ACHIEVEMENT_TEMPLATE_PACKS) {
    assert.ok(pack.series.length >= 1 && pack.series.length <= 25);
    for (const series of pack.series) {
      assert.ok(series.stages.length >= 1 && series.stages.length <= 10);
      for (const stage of series.stages) {
        assert.ok(stage.conditions.length >= 1 && stage.conditions.length <= 8);
        assert.ok(stage.points >= 0 && stage.points <= 100000);
      }
    }
  }
});

test('同じTemplateを再導入するとSeries IDを衝突しない形へ変更する', () => {
  const pack = ACHIEVEMENT_TEMPLATE_PACKS[0];
  assert.ok(pack);
  const first = materializeAchievementTemplatePack(pack, []);
  const second = materializeAchievementTemplatePack(pack, first);

  assert.equal(first[0]?.key, pack.series[0]?.key);
  assert.equal(second[0]?.key, `${pack.series[0]?.key}-2`);
  assert.notEqual(first[0]?.key, second[0]?.key);
});

test('Template統計はSeries・Stage・Point・Metricを集計する', () => {
  const pack = ACHIEVEMENT_TEMPLATE_PACKS.find((item) => item.id === 'event-hunter');
  assert.ok(pack);
  const stats = templatePackStats(pack);

  assert.equal(stats.seriesCount, 2);
  assert.ok(stats.stageCount >= 6);
  assert.ok(stats.pointTotal > 0);
  assert.ok(stats.metrics.includes('eventGoing'));
  assert.ok(stats.metrics.includes('pollVotes'));
  assert.ok(stats.metrics.includes('giveawayEntries'));
});
