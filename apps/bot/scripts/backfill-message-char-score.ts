/**
 * 文字ポイント(message_char_units)の一回限りのバックフィルスクリプト。
 *
 * activity-log Pluginの仕様上、本文が保存されるのはmessage_update(編集前)・
 * message_delete(削除時)のスナップショットだけで、通常のmessage_createでは
 * 本文を保存していない。そのため「過去に遡って全送信文字数を正確に復元する」
 * ことはできず、このスクリプトは「現時点でDBに残っている編集/削除スナップショット」
 * だけを対象に文字ポイントを計算し、community_activity_daily(metric: message_char_units)
 * へ加算する。偏ったデータであることを理解した上で、ユーザーの要望により実行する。
 *
 * 実行方法 (apps/bot ディレクトリで):
 *   pnpm exec tsx scripts/backfill-message-char-score.ts
 *
 * 冪等性に関する注意: このスクリプトは「加算」のため、同じ行に対して複数回実行すると
 * 二重にカウントされる。本番では一度だけ実行すること。
 */
import { getPrismaClient } from '@herta/db';
import { incrementCommunityActivity } from '../src/activity/community-activity.js';
import { computeCharScoreUnits } from '../src/activity/char-score.js';

async function main(): Promise<void> {
  const prisma = getPrismaClient();

  const rows = await prisma.memberActivityEvent.findMany({
    where: {
      event: { in: ['message_update', 'message_delete'] },
      content: { not: null },
      userId: { not: null },
    },
    select: { guildId: true, userId: true, content: true, occurredAt: true },
  });

  console.log(`対象レコード: ${rows.length}件`);

  let applied = 0;
  let totalUnits = 0;
  for (const row of rows) {
    if (!row.userId || !row.content) continue;
    const units = computeCharScoreUnits(row.content);
    if (units <= 0) continue;
    await incrementCommunityActivity(
      prisma,
      row.guildId,
      row.userId,
      'message_char_units',
      units,
      row.occurredAt,
    );
    applied += 1;
    totalUnits += units;
  }

  console.log(`反映件数: ${applied}件 / 合計${totalUnits}unit（${totalUnits / 2}pt相当）`);
  await prisma.$disconnect();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
