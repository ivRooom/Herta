CREATE TABLE "studio_user_preferences" (
    "user_id" TEXT NOT NULL,
    "default_guild_id" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "studio_user_preferences_pkey" PRIMARY KEY ("user_id"),
    CONSTRAINT "studio_user_preferences_default_guild_id_check"
      CHECK ("default_guild_id" IS NULL OR "default_guild_id" ~ '^[0-9]{17,20}$')
);

CREATE TABLE "bot_presence_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "status" TEXT NOT NULL DEFAULT 'online',
    "activity_type" TEXT NOT NULL DEFAULT 'playing',
    "activity_text" TEXT NOT NULL DEFAULT 'Herta',
    "updated_by" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_presence_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "bot_presence_settings_status_check"
      CHECK ("status" IN ('online', 'idle', 'dnd', 'invisible')),
    CONSTRAINT "bot_presence_settings_activity_type_check"
      CHECK ("activity_type" IN ('playing', 'listening', 'watching', 'competing')),
    CONSTRAINT "bot_presence_settings_activity_text_check"
      CHECK (char_length("activity_text") BETWEEN 1 AND 128)
);

ALTER TABLE "studio_user_preferences"
ADD CONSTRAINT "studio_user_preferences_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
