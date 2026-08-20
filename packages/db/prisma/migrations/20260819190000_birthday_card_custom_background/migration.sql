CREATE TABLE "birthday_card_backgrounds" (
  "guild_id" TEXT NOT NULL,
  "content_type" VARCHAR(32) NOT NULL,
  "file_name" VARCHAR(120) NOT NULL,
  "content" BYTEA NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  "sha256" CHAR(64) NOT NULL,
  "updated_by" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "birthday_card_backgrounds_pkey" PRIMARY KEY ("guild_id"),
  CONSTRAINT "birthday_card_backgrounds_guild_id_fkey"
    FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "birthday_card_backgrounds_content_type_check"
    CHECK ("content_type" IN ('image/png', 'image/jpeg', 'image/webp')),
  CONSTRAINT "birthday_card_backgrounds_size_bytes_check"
    CHECK ("size_bytes" > 0 AND "size_bytes" <= 5242880),
  CONSTRAINT "birthday_card_backgrounds_dimensions_check"
    CHECK (
      "width" > 0 AND "height" > 0 AND
      "width" <= 8192 AND "height" <= 8192 AND
      "width"::BIGINT * "height"::BIGINT <= 16000000
    ),
  CONSTRAINT "birthday_card_backgrounds_sha256_check"
    CHECK ("sha256" ~ '^[0-9a-f]{64}$')
);
