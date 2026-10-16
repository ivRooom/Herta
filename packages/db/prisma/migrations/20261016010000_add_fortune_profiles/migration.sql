-- Optional, guild-scoped, owner-only fortune settings; no daily results or raw MBTI answers.
CREATE TABLE "fortune_profiles" (
  "guild_id" TEXT NOT NULL REFERENCES "guilds"("id") ON DELETE CASCADE,
  "user_id" TEXT NOT NULL,
  "birthday" VARCHAR(10),
  "blood_type" VARCHAR(2) CHECK ("blood_type" IN ('A', 'B', 'O', 'AB')),
  "mbti" VARCHAR(6) CHECK ("mbti" ~ '^[EI][SN][TF][JP](-[AT])?$'),
  "zodiac" VARCHAR(8),
  "age_group" VARCHAR(12),
  "eto" VARCHAR(1),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("guild_id", "user_id"),
  CHECK ("birthday" IS NULL OR "birthday" ~ '^([0-9]{4}-)?[0-9]{2}-[0-9]{2}$')
);
