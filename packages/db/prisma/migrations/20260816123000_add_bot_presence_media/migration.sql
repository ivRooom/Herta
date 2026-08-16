CREATE TABLE "bot_presence_media_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "media" JSONB,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_presence_media_settings_pkey" PRIMARY KEY ("id")
);
