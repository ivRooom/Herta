-- LFG v1: existing skeleton tables are expanded without dropping historical data.

ALTER TABLE "lfg_posts"
  ADD COLUMN "participant_count" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "expires_at" TIMESTAMPTZ(3),
  ADD COLUMN "message_state" TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN "last_error_name" TEXT,
  ADD COLUMN "closed_at" TIMESTAMPTZ(3),
  ADD COLUMN "created_by" TEXT,
  ADD COLUMN "updated_by" TEXT,
  ADD COLUMN "deleted_at" TIMESTAMPTZ(3),
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "lfg_posts"
SET
  "description" = COALESCE("description", ''),
  "expires_at" = COALESCE("start_time", "created_at") + INTERVAL '3 hours',
  "created_by" = COALESCE("created_by", "creator_id"),
  "updated_by" = COALESCE("updated_by", "creator_id");

ALTER TABLE "lfg_posts"
  ALTER COLUMN "description" SET DEFAULT '',
  ALTER COLUMN "description" SET NOT NULL,
  ALTER COLUMN "expires_at" SET NOT NULL,
  ALTER COLUMN "start_time" TYPE TIMESTAMPTZ(3) USING "start_time" AT TIME ZONE 'UTC',
  ALTER COLUMN "created_at" TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC';

ALTER TABLE "lfg_participants"
  ADD COLUMN "guild_id" TEXT,
  ADD COLUMN "left_at" TIMESTAMPTZ(3),
  ADD COLUMN "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "lfg_participants" AS participant
SET "guild_id" = post."guild_id"
FROM "lfg_posts" AS post
WHERE post."id" = participant."lfg_id";

ALTER TABLE "lfg_participants"
  ALTER COLUMN "guild_id" SET NOT NULL,
  ALTER COLUMN "joined_at" TYPE TIMESTAMPTZ(3) USING "joined_at" AT TIME ZONE 'UTC';

INSERT INTO "lfg_participants" (
  "lfg_id",
  "guild_id",
  "user_id",
  "status",
  "joined_at",
  "updated_at"
)
SELECT
  post."id",
  post."guild_id",
  post."creator_id",
  'joined',
  post."created_at",
  CURRENT_TIMESTAMP
FROM "lfg_posts" AS post
ON CONFLICT ("lfg_id", "user_id") DO UPDATE
SET
  "guild_id" = EXCLUDED."guild_id",
  "status" = 'joined',
  "left_at" = NULL,
  "updated_at" = CURRENT_TIMESTAMP;

UPDATE "lfg_posts" AS post
SET "participant_count" = GREATEST(
  1,
  (
    SELECT COUNT(*)::INTEGER
    FROM "lfg_participants" AS participant
    WHERE participant."lfg_id" = post."id"
      AND participant."status" = 'joined'
  )
);

ALTER TABLE "lfg_posts"
  ADD CONSTRAINT "lfg_posts_status_check"
    CHECK ("status" IN ('open', 'full', 'closed', 'cancelled', 'expired')) NOT VALID,
  ADD CONSTRAINT "lfg_posts_message_state_check"
    CHECK ("message_state" IN ('pending', 'active', 'missing', 'failed')) NOT VALID,
  ADD CONSTRAINT "lfg_posts_player_count_check"
    CHECK (
      "max_players" >= 2
      AND "participant_count" >= 1
      AND "participant_count" <= "max_players"
    ) NOT VALID,
  ADD CONSTRAINT "lfg_posts_expiry_check"
    CHECK ("expires_at" > "created_at") NOT VALID;

ALTER TABLE "lfg_participants"
  ADD CONSTRAINT "lfg_participants_status_check"
    CHECK ("status" IN ('joined', 'left')) NOT VALID;

CREATE INDEX "lfg_posts_guild_channel_status_idx"
  ON "lfg_posts" ("guild_id", "channel_id", "status");

CREATE INDEX "lfg_posts_creator_created_at_idx"
  ON "lfg_posts" ("guild_id", "creator_id", "created_at" DESC);

CREATE INDEX "lfg_participants_guild_status_idx"
  ON "lfg_participants" ("guild_id", "status");

CREATE UNIQUE INDEX "lfg_posts_guild_message_id_key"
  ON "lfg_posts" ("guild_id", "message_id")
  WHERE "message_id" IS NOT NULL;
