-- Community Leaderboard Season Snapshots v1
-- 終了済みSeasonの確定順位を保持し、後続の集計ルール変更から履歴を保護する。

CREATE TABLE "community_season_snapshots" (
    "guild_id" TEXT NOT NULL,
    "season_key" VARCHAR(32) NOT NULL,
    "season_index" INTEGER NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "participant_count" INTEGER NOT NULL DEFAULT 0,
    "source_version" INTEGER NOT NULL DEFAULT 1,
    "finalized_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_season_snapshots_pkey" PRIMARY KEY ("guild_id", "season_key"),
    CONSTRAINT "community_season_snapshots_season_index_check" CHECK ("season_index" > 0),
    CONSTRAINT "community_season_snapshots_participant_count_check" CHECK ("participant_count" >= 0),
    CONSTRAINT "community_season_snapshots_source_version_check" CHECK ("source_version" > 0),
    CONSTRAINT "community_season_snapshots_window_check" CHECK ("ends_at" > "starts_at")
);

CREATE TABLE "community_season_snapshot_entries" (
    "guild_id" TEXT NOT NULL,
    "season_key" VARCHAR(32) NOT NULL,
    "user_id" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "points" INTEGER NOT NULL,
    "award_tier" VARCHAR(16),

    CONSTRAINT "community_season_snapshot_entries_pkey" PRIMARY KEY ("guild_id", "season_key", "user_id"),
    CONSTRAINT "community_season_snapshot_entries_rank_check" CHECK ("rank" > 0),
    CONSTRAINT "community_season_snapshot_entries_points_check" CHECK ("points" >= 0),
    CONSTRAINT "community_season_snapshot_entries_award_tier_check" CHECK (
        ("rank" = 1 AND "award_tier" = 'champion')
        OR ("rank" BETWEEN 2 AND 3 AND "award_tier" = 'top3')
        OR ("rank" BETWEEN 4 AND 10 AND "award_tier" = 'top10')
        OR ("rank" > 10 AND "award_tier" IS NULL)
    ),
    CONSTRAINT "community_season_snapshot_entries_snapshot_fkey"
        FOREIGN KEY ("guild_id", "season_key")
        REFERENCES "community_season_snapshots"("guild_id", "season_key")
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "community_season_snapshot_entries_guild_season_rank_key"
    ON "community_season_snapshot_entries"("guild_id", "season_key", "rank");

CREATE INDEX "community_season_snapshots_season_key_finalized_at_idx"
    ON "community_season_snapshots"("season_key", "finalized_at" DESC);

CREATE INDEX "community_season_snapshot_entries_guild_season_award_idx"
    ON "community_season_snapshot_entries"("guild_id", "season_key", "award_tier", "rank");
