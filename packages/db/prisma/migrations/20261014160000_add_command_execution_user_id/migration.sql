-- AlterTable
ALTER TABLE "command_execution_events" ADD COLUMN "user_id" TEXT;

-- CreateIndex
CREATE INDEX "command_execution_events_user_id_executed_at_idx" ON "command_execution_events"("user_id", "executed_at" DESC);
