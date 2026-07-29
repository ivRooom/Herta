import { readFile, writeFile } from 'node:fs/promises';

const path = 'apps/worker/src/daily-content.ts';
let content = await readFile(path, 'utf8');

function replaceOne(before, after) {
  if (content.includes(after)) return;
  const count = content.split(before).length - 1;
  if (count !== 1) throw new Error(`expected one source block, received ${count}`);
  content = content.replace(before, after);
}

replaceOne(
  `  getDeliveryWithSchedule,\n`,
  `  getDeliveryWithSchedule,\n  isDailyContentPluginEnabled,\n`,
);
replaceOne(
  `      const dueSchedules = await listDueDailyContents(prisma, now, DAILY_CONTENT_SCAN_LIMIT);\n      for (const schedule of dueSchedules) {\n        await reserveDueDelivery(prisma, schedule.id, now);\n      }`,
  `      const dueSchedules = await listDueDailyContents(prisma, now, DAILY_CONTENT_SCAN_LIMIT);\n      for (const schedule of dueSchedules) {\n        const pluginEnabled = await isDailyContentPluginEnabled(prisma, schedule.guildId);\n        if (!pluginEnabled) {\n          await options.prisma.dailyContent.update({\n            where: { id: schedule.id },\n            data: { nextRunAt: null },\n          });\n          continue;\n        }\n        await reserveDueDelivery(prisma, schedule.id, now);\n      }`,
);
replaceOne(
  `  for (const schedule of schedules) {\n    const nextRunAt = nextDailyOccurrence({`,
  `  for (const schedule of schedules) {\n    const pluginEnabled = await isDailyContentPluginEnabled(\n      prisma as unknown as DailyContentPrismaClient,\n      schedule.guildId,\n    );\n    if (!pluginEnabled) continue;\n    const nextRunAt = nextDailyOccurrence({`,
);
replaceOne(
  `    select: { id: true, scheduleTime: true, timezone: true },`,
  `    select: { id: true, guildId: true, scheduleTime: true, timezone: true },`,
);

await writeFile(path, content);
