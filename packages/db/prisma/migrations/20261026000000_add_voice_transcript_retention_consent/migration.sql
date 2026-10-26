-- VC文字起こし本文を30日間保存することへの同意日時。nullは要約のみ残す旧同意(本文は要約後に削除)。
ALTER TABLE "user_data_consents" ADD COLUMN "voice_transcript_retention_consented_at" TIMESTAMPTZ(3);

-- 保存期間切れの本文を削除するジョブ用。
CREATE INDEX "vc_recap_sessions_ended_at_idx" ON "vc_recap_sessions"("ended_at");
