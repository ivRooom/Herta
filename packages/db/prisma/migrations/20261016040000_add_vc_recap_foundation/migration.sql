-- VC Recap基盤(Phase 0-2): 同意テーブル・VC文字起こしセッション・セグメント。
-- 生音声は一切DBへ保存しない(メモリ上でのSTT処理のみ)。transcript本文(segments)は
-- 要約生成完了後にアプリ側で削除する(本文を長期保持しないプライバシー設計)。

-- CreateEnum
CREATE TYPE "vc_recap_session_status" AS ENUM ('active', 'summarizing', 'completed', 'failed');

-- CreateTable
CREATE TABLE "user_data_consents" (
    "user_id" TEXT NOT NULL,
    "voice_transcription_consent" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_data_consents_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "vc_recap_sessions" (
    "id" TEXT NOT NULL,
    "guild_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "started_by" TEXT,
    "status" "vc_recap_session_status" NOT NULL DEFAULT 'active',
    "consenting_user_ids" TEXT[],
    "non_consenting_user_ids" TEXT[],
    "summary" TEXT,
    "topics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vc_recap_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vc_recap_transcript_segments" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "ended_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vc_recap_transcript_segments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vc_recap_sessions_guild_id_started_at_idx" ON "vc_recap_sessions"("guild_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "vc_recap_sessions_guild_id_channel_id_started_at_idx" ON "vc_recap_sessions"("guild_id", "channel_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "vc_recap_transcript_segments_session_id_started_at_idx" ON "vc_recap_transcript_segments"("session_id", "started_at");

-- AddForeignKey
ALTER TABLE "vc_recap_sessions" ADD CONSTRAINT "vc_recap_sessions_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "vc_recap_transcript_segments" ADD CONSTRAINT "vc_recap_transcript_segments_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "vc_recap_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
