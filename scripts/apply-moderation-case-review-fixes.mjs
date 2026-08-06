import { readFileSync, rmSync, writeFileSync } from 'node:fs';

patchService();
patchDetectionCase();
patchDetectionHistory();
patchDetectionPage();
patchCasePage();
patchDetectionCaseTest();

rmSync('scripts/apply-moderation-case-review-fixes.mjs');
rmSync('.github/workflows/apply-moderation-case-review-fixes.yml');

function patchService() {
  const path = 'plugins/moderation/src/service.ts';
  let source = readFileSync(path, 'utf8');
  source = replaceOnce(
    source,
    `    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', input.guildId);\n    const rows = await tx.$queryRawUnsafe<ModerationCaseRow[]>(`,
    `    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', input.guildId);\n    if (originDetectionId) {\n      const originRows = await tx.$queryRawUnsafe<Array<{ id: string }>>(\n        \`SELECT id\n         FROM moderation_detection_events\n         WHERE guild_id = $1\n           AND id = $2::uuid\n         LIMIT 1\`,\n        input.guildId,\n        originDetectionId,\n      );\n      if (!originRows[0]) {\n        throw new ModerationValidationError('元検知がGuild内に見つかりません');\n      }\n    }\n    const rows = await tx.$queryRawUnsafe<ModerationCaseRow[]>(`,
  );
  writeFileSync(path, source);
}

function patchDetectionCase() {
  const path = 'plugins/moderation/src/detection-case.ts';
  let source = readFileSync(path, 'utf8');
  source = replaceOnce(
    source,
    `): Promise<ModerationDetectionCaseResult | null> {\n  const sourceRows = await tx.$queryRawUnsafe<DetectionCaseSourceRow[]>(`,
    `): Promise<ModerationDetectionCaseResult | null> {\n  await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', input.guildId);\n  const sourceRows = await tx.$queryRawUnsafe<DetectionCaseSourceRow[]>(`,
  );
  source = replaceOnce(
    source,
    `\n  await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', input.guildId);\n  const reason = buildCaseReason(source.detection_kind);`,
    `\n  const reason = buildCaseReason(source.detection_kind);`,
  );
  writeFileSync(path, source);
}

function patchDetectionHistory() {
  const path = 'plugins/moderation/src/detection-history.ts';
  let source = readFileSync(path, 'utf8');
  source = replaceOnce(
    source,
    `export interface ListModerationDetectionsInput {\n  guildId: string;\n  page?: number;`,
    `export interface ListModerationDetectionsInput {\n  guildId: string;\n  detectionId?: string;\n  page?: number;`,
  );
  source = replaceOnce(
    source,
    `  const addFilter = (sql: string, value: unknown) => {\n    values.push(value);\n    filters.push(sql.replace('?', \`$\${values.length}\`));\n  };\n\n  if (input.detectionKind) {`,
    `  const addFilter = (sql: string, value: unknown) => {\n    values.push(value);\n    filters.push(sql.replace('?', \`$\${values.length}\`));\n  };\n\n  if (input.detectionId) {\n    assertUuid(input.detectionId, '検知ID');\n    addFilter('id = ?::uuid', input.detectionId);\n  }\n  if (input.detectionKind) {`,
  );
  writeFileSync(path, source);
}

function patchDetectionPage() {
  const path = 'apps/studio/src/app/dashboard/guilds/[guildId]/moderation/detections/page.tsx';
  let source = readFileSync(path, 'utf8');
  source = replaceOnce(
    source,
    `    page: parsePositiveInteger(first(query.page)) ?? 1,\n    pageSize: 20,\n    detectionKind:`,
    `    page: parsePositiveInteger(first(query.page)) ?? 1,\n    pageSize: 20,\n    detectionId: parseUuid(first(query.detectionId)),\n    detectionKind:`,
  );
  source = replaceOnce(
    source,
    `        guildId,\n        detectionKind: filters.detectionKind,`,
    `        guildId,\n        detectionId: filters.detectionId,\n        detectionKind: filters.detectionKind,`,
  );
  source = replaceOnce(
    source,
    `<tr key={item.id} className="align-top hover:bg-background/60">`,
    `<tr\n                      id={\`detection-$\{item.id}\`}\n                      key={item.id}\n                      className="align-top hover:bg-background/60"\n                    >`,
  );
  source = replaceOnce(
    source,
    `<article className="min-w-0 rounded-2xl border border-border bg-surface p-4 shadow-card">`,
    `<article\n      id={\`detection-$\{item.id}\`}\n      className="min-w-0 scroll-mt-20 rounded-2xl border border-border bg-surface p-4 shadow-card"\n    >`,
  );
  source = replaceOnce(
    source,
    `function parseDiscordId(value: string | undefined) {`,
    `function parseUuid(value: string | undefined) {\n  const normalized = value?.trim();\n  return normalized &&\n    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(\n      normalized,\n    )\n    ? normalized\n    : undefined;\n}\n\nfunction parseDiscordId(value: string | undefined) {`,
  );
  source = replaceOnce(
    source,
    `for (const key of ['kind', 'status', 'userId', 'channelId', 'from', 'to']) {`,
    `for (const key of [\n    'detectionId',\n    'kind',\n    'status',\n    'userId',\n    'channelId',\n    'from',\n    'to',\n  ]) {`,
  );
  writeFileSync(path, source);
}

function patchCasePage() {
  const path = 'apps/studio/src/app/dashboard/guilds/[guildId]/moderation/[caseNumber]/page.tsx';
  let source = readFileSync(path, 'utf8');
  source = replaceOnce(
    source,
    `href={\`/dashboard/guilds/$\{guildId\}/moderation/detections\`}`,
    `href={\`/dashboard/guilds/$\{guildId\}/moderation/detections?detectionId=$\{encodeURIComponent(\n                        moderationCase.originDetectionId,\n                      )\}#detection-$\{encodeURIComponent(moderationCase.originDetectionId)\}\`}`,
  );
  writeFileSync(path, source);
}

function patchDetectionCaseTest() {
  const path = 'plugins/moderation/src/detection-case.test.ts';
  let source = readFileSync(path, 'utf8');
  source = replaceOnce(
    source,
    `.mockResolvedValueOnce([baseSource])\n      .mockResolvedValueOnce([])\n      .mockResolvedValueOnce([{ id: 'case-id', case_number: 7 }]);`,
    `.mockResolvedValueOnce([])\n      .mockResolvedValueOnce([baseSource])\n      .mockResolvedValueOnce([{ id: 'case-id', case_number: 7 }]);`,
  );
  source = replaceOnce(
    source,
    `.mockResolvedValueOnce([{ ...baseSource, case_id: 'existing-case', case_number: 4 }]);`,
    `.mockResolvedValueOnce([])\n      .mockResolvedValueOnce([{ ...baseSource, case_id: 'existing-case', case_number: 4 }]);`,
  );
  source = replaceOnce(source, `expect(query).toHaveBeenCalledTimes(1);`, `expect(query).toHaveBeenCalledTimes(2);`);
  source = replaceOnce(
    source,
    `.mockResolvedValueOnce([baseSource])\n      .mockResolvedValueOnce([])\n      .mockResolvedValueOnce([])\n      .mockResolvedValueOnce([{ id: 'concurrent-case', case_number: 8 }]);`,
    `.mockResolvedValueOnce([])\n      .mockResolvedValueOnce([baseSource])\n      .mockResolvedValueOnce([])\n      .mockResolvedValueOnce([{ id: 'concurrent-case', case_number: 8 }]);`,
  );
  source = replaceOnce(
    source,
    `.mockResolvedValueOnce([{ ...baseSource, review_status: 'false_positive' }]);`,
    `.mockResolvedValueOnce([])\n      .mockResolvedValueOnce([{ ...baseSource, review_status: 'false_positive' }]);`,
  );
  source = replaceOnce(
    source,
    `expect(query).toHaveBeenCalledTimes(1);\n  });\n\n  it('Guild条件付きで作成元とケースリンクを検索する'`,
    `expect(query).toHaveBeenCalledTimes(2);\n  });\n\n  it('Guild条件付きで作成元とケースリンクを検索する'`,
  );
  writeFileSync(path, source);
}

function replaceOnce(source, before, after) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`置換対象が見つかりません: ${before.slice(0, 100)}`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`置換対象が複数あります: ${before.slice(0, 100)}`);
  }
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}
