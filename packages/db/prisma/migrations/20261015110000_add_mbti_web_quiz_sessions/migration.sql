-- CreateTable
CREATE TABLE "mbti_web_quiz_sessions" (
    "id" TEXT NOT NULL,
    "guild_id" TEXT NOT NULL,
    "discord_user_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "question_order" JSONB NOT NULL,
    "answers" JSONB NOT NULL DEFAULT '[]',
    "scores" JSONB NOT NULL DEFAULT '{}',
    "result_type" TEXT,
    "result_identity" TEXT,
    "completed_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "mbti_web_quiz_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mbti_web_quiz_sessions_guild_id_discord_user_id_status_idx" ON "mbti_web_quiz_sessions"("guild_id", "discord_user_id", "status");

-- CreateIndex
CREATE INDEX "mbti_web_quiz_sessions_status_expires_at_idx" ON "mbti_web_quiz_sessions"("status", "expires_at");
