ALTER TABLE "birthday_registrations"
ADD COLUMN "birth_year" INTEGER;

ALTER TABLE "birthday_registrations"
ADD CONSTRAINT "birthday_registrations_birth_year_check"
CHECK ("birth_year" IS NULL OR "birth_year" BETWEEN 1900 AND 2100);

CREATE TABLE "birthday_celebrations" (
    "guild_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "local_date" TEXT NOT NULL,
    "birth_year" INTEGER,
    "age" INTEGER,
    "server_birthday_number" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "birthday_celebrations_pkey" PRIMARY KEY ("guild_id", "user_id", "local_date"),
    CONSTRAINT "birthday_celebrations_birth_year_check"
      CHECK ("birth_year" IS NULL OR "birth_year" BETWEEN 1900 AND 2100),
    CONSTRAINT "birthday_celebrations_age_check"
      CHECK ("age" IS NULL OR "age" BETWEEN 0 AND 200),
    CONSTRAINT "birthday_celebrations_server_birthday_number_check"
      CHECK ("server_birthday_number" IS NULL OR "server_birthday_number" > 0),
    CONSTRAINT "birthday_celebrations_local_date_check"
      CHECK ("local_date" ~ '^\\d{4}-\\d{2}-\\d{2}$')
);

CREATE INDEX "birthday_celebrations_guild_id_local_date_idx"
ON "birthday_celebrations"("guild_id", "local_date" DESC);

CREATE INDEX "birthday_celebrations_guild_id_user_id_local_date_idx"
ON "birthday_celebrations"("guild_id", "user_id", "local_date" DESC);

CREATE TABLE "guild_anniversaries" (
    "guild_id" TEXT NOT NULL,
    "anniversary_date" DATE NOT NULL,
    "updated_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guild_anniversaries_pkey" PRIMARY KEY ("guild_id"),
    CONSTRAINT "guild_anniversaries_guild_id_fkey"
      FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
