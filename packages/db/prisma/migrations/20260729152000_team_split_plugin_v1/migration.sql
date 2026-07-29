-- Team Split Plugin v1
-- 既存team_split_sessionsを保持したまま、競合防止・期限・Discord表示同期を追加する。

ALTER TABLE "team_split_sessions"
  ALTER COLUMN "created_at" TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
  ADD COLUMN IF NOT EXISTS "message_id" TEXT,
  ADD COLUMN IF NOT EXISTS "title" TEXT NOT NULL DEFAULT 'Team Split',
  ADD COLUMN IF NOT EXISTS "max_participants" INTEGER NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS "participant_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "seed_hash" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "generation" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "expires_at" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "split_at" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "closed_at" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "message_state" TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS "last_error_name" TEXT,
  ADD COLUMN IF NOT EXISTS "created_by" TEXT,
  ADD COLUMN IF NOT EXISTS "updated_by" TEXT,
  ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "team_split_sessions"
SET
  "status" = CASE WHEN "status" IN ('open', 'split', 'closed', 'expired') THEN "status" ELSE 'open' END,
  "mode" = CASE WHEN "mode" IN ('random', 'balanced') THEN "mode" ELSE 'random' END,
  "expires_at" = COALESCE("expires_at", "created_at" + INTERVAL '1 hour'),
  "seed_hash" = CASE WHEN "seed_hash" = '' THEN md5("guild_id" || ':' || "id") ELSE "seed_hash" END,
  "participant_count" = GREATEST(COALESCE(cardinality("participants"), 0), 1),
  "max_participants" = GREATEST("max_participants", "team_count", GREATEST(COALESCE(cardinality("participants"), 0), 1)),
  "created_by" = COALESCE("created_by", "creator_id"),
  "updated_by" = COALESCE("updated_by", "creator_id");

ALTER TABLE "team_split_sessions"
  ALTER COLUMN "expires_at" SET NOT NULL;

CREATE TABLE IF NOT EXISTS "team_split_participants" (
  "session_id" TEXT NOT NULL,
  "guild_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "score" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'joined',
  "joined_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "left_at" TIMESTAMPTZ(3),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "team_split_participants_pkey" PRIMARY KEY ("session_id", "user_id"),
  CONSTRAINT "team_split_participants_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "team_split_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "team_split_participants" (
  "session_id", "guild_id", "user_id", "score", "status", "joined_at", "updated_at"
)
SELECT
  session."id",
  session."guild_id",
  participant."user_id",
  0,
  'joined',
  session."created_at",
  CURRENT_TIMESTAMP
FROM "team_split_sessions" AS session
CROSS JOIN LATERAL (
  SELECT DISTINCT value AS "user_id"
  FROM unnest(array_append(session."participants", session."creator_id")) AS value
  WHERE value IS NOT NULL AND value <> ''
) AS participant
ON CONFLICT ("session_id", "user_id") DO NOTHING;

UPDATE "team_split_sessions" AS session
SET
  "participant_count" = counts.joined_count,
  "participants" = counts.user_ids
FROM (
  SELECT
    "session_id",
    COUNT(*)::INTEGER AS joined_count,
    array_agg("user_id" ORDER BY "joined_at", "user_id") AS user_ids
  FROM "team_split_participants"
  WHERE "status" = 'joined'
  GROUP BY "session_id"
) AS counts
WHERE session."id" = counts."session_id";

CREATE INDEX IF NOT EXISTS "team_split_sessions_guild_status_idx"
  ON "team_split_sessions" ("guild_id", "status");
CREATE INDEX IF NOT EXISTS "team_split_sessions_guild_channel_status_idx"
  ON "team_split_sessions" ("guild_id", "channel_id", "status");
CREATE INDEX IF NOT EXISTS "team_split_sessions_guild_creator_created_idx"
  ON "team_split_sessions" ("guild_id", "creator_id", "created_at" DESC);
CREATE UNIQUE INDEX IF NOT EXISTS "team_split_sessions_guild_message_active_key"
  ON "team_split_sessions" ("guild_id", "message_id")
  WHERE "message_id" IS NOT NULL AND "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "team_split_participants_guild_status_idx"
  ON "team_split_participants" ("guild_id", "status");

ALTER TABLE "team_split_sessions"
  ADD CONSTRAINT "team_split_sessions_status_check"
    CHECK ("status" IN ('open', 'split', 'closed', 'expired')) NOT VALID,
  ADD CONSTRAINT "team_split_sessions_mode_check"
    CHECK ("mode" IN ('random', 'balanced')) NOT VALID,
  ADD CONSTRAINT "team_split_sessions_message_state_check"
    CHECK ("message_state" IN ('pending', 'active', 'missing', 'failed')) NOT VALID,
  ADD CONSTRAINT "team_split_sessions_counts_check"
    CHECK (
      "team_count" >= 2
      AND "max_participants" >= "team_count"
      AND "participant_count" >= 0
      AND "participant_count" <= "max_participants"
    ) NOT VALID,
  ADD CONSTRAINT "team_split_sessions_expiry_check"
    CHECK ("expires_at" >= "created_at") NOT VALID;

ALTER TABLE "team_split_participants"
  ADD CONSTRAINT "team_split_participants_status_check"
    CHECK ("status" IN ('joined', 'left')) NOT VALID,
  ADD CONSTRAINT "team_split_participants_score_check"
    CHECK ("score" BETWEEN -100000 AND 100000) NOT VALID;
