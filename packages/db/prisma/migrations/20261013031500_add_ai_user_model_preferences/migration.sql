-- CreateTable
CREATE TABLE "ai_user_model_preferences" (
    "guild_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" VARCHAR(16) NOT NULL,
    "model_profile" VARCHAR(16) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ai_user_model_preferences_pkey" PRIMARY KEY ("guild_id","user_id")
);
