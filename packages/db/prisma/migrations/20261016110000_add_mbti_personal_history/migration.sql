CREATE TABLE "mbti_personal_results" (
  "id" TEXT NOT NULL,
  "completion_key" TEXT NOT NULL,
  "guild_id" TEXT NOT NULL,
  "discord_user_id" TEXT NOT NULL,
  "result_type" TEXT NOT NULL,
  "result_identity" TEXT NOT NULL,
  "scores" JSONB NOT NULL,
  "percentages" JSONB NOT NULL,
  "question_count" INTEGER NOT NULL,
  "scoring_version" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "completed_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "mbti_personal_results_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "mbti_personal_results_completion_key_key" ON "mbti_personal_results"("completion_key");
CREATE INDEX "mbti_personal_results_guild_id_discord_user_id_completed_at_idx"
  ON "mbti_personal_results"("guild_id", "discord_user_id", "completed_at" DESC, "id" DESC);
CREATE TABLE "mbti_result_access" (
  "guild_id" TEXT NOT NULL,
  "discord_user_id" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "mbti_result_access_pkey" PRIMARY KEY ("guild_id", "discord_user_id")
);
CREATE UNIQUE INDEX "mbti_result_access_token_hash_key" ON "mbti_result_access"("token_hash");

-- 回答と本人の紐付けが残っている62問版の完了Web診断のみを復元。
-- 匿名イベントから本人を推測せず、統計の再計上もしない。
INSERT INTO "mbti_personal_results" (
  "id", "completion_key", "guild_id", "discord_user_id", "result_type", "result_identity",
  "scores", "percentages", "question_count", "scoring_version", "source", "completed_at"
)
SELECT s."id", 'web:' || s."id", s."guild_id", s."discord_user_id", s."result_type", s."result_identity",
  s."scores", jsonb_object_agg(a.axis, ROUND(LEAST(100, GREATEST(0,
    50 + ((s."scores" ->> a.axis)::numeric / NULLIF((SELECT COUNT(*) * 2 FROM jsonb_array_elements(s."question_order") q WHERE q->>'axis' = a.axis), 0)) * 50)))),
  62, 'likert-62-v1', 'web', s."completed_at"
FROM "mbti_web_quiz_sessions" s
CROSS JOIN (VALUES ('EI'), ('SN'), ('TF'), ('JP'), ('AT')) a(axis)
WHERE s."status" = 'completed' AND s."completed_at" IS NOT NULL
  AND s."result_type" ~ '^[IE][NS][FT][JP]$' AND s."result_identity" IN ('A','T')
  AND jsonb_typeof(s."question_order") = 'array' AND jsonb_array_length(CASE WHEN jsonb_typeof(s."question_order") = 'array' THEN s."question_order" ELSE '[]'::jsonb END) = 62
  AND (SELECT COUNT(*) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s."question_order") = 'array' THEN s."question_order" ELSE '[]'::jsonb END) q WHERE q->>'axis' IN ('EI','SN')) = 26
  AND NOT EXISTS (SELECT 1 FROM (VALUES ('EI',13),('SN',13),('TF',12),('JP',12),('AT',12)) expected(axis,n) WHERE (SELECT COUNT(*) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s."question_order") = 'array' THEN s."question_order" ELSE '[]'::jsonb END) q WHERE q->>'axis' = expected.axis) <> expected.n)
  AND jsonb_typeof(s."scores") = 'object'
  AND s."scores" ?& ARRAY['EI','SN','TF','JP','AT']
  AND NOT EXISTS (SELECT 1 FROM jsonb_each_text(CASE WHEN jsonb_typeof(s."scores") = 'object' THEN s."scores" ELSE '{}'::jsonb END) v WHERE v.key IN ('EI','SN','TF','JP','AT') AND (v.value IS NULL OR v.value !~ '^-?[0-9]{1,3}$'))
GROUP BY s."id";
